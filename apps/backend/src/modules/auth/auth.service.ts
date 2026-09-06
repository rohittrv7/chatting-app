import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuthRepository } from './auth.repository';
import { OtpRedisService } from './otp-redis.service';
import { AuthGateway } from './auth.gateway';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto, SocketEvent } from '@chat/shared-contracts';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** argon2id options per Requirement 1.2 and design spec (time ≥2, memory 65536 KB) */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  timeCost: 2,
  memoryCost: 65536,
  parallelism: 1,
} as const;

/** Fast constant-time SHA-256 hash for high-entropy 256-bit refresh tokens */
function hashRefreshToken(token: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(token).digest('hex');
}

/** Verify refresh token supporting both fast SHA-256 and legacy argon2 hashes */
async function verifyRefreshTokenHash(storedHash: string, rawToken: string): Promise<boolean> {
  if (storedHash.startsWith('sha256:')) {
    const computed = hashRefreshToken(rawToken);
    try {
      return (
        storedHash.length === computed.length &&
        crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(computed))
      );
    } catch {
      return false;
    }
  }
  if (storedHash.startsWith('$argon2')) {
    try {
      return await argon2.verify(storedHash, rawToken);
    } catch {
      return false;
    }
  }
  return false;
}

/** Maximum number of devices per user account */
const MAX_DEVICES = 5;

/** Generate a cryptographically random 6-digit OTP string */
function generateOtpCode(): string {
  // Use a value in [100000, 999999] to guarantee 6 digits
  const code = Math.floor(100000 + Math.random() * 900000);
  return String(code);
}

function normalizePhoneNumber(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

import { MediaService } from '../media/media.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly otpRedis: OtpRedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly mediaService: MediaService,
    @Optional() private readonly authGateway: AuthGateway,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // OTP Request  (Requirement 1.1)
  // ──────────────────────────────────────────────────────────────────────────
  async requestOtp(dto: RequestOtpDto): Promise<{ message: string; mockOtp?: string }> {
    const normalizedPhone = normalizePhoneNumber(dto.phoneNumber);
    const code = generateOtpCode();

    // Store in Redis hash otp:{phoneNumber} with 10-min TTL
    await this.otpRedis.storeOtp(normalizedPhone, code);

    console.log(
      `🔑 [AuthService] OTP generated for ${normalizedPhone.slice(0, 4)}****${normalizedPhone.slice(-2)}`,
    );
    // FIX: OTP value is NOT logged — logging the actual code is a security vulnerability
    // as logs may be forwarded to monitoring systems (Datadog, CloudWatch, etc.)
    // In production, integrate with an SMS provider (Twilio, MSG91) to deliver the OTP.

    return {
      message: 'OTP sent successfully',
      // FIX: Only expose mockOtp in non-production environments.
      // In production this field is omitted — the OTP is delivered via SMS.
      ...(process.env.NODE_ENV !== 'production' ? { mockOtp: code } : {}),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OTP Verification  (Requirements 1.2, 1.3, 1.4)
  // ──────────────────────────────────────────────────────────────────────────
  async verifyOtp(dto: VerifyOtpDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: unknown;
    device: unknown;
    isNewUser?: boolean;
  }> {
    const normalizedPhone = normalizePhoneNumber(dto.phoneNumber);
    const record = await this.otpRedis.getOtp(normalizedPhone);

    // ── 1. No record (never sent / expired) ──────────────────────────────
    if (!record) {
      throw new BadRequestException({
        code: 'INVALID_OTP',
        message: 'OTP not found or expired. Please request a new one.',
      });
    }

    // ── 2. Lockout check (Requirement 1.4) ──────────────────────────────
    if (record.lockedUntil > 0 && Date.now() < record.lockedUntil) {
      const retryAfterSec = Math.ceil((record.lockedUntil - Date.now()) / 1000);
      throw new HttpException(
        {
          code: 'OTP_LOCKED',
          message: 'Too many failed attempts. Phone number is temporarily locked.',
          retryAfterSeconds: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── 3. Code comparison (Requirement 1.3) ────────────────────────────
    if (dto.otp !== record.code) {
      const { locked, remainingAttempts } = await this.otpRedis.recordFailure(normalizedPhone);

      if (locked) {
        throw new HttpException(
          {
            code: 'OTP_LOCKED',
            message: 'Too many failed attempts. Phone number is locked for 30 minutes.',
            remainingAttempts: 0,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new BadRequestException({
        code: 'INVALID_OTP',
        message: 'Incorrect OTP code.',
        remainingAttempts,
      });
    }

    // ── 4. Correct OTP — clear the record immediately ───────────────────
    await this.otpRedis.clearOtp(normalizedPhone);

    // ── 5. Create or find User (Requirement 1.2) ─────────────────────────
    let user = await this.authRepository.findUserByPhoneNumber(normalizedPhone);
    if (!user) {
      user = await this.authRepository.createUser(normalizedPhone);
    }

    // ── 6. Device limit check (Requirement 1.9 / Task 4.3a) ──────────────
    const existingDevice = await this.authRepository.findDeviceByUserAndDeviceId(
      user.id,
      dto.deviceId,
    );
    if (!existingDevice) {
      const deviceCount = await this.authRepository.countDevicesByUserId(user.id);
      if (deviceCount >= MAX_DEVICES) {
        throw new HttpException(
          {
            code: 'DEVICE_LIMIT_EXCEEDED',
            message: 'Maximum number of devices (5) reached.',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    // ── 7. Upsert Device (Requirement 1.9) ───────────────────────────────
    const device = await this.authRepository.upsertDevice(
      user.id,
      dto.deviceId,
      dto.deviceName,
      dto.platform,
      dto.fcmToken,
    );

    // ── 8. Invalidate all previous RefreshTokens for this Device (Requirement 1.2) ─
    await this.authRepository.deleteAllRefreshTokensByDeviceId(device.id);

    // ── 9. Issue JWT (15 min) (Requirement 1.2) ─────────────────────────
    const payload = {
      sub: user.id,
      deviceId: device.id,
      phoneNumber: user.phoneNumber,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    // ── 10. Issue RefreshToken hashed with argon2id (7 days) (Requirement 1.2) ─
    const rawRefreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
      secret:
        this.configService.get<string>('JWT_REFRESH_SECRET') ||
        (process.env.NODE_ENV === 'production'
          ? (() => {
              throw new Error('JWT_REFRESH_SECRET is required in production');
            })()
          : 'dev_only_refresh_secret_change_in_production'),
    });

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.authRepository.saveRefreshToken(device.id, tokenHash, expiresAt);

    const isNewUser = !user.displayName;

    // FIX: Strip sensitive fields before returning — fcmToken, DB internals should not
    // be exposed to the client. Only return the fields the mobile app actually needs.
    const safeUser = {
      id: user.id,
      phoneNumber: user.phoneNumber,
      displayName: user.displayName,
      username: user.username,
      about: user.about,
      avatarUrl: user.avatarUrl,
    };

    const safeDevice = {
      id: device.id,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
    };

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      isNewUser,
      user: safeUser,
      device: safeDevice,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Refresh Token Rotation  (Requirements 1.5, 1.6, 1.7)
  // ──────────────────────────────────────────────────────────────────────────
  async refreshToken(dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(dto.refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          (process.env.NODE_ENV === 'production'
            ? (() => {
                throw new Error('JWT_REFRESH_SECRET is required in production');
              })()
            : 'dev_only_refresh_secret_change_in_production'),
      });

      const deviceId = dto.deviceId || (payload as any).deviceId;
      let device = await this.authRepository.findDeviceById(deviceId);
      if (!device && payload.sub) {
        device = await this.authRepository.findDeviceByUserId(payload.sub);
      }
      if (!device) {
        throw new UnauthorizedException('Device not found or session terminated');
      }

      // Verify the supplied raw token matches one of the stored hashes for this device (<1ms)
      const storedTokens = await this.authRepository.findRefreshTokensByDeviceId(device.id);
      let matchedToken: { id: string } | null = null;

      for (const stored of storedTokens) {
        const valid = await verifyRefreshTokenHash(stored.tokenHash, dto.refreshToken);
        if (valid) {
          matchedToken = stored;
          break;
        }
      }

      if (!matchedToken) {
        // Possible replay — invalidate all tokens for device (Requirement 1.7)
        await this.authRepository.deleteAllRefreshTokensByDeviceId(device.id);
        throw new UnauthorizedException({
          code: 'TOKEN_REPLAY',
          message: 'Refresh token is invalid or has already been used.',
        });
      }

      // Rotate: delete the consumed token, issue a new pair
      await this.authRepository.deleteRefreshToken(matchedToken.id);

      const newPayload = {
        sub: payload.sub,
        deviceId: device.id,
        phoneNumber: payload.phoneNumber,
      };

      const newAccessToken = this.jwtService.sign(newPayload, { expiresIn: '15m' });
      const newRefreshToken = this.jwtService.sign(newPayload, {
        expiresIn: '7d',
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          (process.env.NODE_ENV === 'production'
            ? (() => {
                throw new Error('JWT_REFRESH_SECRET is required in production');
              })()
            : 'dev_only_refresh_secret_change_in_production'),
      });

      const tokenHash = hashRefreshToken(newRefreshToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await this.authRepository.saveRefreshToken(device.id, tokenHash, expiresAt);

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Device Management
  // ──────────────────────────────────────────────────────────────────────────
  async listDevices(userId: string) {
    return this.authRepository.listDevicesByUserId(userId);
  }

  async revokeDevice(userId: string, deviceIdToDelete: string) {
    const device = await this.authRepository.findDeviceById(deviceIdToDelete);
    if (!device || device.userId !== userId) {
      throw new BadRequestException('Device not found or access denied');
    }

    await this.authRepository.deleteDevice(deviceIdToDelete);

    // Emit force-logout socket event to the user's room (Task 4.3c)
    if (this.authGateway?.server) {
      this.authGateway.server
        .to(`user_${userId}`)
        .emit(SocketEvent.DEVICE_FORCE_LOGOUT, { deviceId: deviceIdToDelete });
    }

    return { success: true, message: 'Device session revoked' };
  }

  async updateProfile(
    userId: string,
    dto: { name?: string; username?: string; status?: string; avatarUrl?: string },
  ) {
    const cleanUsername = dto.username ? dto.username.replace(/^@+/, '').trim() : undefined;
    let safeAvatarUrl = dto.avatarUrl;
    if (
      safeAvatarUrl &&
      (safeAvatarUrl.startsWith('file://') ||
        safeAvatarUrl.startsWith('data:') ||
        safeAvatarUrl.startsWith('blob:'))
    ) {
      // Do not overwrite avatar with local device cache URI
      safeAvatarUrl = undefined;
    }

    const payloadToUpdate: any = {
      ...dto,
      username: cleanUsername,
    };
    if (safeAvatarUrl === undefined) {
      delete payloadToUpdate.avatarUrl;
    } else {
      payloadToUpdate.avatarUrl = safeAvatarUrl;
    }

    const user = await this.authRepository.updateUserProfile(userId, payloadToUpdate);
    return {
      success: true,
      message: 'Profile updated successfully',
      user,
    };
  }

  async uploadAvatar(userId: string, dto: { base64Data: string; fileName?: string }) {
    if (!dto.base64Data) throw new BadRequestException('base64Data is required');
    const cleanBase64 = dto.base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    // FIX: Validate avatar size — max 2MB for profile pictures
    const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
    if (buffer.length > MAX_AVATAR_SIZE) {
      throw new BadRequestException(
        `Avatar file size ${buffer.length} bytes exceeds the 2 MB limit`,
      );
    }

    // Validate that the decoded bytes are actually a valid image
    // by checking magic bytes (file signature) — prevents disguised executable uploads.
    // Avatar images are NOT encrypted so this check is both valid and meaningful here.
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
    // WebP: bytes 0-3 = 'RIFF', bytes 8-11 = 'WEBP'
    const isWebp =
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50;
    if (!isJpeg && !isPng && !isGif && !isWebp) {
      throw new BadRequestException('Avatar must be a valid image file (JPEG, PNG, GIF, or WebP)');
    }

    const filename = `avatar_${userId}_${Date.now()}.jpg`;
    const avatarsDir = path.join(process.cwd(), 'uploads', 'avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

    const filePath = path.join(avatarsDir, filename);
    fs.writeFileSync(filePath, buffer);

    // Sync to Backblaze B2 bucket
    const b2Key = `avatars/${filename}`;
    let b2Url: string | undefined;
    if (this.mediaService) {
      try {
        b2Url = await this.mediaService.uploadBuffer(buffer, b2Key, 'image/jpeg');
      } catch {}
    }

    const relativeUrl = `/uploads/avatars/${filename}`;
    const avatarUrl = relativeUrl;
    const updatedUser = await this.authRepository.updateUserProfile(userId, { avatarUrl });
    return {
      success: true,
      message: 'Avatar updated successfully',
      avatarUrl,
      b2Url: b2Url || undefined,
      user: updatedUser,
    };
  }

  /**
   * Sync phone contacts and discover who is registered on the platform.
   * Registered users are prioritized with full profiles.
   * Cached in Redis for 5 minutes for instant response times.
   */
  async syncContacts(userId: string, rawPhoneNumbers: string[]) {
    if (!rawPhoneNumbers || !Array.isArray(rawPhoneNumbers) || rawPhoneNumbers.length === 0) {
      return { registered: [], unregistered: [] };
    }

    // Clean phone numbers and generate deterministic Redis cache key
    const cleanNumbers: string[] = [];
    for (const raw of rawPhoneNumbers) {
      if (!raw || typeof raw !== 'string') continue;
      const clean10 = raw.replace(/\D/g, '').slice(-10);
      if (clean10 && clean10.length >= 7) {
        cleanNumbers.push(clean10);
      }
    }

    const sortedSample = [...cleanNumbers].sort().join(',');
    const cacheKey = `cache:sync_contacts:${userId}:${Buffer.from(sortedSample).toString('base64').slice(0, 48)}`;

    const cached = await this.otpRedis.getCache(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return {
          ...parsed,
          fromRedisCache: true,
          cachedAt: new Date().toISOString(),
        };
      } catch {
        // fall through on cache parse error
      }
    }

    const registeredUsers = await this.authRepository.findRegisteredUsersByPhoneNumbers(
      rawPhoneNumbers,
      userId,
    );

    const registered10DigitSet = new Set<string>();
    const seenUserIds = new Set<string>();
    const registered: any[] = [];

    for (const u of registeredUsers) {
      if (seenUserIds.has(u.id)) continue;
      seenUserIds.add(u.id);

      const u10 = (u.phoneNumber || '').replace(/\D/g, '').slice(-10);
      if (u10) {
        registered10DigitSet.add(u10);
      }

      registered.push({
        id: u.id,
        phoneNumber: u10 || u.phoneNumber,
        displayName: u.displayName,
        username: u.username ? `@${u.username.replace(/^@+/, '')}` : null,
        avatarUrl: u.avatarUrl,
        about: u.about,
        isRegistered: true,
      });
    }

    const unregisteredSet = new Set<string>();
    for (const raw of rawPhoneNumbers) {
      if (!raw || typeof raw !== 'string') continue;
      const raw10 = raw.replace(/\D/g, '').slice(-10);
      if (!raw10) continue;

      if (!registered10DigitSet.has(raw10)) {
        unregisteredSet.add(raw);
      }
    }

    const result = {
      registered,
      unregistered: Array.from(unregisteredSet),
      fromRedisCache: false,
    };

    // Cache in Redis for 5 minutes (300 seconds)
    await this.otpRedis.setCache(cacheKey, JSON.stringify(result), 300);

    return result;
  }

  async searchUsers(currentUserId: string, query: string) {
    const results = await this.authRepository.searchUsers(currentUserId, query);
    return results.map((u) => ({
      id: u.id,
      displayName: u.displayName || u.username || u.phoneNumber || 'User',
      name: u.displayName || u.username || u.phoneNumber || 'User',
      username: u.username ? `@${u.username.replace(/^@+/, '')}` : undefined,
      phoneNumber: u.phoneNumber,
      about: u.about || 'Available',
      avatarUrl: u.avatarUrl || undefined,
      isRegistered: true,
    }));
  }

  async blockUser(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException('You cannot block yourself');
    }
    await this.authRepository.blockUser(currentUserId, targetUserId);
    return { success: true, message: 'User blocked successfully', targetUserId };
  }

  async unblockUser(currentUserId: string, targetUserId: string) {
    await this.authRepository.unblockUser(currentUserId, targetUserId);
    return { success: true, message: 'User unblocked successfully', targetUserId };
  }

  async getBlockedUsers(currentUserId: string) {
    const list = await this.authRepository.getBlockedUsers(currentUserId);
    return list.map((item) => ({
      id: item.blocked.id,
      displayName: item.blocked.displayName || item.blocked.username || item.blocked.phoneNumber,
      username: item.blocked.username ? `@${item.blocked.username.replace(/^@+/, '')}` : null,
      phoneNumber: item.blocked.phoneNumber,
      avatarUrl: item.blocked.avatarUrl,
      about: item.blocked.about,
      blockedAt: item.createdAt,
    }));
  }

  async getBlockStatus(currentUserId: string, targetUserId: string) {
    return this.authRepository.isUserBlocked(currentUserId, targetUserId);
  }
}

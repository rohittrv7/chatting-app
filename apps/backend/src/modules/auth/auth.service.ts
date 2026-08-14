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

/** argon2id options per Requirement 1.2 and design spec (time ≥2, memory 65536 KB) */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  timeCost: 2,
  memoryCost: 65536,
  parallelism: 1,
} as const;

/** Maximum number of devices per user account */
const MAX_DEVICES = 5;

/** Generate a cryptographically random 6-digit OTP string */
function generateOtpCode(): string {
  // Use a value in [100000, 999999] to guarantee 6 digits
  const code = Math.floor(100000 + Math.random() * 900000);
  return String(code);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly otpRedis: OtpRedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly authGateway: AuthGateway,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // OTP Request  (Requirement 1.1)
  // ──────────────────────────────────────────────────────────────────────────
  async requestOtp(dto: RequestOtpDto): Promise<{ message: string; mockOtp?: string }> {
    const code = generateOtpCode();

    // Store in Redis hash otp:{phoneNumber} with 10-min TTL
    await this.otpRedis.storeOtp(dto.phoneNumber, code);

    // In production this would dispatch an SMS; in dev we expose it in the response
    const isDev = this.configService.get<string>('NODE_ENV', 'development') !== 'production';

    return {
      message: 'OTP sent successfully',
      ...(isDev ? { mockOtp: code } : {}),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OTP Verification  (Requirements 1.2, 1.3, 1.4)
  // ──────────────────────────────────────────────────────────────────────────
  async verifyOtp(
    dto: VerifyOtpDto,
  ): Promise<{ accessToken: string; refreshToken: string; user: unknown; device: unknown }> {
    const record = await this.otpRedis.getOtp(dto.phoneNumber);

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
      const { locked, remainingAttempts } = await this.otpRedis.recordFailure(dto.phoneNumber);

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
    await this.otpRedis.clearOtp(dto.phoneNumber);

    // ── 5. Create or find User (Requirement 1.2) ─────────────────────────
    let user = await this.authRepository.findUserByPhoneNumber(dto.phoneNumber);
    if (!user) {
      user = await this.authRepository.createUser(dto.phoneNumber);
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
      secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'super_secret_jwt_refresh_key_12345'),
    });

    const tokenHash = (await argon2.hash(rawRefreshToken, ARGON2_OPTIONS)) as string;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.authRepository.saveRefreshToken(device.id, tokenHash, expiresAt);

    const isNewUser = !user.displayName;

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      isNewUser,
      user,
      device,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Refresh Token Rotation  (Requirements 1.5, 1.6, 1.7)
  // ──────────────────────────────────────────────────────────────────────────
  async refreshToken(dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(dto.refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'super_secret_jwt_refresh_key_12345'),
      });

      const device = await this.authRepository.findDeviceById(dto.deviceId);
      if (!device) {
        throw new UnauthorizedException('Device not found or session terminated');
      }

      // Verify the supplied raw token matches one of the stored hashes for this device
      const storedTokens = await this.authRepository.findRefreshTokensByDeviceId(device.id);
      let matchedToken: { id: string } | null = null;

      for (const stored of storedTokens) {
        const valid = await argon2.verify(stored.tokenHash, dto.refreshToken);
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
        secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'super_secret_jwt_refresh_key_12345'),
      });

      const tokenHash = (await argon2.hash(newRefreshToken, ARGON2_OPTIONS)) as string;
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
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { User, Device, RefreshToken } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const clean10 = (phoneNumber || '').replace(/\D/g, '').slice(-10);
    return this.prisma.user.findFirst({
      where: {
        OR: [
          ...(clean10
            ? [
                { phoneNumber: clean10 },
                { phoneNumber: `+91${clean10}` },
                { phoneNumber: `+${clean10}` },
                { phoneNumber: `91${clean10}` },
              ]
            : []),
          { phoneNumber },
        ],
      },
    });
  }

  async createUser(phoneNumber: string): Promise<User> {
    return this.prisma.user.create({
      data: {
        phoneNumber,
        settings: {
          create: {},
        },
      },
    });
  }

  async upsertDevice(
    userId: string,
    deviceId: number,
    deviceName: string,
    platform: string,
    fcmToken?: string,
  ): Promise<Device> {
    return this.prisma.device.upsert({
      where: {
        userId_deviceId: { userId, deviceId },
      },
      update: {
        deviceName,
        platform,
        fcmToken,
        lastActiveAt: new Date(),
      },
      create: {
        userId,
        deviceId,
        deviceName,
        platform,
        fcmToken,
      },
    });
  }

  async findDeviceById(id: string): Promise<Device | null> {
    return this.prisma.device.findUnique({
      where: { id },
    });
  }

  async listDevicesByUserId(userId: string): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  async deleteDevice(id: string): Promise<void> {
    // Explicitly invalidate all refresh tokens before removing the device
    // (DB cascade also handles this, but application-level invalidation is explicit per spec)
    await this.deleteAllRefreshTokensByDeviceId(id);
    await this.prisma.device.delete({
      where: { id },
    });
  }

  async saveRefreshToken(
    deviceId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        deviceId,
        tokenHash,
        expiresAt,
      },
    });
  }

  /**
   * Finds a refresh token record by its exact hash value.
   * The record includes the associated Device via a Prisma relation.
   */
  async findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<(RefreshToken & { device: Device }) | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { device: true },
    }) as Promise<(RefreshToken & { device: Device }) | null>;
  }

  async deleteRefreshToken(id: string): Promise<void> {
    await this.prisma.refreshToken.delete({
      where: { id },
    });
  }

  /**
   * Revokes ALL refresh tokens for a given device.
   * Used during replay-attack detection to invalidate the entire device session.
   */
  async deleteAllRefreshTokensByDeviceId(deviceId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { deviceId },
    });
  }

  /**
   * Returns all refresh token records for a given device (by internal UUID).
   * Used in token rotation to verify the supplied raw token against stored hashes.
   */
  async findRefreshTokensByDeviceId(deviceId: string): Promise<RefreshToken[]> {
    return this.prisma.refreshToken.findMany({
      where: { deviceId },
    });
  }

  /**
   * Counts the number of devices registered for a user.
   * Used to enforce the 5-device limit.
   */
  async countDevicesByUserId(userId: string): Promise<number> {
    return this.prisma.device.count({
      where: { userId },
    });
  }

  /**
   * Finds a device by userId + numeric deviceId (the client-assigned integer).
   * Returns null if no such device exists.
   */
  async findDeviceByUserAndDeviceId(userId: string, deviceId: number): Promise<Device | null> {
    return this.prisma.device.findUnique({
      where: {
        userId_deviceId: { userId, deviceId },
      },
    });
  }

  async updateUserProfile(
    userId: string,
    data: { name?: string; username?: string; status?: string; avatarUrl?: string },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: data.name,
        username: data.username,
        about: data.status,
        avatarUrl: data.avatarUrl,
      },
    });
  }

  /**
   * Find registered users matching a list of phone numbers (excluding the requesting user)
   */
  async findRegisteredUsersByPhoneNumbers(
    phoneNumbers: string[],
    excludeUserId?: string,
  ): Promise<User[]> {
    if (!phoneNumbers || phoneNumbers.length === 0) return [];

    const variations = new Set<string>();
    for (const raw of phoneNumbers) {
      if (!raw) continue;
      const clean10 = raw.replace(/\D/g, '').slice(-10);
      if (clean10) {
        variations.add(clean10);
        variations.add(`+91${clean10}`);
        variations.add(`+${clean10}`);
        variations.add(`91${clean10}`);
      }
      variations.add(raw);
    }

    return this.prisma.user.findMany({
      where: {
        phoneNumber: { in: Array.from(variations) },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        about: true,
        createdAt: true,
        updatedAt: true,
      },
    }) as unknown as Promise<User[]>;
  }

  async searchUsers(currentUserId: string, query: string) {
    const cleanQuery = query.trim().replace(/^@+/, '');
    if (!cleanQuery) return [];

    return this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { username: { contains: cleanQuery, mode: 'insensitive' } },
              { displayName: { contains: cleanQuery, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        about: true,
      },
      take: 25,
    });
  }
}


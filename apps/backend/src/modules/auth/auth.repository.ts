import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { User, Device, RefreshToken } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { phoneNumber },
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

  async saveRefreshToken(deviceId: string, tokenHash: string, expiresAt: Date): Promise<RefreshToken> {
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
  async findRefreshTokenByHash(tokenHash: string): Promise<(RefreshToken & { device: Device }) | null> {
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
}

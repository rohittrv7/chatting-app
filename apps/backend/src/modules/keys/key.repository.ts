import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RegisterKeysDto, PreKeyBundleDto } from '@chat/shared-contracts';
import { Prisma } from '@prisma/client';

/**
 * Result of an atomic OTPk bundle fetch, including:
 * - the full bundle DTO
 * - remainingCount: how many unused OTPks remain after this consumption
 * - deviceInternalId: the DB UUID string for the target device
 * - otpkConsumed: whether a OneTimePreKey was actually consumed
 */
export interface PreKeyBundleResult {
  bundle: PreKeyBundleDto;
  remainingCount: number;
  deviceInternalId: string;
  otpkConsumed: boolean;
}

@Injectable()
export class KeyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async registerDeviceKeys(
    userId: string,
    deviceIdString: string,
    dto: RegisterKeysDto,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Upsert Identity Key
      await tx.identityKey.upsert({
        where: {
          userId_deviceId: { userId, deviceId: deviceIdString },
        },
        update: {
          publicKey: dto.identityPublicKey,
        },
        create: {
          userId,
          deviceId: deviceIdString,
          publicKey: dto.identityPublicKey,
        },
      });

      // Upsert Signed PreKey
      await tx.signedPreKey.upsert({
        where: {
          userId_deviceId_keyId: {
            userId,
            deviceId: deviceIdString,
            keyId: dto.signedPreKeyId,
          },
        },
        update: {
          publicKey: dto.signedPrePublicKey,
          signature: dto.signedPreKeySignature,
        },
        create: {
          userId,
          deviceId: deviceIdString,
          keyId: dto.signedPreKeyId,
          publicKey: dto.signedPrePublicKey,
          signature: dto.signedPreKeySignature,
        },
      });

      // Bulk create One-Time PreKeys
      if (dto.oneTimePreKeys && dto.oneTimePreKeys.length > 0) {
        await tx.oneTimePreKey.createMany({
          data: dto.oneTimePreKeys.map((opk) => ({
            userId,
            deviceId: deviceIdString,
            keyId: opk.keyId,
            publicKey: opk.publicKey,
            used: false,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  /**
   * Atomically fetches an X3DH PreKey bundle for a target device.
   *
   * The OTPk selection and marking is done inside a serializable transaction
   * so that concurrent requests cannot select the same OTPk row.
   * Uses SELECT … FOR UPDATE SKIP LOCKED semantics via a raw SQL query to
   * achieve true atomicity (Requirement 3.9, 3.10 / Property 5).
   *
   * Returns the full bundle plus metadata needed by the service layer
   * (remainingCount, deviceInternalId, otpkConsumed).
   */
  async getPreKeyBundle(
    targetUserId: string,
    targetDeviceId: number,
  ): Promise<PreKeyBundleResult | null> {
    // Resolve the device record once, outside the transaction (read-only lookup)
    const device = await this.prisma.device.findUnique({
      where: { userId_deviceId: { userId: targetUserId, deviceId: targetDeviceId } },
    });

    if (!device) return null;

    const identityKey = await this.prisma.identityKey.findUnique({
      where: { userId_deviceId: { userId: targetUserId, deviceId: device.id } },
    });

    const signedPreKey = await this.prisma.signedPreKey.findFirst({
      where: { userId: targetUserId, deviceId: device.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!identityKey || !signedPreKey) return null;

    // -------------------------------------------------------------------
    // Atomic OTPk consumption with SELECT FOR UPDATE SKIP LOCKED.
    // The serializable isolation + FOR UPDATE SKIP LOCKED ensures two
    // concurrent requests never consume the same key.
    // -------------------------------------------------------------------
    const otpkResult = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Use raw SQL to lock the first available unused OTPk exclusively,
        // skipping any row already locked by another concurrent transaction.
        const rows = await tx.$queryRaw<
          { id: string; keyId: number; publicKey: string }[]
        >`
          SELECT id, "keyId", "publicKey"
          FROM "OneTimePreKey"
          WHERE "userId" = ${targetUserId}
            AND "deviceId" = ${device.id}
            AND used = false
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) {
          return null;
        }

        const selected = rows[0];

        // Mark as used atomically within the same transaction
        await tx.oneTimePreKey.update({
          where: { id: selected.id },
          data: { used: true },
        });

        return selected;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Count remaining unused OTPks after potential consumption
    const remainingCount = await this.prisma.oneTimePreKey.count({
      where: { userId: targetUserId, deviceId: device.id, used: false },
    });

    const bundle: PreKeyBundleDto = {
      userId: targetUserId,
      deviceId: targetDeviceId,
      registrationId: targetDeviceId,
      identityPublicKey: identityKey.publicKey,
      signedPreKeyId: signedPreKey.keyId,
      signedPrePublicKey: signedPreKey.publicKey,
      signedPreKeySignature: signedPreKey.signature,
      oneTimePreKeyId: otpkResult?.keyId,
      oneTimePrePublicKey: otpkResult?.publicKey,
    };

    return {
      bundle,
      remainingCount,
      deviceInternalId: device.id,
      otpkConsumed: otpkResult !== null,
    };
  }

  async getActiveDevicesForUser(userId: string) {
    return this.prisma.device.findMany({
      where: { userId },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        platform: true,
      },
    });
  }
}

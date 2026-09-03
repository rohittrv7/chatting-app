import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { KeyRepository } from './key.repository';
import { RegisterKeysDto, PreKeyBundleDto } from '@chat/shared-contracts';
import { AuthGateway } from '../auth/auth.gateway';

/**
 * Threshold below which the server triggers a `replenish-otpk` BullMQ job
 * asking the device to upload more OneTimePreKeys (Requirement 3.10).
 */
const OTPK_REPLENISH_THRESHOLD = 10;

/**
 * The BullMQ queue name for key lifecycle events.
 */
export const KEY_EVENTS_QUEUE = 'key-events';

/**
 * Job name constants for type-safe job dispatch / processing.
 */
export const JOB_REPLENISH_OTPK = 'replenish-otpk';
export const JOB_ROTATE_SIGNED = 'rotate-signed-pre-key';

/**
 * KeyService – orchestrates key registration, signature validation, atomic
 * OneTimePreKey bundle fetch, and BullMQ job dispatch for replenish/rotate
 * events (Requirements 3.2–3.5, 3.9, 3.10).
 */
@Injectable()
export class KeyService {
  private readonly logger = new Logger(KeyService.name);

  constructor(
    private readonly keyRepository: KeyRepository,
    @InjectQueue(KEY_EVENTS_QUEUE) private readonly keyEventsQueue: Queue,
    @Optional() private readonly authGateway?: AuthGateway,
  ) {}

  /**
   * Validates a SignedPreKey's Ed25519/ECDSA signature against the IdentityKey
   * public key, then stores all keys atomically (Requirement 3.2, 3.3, 3.4).
   *
   * The Signal Protocol uses Ed25519 for signed prekey signatures.
   * Keys are base64-encoded 32-byte Curve25519 / Ed25519 keys.
   * The signature is over the SignedPreKey public key bytes.
   *
   * Since @signalapp/libsignal-client is not available in this environment,
   * we verify using Node.js built-in `crypto` with Ed25519.
   */
  async registerKeys(
    userId: string,
    deviceId: string,
    dto: RegisterKeysDto,
  ): Promise<{ success: boolean }> {
    // --- SignedPreKey signature validation (Requirement 3.2) ---
    this.validateSignedPreKeySignature(
      dto.identityPublicKey,
      dto.signedPrePublicKey,
      dto.signedPreKeySignature,
    );

    await this.keyRepository.registerDeviceKeys(userId, deviceId, dto);
    this.logger.log(
      `Keys registered for userId=${userId} deviceId=${deviceId}: ` +
        `1 IK, 1 SPK (id=${dto.signedPreKeyId}), ${dto.oneTimePreKeys.length} OTPks`,
    );

    // ── Step 7: Targeted fanout to the user's own active devices via Socket.IO ──
    if (this.authGateway?.server) {
      this.authGateway.server.to(`user:${userId}`).emit('device:added', {
        userId,
        deviceId: dto.deviceId,
      });
    }

    return { success: true };
  }

  /**
   * Fetches the X3DH PreKey bundle for a target device.
   *
   * - Atomically marks one OTPk as used via a serializable DB transaction
   *   with SELECT FOR UPDATE SKIP LOCKED (Requirement 3.9).
   * - If OTPk pool is empty, returns a SignedPreKey-only bundle AND emits
   *   the `replenish-otpk` BullMQ job immediately (Requirement 3.5, 3.10).
   * - After each OTPk consumption, if remaining count < 10, also dispatches
   *   the `replenish-otpk` job (Requirement 3.10).
   */
  async getPreKeyBundle(targetUserId: string, targetDeviceId: number): Promise<PreKeyBundleDto> {
    const result = await this.keyRepository.getPreKeyBundle(targetUserId, targetDeviceId);

    if (!result) {
      throw new NotFoundException(
        `No prekey bundle available for user ${targetUserId} device ${targetDeviceId}`,
      );
    }

    const { bundle, remainingCount, deviceInternalId, otpkConsumed } = result;

    if (!otpkConsumed) {
      // OTPk pool exhausted — signal device to replenish immediately
      this.logger.warn(
        `OTPk pool empty for userId=${targetUserId} deviceId=${targetDeviceId}. ` +
          `Dispatching immediate replenish job.`,
      );
      await this.dispatchReplenishJob(deviceInternalId, targetDeviceId);
    } else if (remainingCount < OTPK_REPLENISH_THRESHOLD) {
      // Pool is low (< 10 remaining) — schedule a replenish
      this.logger.log(
        `OTPk pool low (${remainingCount} remaining) for userId=${targetUserId} ` +
          `deviceId=${targetDeviceId}. Dispatching replenish job.`,
      );
      await this.dispatchReplenishJob(deviceInternalId, targetDeviceId);
    }

    return bundle;
  }

  async getDevicesForUser(userId: string) {
    return this.keyRepository.getActiveDevicesForUser(userId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Dispatches a `replenish-otpk` BullMQ job to the `key-events` queue.
   * Configured with 3-retry exponential backoff (1s → 2s → 4s) and a
   * dead-letter queue (Requirement 3.5, design BullMQ error strategy).
   */
  private async dispatchReplenishJob(deviceInternalId: string, deviceId: number): Promise<void> {
    try {
      await this.keyEventsQueue.add(
        JOB_REPLENISH_OTPK,
        { deviceInternalId, deviceId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (err) {
      // Non-fatal: log but don't throw — the bundle response must still succeed
      this.logger.error(
        `Failed to dispatch replenish-otpk job for device ${deviceInternalId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Validates the SignedPreKey signature using Node.js `crypto`.
   *
   * Signal Protocol uses Ed25519 signatures. The client signs the
   * SignedPreKey public key bytes (raw 32 bytes, base64-encoded) using
   * the IdentityKey private key. We verify with the IdentityKey public key.
   *
   * Both keys and the signature arrive base64-encoded from the client.
   * Throws HTTP 422 INVALID_KEY_SIGNATURE if validation fails.
   */
  private validateSignedPreKeySignature(
    identityPublicKeyB64: string,
    signedPrePublicKeyB64: string,
    signatureB64: string,
  ): void {
    try {
      const identityKeyBytes = Buffer.from(identityPublicKeyB64, 'base64');
      const signedPreKeyBytes = Buffer.from(signedPrePublicKeyB64, 'base64');
      const signatureBytes = Buffer.from(signatureB64, 'base64');

      // Import the raw 32-byte Ed25519 public key in SubjectPublicKeyInfo format
      // Node.js crypto requires the key to be in SubjectPublicKeyInfo (SPKI) DER
      // for Ed25519. We wrap the raw 32-byte key with the standard Ed25519 SPKI prefix.
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const publicKeyDer = Buffer.concat([spkiPrefix, identityKeyBytes]);

      const publicKey = crypto.createPublicKey({
        key: publicKeyDer,
        format: 'der',
        type: 'spki',
      });

      const isValid = crypto.verify(
        null, // Ed25519 doesn't use a hash algorithm — pass null
        signedPreKeyBytes,
        publicKey,
        signatureBytes,
      );

      if (!isValid) {
        throw new UnprocessableEntityException({
          code: 'INVALID_KEY_SIGNATURE',
          message: 'SignedPreKey signature verification failed',
        });
      }
    } catch (err) {
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }
      // Malformed key material (e.g., wrong length, invalid encoding)
      this.logger.warn(`SignedPreKey signature validation error: ${(err as Error).message}`);
      throw new UnprocessableEntityException({
        code: 'INVALID_KEY_SIGNATURE',
        message: 'SignedPreKey signature verification failed: invalid key material',
      });
    }
  }
}

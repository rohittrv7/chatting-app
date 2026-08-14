import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Job, Queue } from 'bullmq';
import { SocketEvent } from '@chat/shared-contracts';
import { PrismaService } from '../../database/prisma.service';
import { AuthGateway } from '../auth/auth.gateway';
import {
  KEY_EVENTS_QUEUE,
  JOB_REPLENISH_OTPK,
  JOB_ROTATE_SIGNED,
} from './key.service';

/**
 * Payload for the replenish-otpk job.
 */
export interface ReplenishOtpkJobData {
  /** Internal DB UUID of the Device record */
  deviceInternalId: string;
  /** Numeric deviceId (for logging) */
  deviceId: number;
}

/**
 * Payload for the rotate-signed-pre-key job.
 */
export interface RotateSignedJobData {
  /** Internal DB UUID of the Device record */
  deviceInternalId: string;
  /** Numeric deviceId (for logging) */
  deviceId: number;
}

/**
 * BullMQ worker processor for the `key-events` queue.
 *
 * Handles two job types:
 *   1. `replenish-otpk`        – emit v1.keys.replenish to the device socket room
 *   2. `rotate-signed-pre-key` – emit v1.keys.rotate-signed to the device socket room
 *
 * Both job types are dispatched with 3-retry exponential backoff (1s → 2s → 4s).
 * Failed jobs (all retries exhausted) remain in the queue with `removeOnFail: false`
 * so they are visible as failed in the dead-letter view (Requirement 31.3).
 *
 * Socket.io rooms: devices join `device:{deviceInternalId}` on connection.
 * The worker emits to that room so all sockets for the device receive the event.
 *
 * Requirements: 3.5, 3.7, 31.1, 31.2, 31.3
 */
@Processor(KEY_EVENTS_QUEUE, {
  concurrency: 5,
})
export class KeyEventsWorker extends WorkerHost {
  private readonly logger = new Logger(KeyEventsWorker.name);

  constructor(
    /**
     * AuthGateway exposes the shared Socket.io Server instance.
     * Marked @Optional so tests can omit it without DI errors.
     * Accessed lazily (at job-process time) to avoid the initialization-
     * order issue where `server` is undefined before WS server starts.
     */
    @Optional() private readonly authGateway: AuthGateway,
    private readonly prisma: PrismaService,
    @InjectQueue(KEY_EVENTS_QUEUE) private readonly keyEventsQueue: Queue,
  ) {
    super();
  }

  /**
   * Routes jobs to the appropriate handler based on job name.
   */
  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_REPLENISH_OTPK:
        return this.handleReplenishOtpk(job as Job<ReplenishOtpkJobData>);
      case JOB_ROTATE_SIGNED:
        return this.handleRotateSigned(job as Job<RotateSignedJobData>);
      default:
        this.logger.warn(
          `Unknown job name in ${KEY_EVENTS_QUEUE}: ${job.name}`,
        );
    }
  }

  // ─── Job Handlers ──────────────────────────────────────────────────────────

  /**
   * replenish-otpk: Emits `v1.keys.replenish` to the device's socket room.
   *
   * Devices join room `device:{deviceInternalId}` on WebSocket connection.
   * Requirements 3.5, 31.1
   */
  private async handleReplenishOtpk(
    job: Job<ReplenishOtpkJobData>,
  ): Promise<void> {
    const { deviceInternalId, deviceId } = job.data;
    const room = `device:${deviceInternalId}`;

    this.logger.log(
      `[${JOB_REPLENISH_OTPK}] Emitting ${SocketEvent.KEYS_REPLENISH} ` +
        `to room ${room} (attempt ${job.attemptsMade + 1})`,
    );

    this.emitToRoom(room, SocketEvent.KEYS_REPLENISH, { deviceId });
  }

  /**
   * rotate-signed-pre-key: Emits `v1.keys.rotate-signed` to the device's socket room.
   * Requirements 3.7, 31.2
   */
  private async handleRotateSigned(
    job: Job<RotateSignedJobData>,
  ): Promise<void> {
    const { deviceInternalId, deviceId } = job.data;
    const room = `device:${deviceInternalId}`;

    this.logger.log(
      `[${JOB_ROTATE_SIGNED}] Emitting ${SocketEvent.KEYS_ROTATE_SIGNED} ` +
        `to room ${room} (attempt ${job.attemptsMade + 1})`,
    );

    this.emitToRoom(room, SocketEvent.KEYS_ROTATE_SIGNED, { deviceId });
  }

  // ─── Scheduled Rotation (every 30 days / monthly) ──────────────────────

  /**
   * Scheduled job: runs at midnight on the 1st of every month (~every 30 days).
   * Dispatches `rotate-signed-pre-key` jobs for ALL active devices so each
   * device rotates its SignedPreKey (Requirement 3.7, 31.2).
   *
   * Uses @nestjs/schedule @Cron decorator.
   * Cron: "0 0 1 * *" = at 00:00 on day-of-month 1 of every month.
   */
  @Cron('0 0 1 * *')
  async scheduleSignedPreKeyRotation(): Promise<void> {
    this.logger.log(
      'Starting monthly SignedPreKey rotation sweep for all devices',
    );

    const devices = await this.prisma.device.findMany({
      select: { id: true, deviceId: true },
    });

    if (devices.length === 0) {
      this.logger.log('No devices found for SignedPreKey rotation sweep');
      return;
    }

    const jobs = devices.map((device) => ({
      name: JOB_ROTATE_SIGNED,
      data: {
        deviceInternalId: device.id,
        deviceId: device.deviceId,
      } satisfies RotateSignedJobData,
      opts: {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }));

    await this.keyEventsQueue.addBulk(jobs);
    this.logger.log(
      `Dispatched ${jobs.length} ${JOB_ROTATE_SIGNED} jobs for monthly rotation`,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Safely emits a Socket.io event to a room.
   * Guards against the server being unavailable (e.g., during tests or
   * before WS server initialization).
   */
  private emitToRoom(room: string, event: string, data: unknown): void {
    if (!this.authGateway?.server) {
      this.logger.warn(
        `Socket.io server not available. Cannot emit ${event} to room ${room}`,
      );
      return;
    }
    this.authGateway.server.to(room).emit(event, data);
  }
}

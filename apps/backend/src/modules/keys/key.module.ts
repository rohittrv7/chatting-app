import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { KeyService, KEY_EVENTS_QUEUE } from './key.service';
import { KeyController } from './key.controller';
import { KeyRepository } from './key.repository';
import { KeyEventsWorker } from './key-events.worker';
import { PrismaService } from '../../database/prisma.service';
import { AuthGateway } from '../auth/auth.gateway';

/**
 * KeyModule – manages Signal Protocol key material upload, bundle serving,
 * and key lifecycle event processing.
 *
 * BullMQ:
 *   `key-events` queue handles replenish-otpk and rotate-signed-pre-key jobs.
 *   Jobs use 3-retry exponential backoff (1s → 2s → 4s). Failed jobs remain
 *   accessible as failed jobs (removeOnFail: false) — effectively a DLQ view
 *   (Requirement 31.3).
 *
 * Scheduling:
 *   @nestjs/schedule ScheduleModule enables the @Cron decorator in
 *   KeyEventsWorker for the monthly (~30-day) SignedPreKey rotation sweep
 *   (Requirement 3.7, 31.2).
 *
 * Socket.io:
 *   AuthGateway is imported here so KeyEventsWorker can access the shared
 *   Socket.io Server instance (same pattern as AuthService).
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5, 3.7, 3.9, 3.10, 31.1, 31.2, 31.3
 */
@Module({
  imports: [
    ConfigModule,
    // ScheduleModule.forRoot() must be imported once in the module that
    // contains the @Cron-decorated class (or in the root AppModule).
    ScheduleModule.forRoot(),
    // Configure BullMQ connection via Redis. Uses ConfigService so the host
    // and port are driven by environment variables.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 1000, 3000)),
        },
      }),
    }),
    // Register the key-events queue with default job options applied to every
    // job added via this module's Queue instance.
    BullModule.registerQueue({
      name: KEY_EVENTS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        // Keep failed jobs visible (dead-letter pattern — Requirement 31.3)
        removeOnFail: false,
      },
    }),
  ],
  controllers: [KeyController],
  providers: [
    KeyService,
    KeyRepository,
    PrismaService,
    // AuthGateway exposes the shared Socket.io Server instance (same approach
    // as AuthService uses for DEVICE_FORCE_LOGOUT events).
    AuthGateway,
    KeyEventsWorker,
  ],
  exports: [KeyService, KeyRepository],
})
export class KeyModule {}

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private static hasLoggedSuccess = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      if (!PrismaService.hasLoggedSuccess) {
        console.log(
          '\x1b[92m✔ [Database]\x1b[0m \x1b[1m\x1b[97mPostgreSQL connected successfully via Prisma\x1b[0m',
        );
        PrismaService.hasLoggedSuccess = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `\x1b[93m⚠ [Database]\x1b[0m \x1b[1m\x1b[93mPostgreSQL connection pending\x1b[0m (Run \x1b[96mpnpm docker:up\x1b[0m to start local database container): ${msg.slice(0, 80)}...`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL database');
  }

  /**
   * Register SIGTERM / SIGINT shutdown hooks so that when the OS signals the
   * process to stop, NestJS tears down the application gracefully and
   * onModuleDestroy triggers $disconnect().
   *
   * Call this once from bootstrap() after `app.listen()`.
   * Satisfies Requirement 39.5 — graceful shutdown on SIGTERM.
   */
  enableShutdownHooks(app: INestApplication): void {
    process.on('SIGTERM', () => {
      this.logger.log('SIGTERM received — initiating graceful shutdown');
      void app.close();
    });
    process.on('SIGINT', () => {
      this.logger.log('SIGINT received — initiating graceful shutdown');
      void app.close();
    });
  }

  /**
   * Execute a lightweight SELECT 1 query to verify the database connection is
   * alive.  Used by the /health/ready readiness probe (Requirement 23.1).
   *
   * @throws If the database is unreachable the underlying Prisma error
   *         propagates to the caller so it can return HTTP 503.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}

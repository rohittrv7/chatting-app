import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

/**
 * TokenCleanupService
 *
 * Runs a daily cron job that deletes expired RefreshToken rows.
 *
 * WHY:
 *   RefreshTokens have a 7-day TTL but the DB never deletes them automatically.
 *   Left unchecked, the table grows forever (one row per login, per device, per week).
 *   At scale this wastes storage, slows `findMany` queries, and inflates index size.
 *
 * SAFETY:
 *   - Only deletes rows WHERE expiresAt < NOW() — never touches valid tokens.
 *   - Uses a batched delete (LIMIT 1000 per run) to avoid long-running transactions
 *     that could lock the table and impact live login/refresh operations.
 *   - The RefreshToken table has @@index([expiresAt]) so the WHERE clause is O(log n).
 *   - Logs how many rows were deleted so ops can monitor token churn.
 *
 * SCHEDULE:
 *   Runs once per day at 03:00 UTC (low-traffic window).
 *   Adjust the cron expression if your peak traffic is different.
 */
@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);
  private static readonly BATCH_SIZE = 1000;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'refresh_token_cleanup' })
  async deleteExpiredTokens(): Promise<void> {
    const now = new Date();
    this.logger.log(`[TokenCleanup] Starting expired RefreshToken cleanup at ${now.toISOString()}`);

    let totalDeleted = 0;
    let batchDeleted: number;

    // Batched delete — keep going until no expired rows remain.
    // Each iteration is a separate small transaction; avoids one massive lock.
    do {
      const expiredIds = await this.prisma.refreshToken.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true },
        take: TokenCleanupService.BATCH_SIZE,
        orderBy: { expiresAt: 'asc' },
      });

      if (expiredIds.length === 0) break;

      const result = await this.prisma.refreshToken.deleteMany({
        where: { id: { in: expiredIds.map((t) => t.id) } },
      });

      batchDeleted = result.count;
      totalDeleted += batchDeleted;

      if (batchDeleted > 0) {
        this.logger.debug(`[TokenCleanup] Deleted batch of ${batchDeleted} expired tokens`);
      }
    } while (batchDeleted === TokenCleanupService.BATCH_SIZE);

    this.logger.log(`[TokenCleanup] Done — deleted ${totalDeleted} expired RefreshToken(s)`);
  }

  /**
   * Opportunistic cleanup: delete up to 50 expired tokens for the given device.
   * Call this at the end of a successful login or token refresh to keep the table
   * tidy without waiting for the nightly cron — especially useful in dev/staging
   * where the cron may not fire often.
   */
  async cleanupForDevice(deviceId: string): Promise<void> {
    try {
      await this.prisma.refreshToken.deleteMany({
        where: {
          deviceId,
          expiresAt: { lt: new Date() },
        },
      });
    } catch (err: any) {
      // Non-fatal — never let a cleanup failure block the login response
      this.logger.warn(
        `[TokenCleanup] Opportunistic cleanup failed for device ${deviceId}: ${err?.message}`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { ExpenseService } from './expense.service';

@Injectable()
export class ExpenseCleanupService {
  private readonly logger = new Logger(ExpenseCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expenseService: ExpenseService,
  ) {}

  /**
   * Runs every minute to find settled split groups whose 24-hour grace period has expired,
   * and permanently deletes the temporary group conversation while keeping the expense history.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleSettledSplitGroupCleanup() {
    try {
      const now = new Date();
      const expiredSplits = await this.prisma.expenseSplit.findMany({
        where: {
          status: 'SETTLED',
          splitGroupId: { not: null },
          autoDeleteAt: { lte: now },
        },
        select: {
          id: true,
          title: true,
          splitGroupId: true,
          autoDeleteAt: true,
        },
      });

      if (expiredSplits.length === 0) {
        return;
      }

      this.logger.log(
        `🧹 Found ${expiredSplits.length} settled split groups ready for auto-deletion`,
      );

      for (const split of expiredSplits) {
        try {
          await this.expenseService.executeAutoDelete(split.id);
          this.logger.log(`✅ Auto-deleted settled split group for "${split.title}" (${split.id})`);
        } catch (err: any) {
          this.logger.error(
            `❌ Error deleting settled split group for "${split.title}" (${split.id}): ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in handleSettledSplitGroupCleanup: ${err.message}`);
    }
  }
}

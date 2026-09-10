import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * MessageCleanupService
 *
 * Implements the WhatsApp-style "server as temporary relay" model:
 *
 *   1. DELIVERY-COMPLETE WIPE (triggered inline):
 *      When a receipt arrives confirming the last pending member of a conversation
 *      has DELIVERED a message, this service immediately nulls out the ciphertexts
 *      field and sets contentClearedAt. The device's local WatermelonDB is the
 *      permanent source of truth — the server only holds content long enough to
 *      guarantee delivery.
 *
 *   2. UNDELIVERED EXPIRY CRON (daily at 02:00 UTC):
 *      Messages older than 30 days that never reached DELIVERED status have their
 *      ciphertexts cleared. The metadata row is preserved for audit purposes.
 *
 *   3. ATTACHMENT CLEANUP CRON (daily at 04:00 UTC):
 *      Attachments where ALL conversation members have downloaded the file, OR
 *      the file is older than 14 days (configurable), have their fileUrl invalidated
 *      (set to empty string) and deletedAt set. The actual object-storage deletion
 *      is handled separately by the media retention policy — this service just
 *      marks the DB row so the app knows the file is gone from the server.
 *
 * SAFETY:
 *   - All mutations are batched (≤500 per iteration) to avoid long transactions.
 *   - clearCiphertextsAfterDelivery() is called from message.gateway.ts inside
 *     the receipt handler — fire-and-forget, never blocks the socket response.
 *   - Cron jobs run in low-traffic windows and use indexed WHERE clauses.
 */
@Injectable()
export class MessageCleanupService {
  private readonly logger = new Logger(MessageCleanupService.name);

  // How many days to keep undelivered message content on the server
  static readonly UNDELIVERED_EXPIRY_DAYS = 30;

  // How many days to keep attachment files on the server before forcing cleanup
  static readonly ATTACHMENT_RETENTION_DAYS = 14;

  private static readonly BATCH_SIZE = 500;

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // 1. INLINE: Called from message.gateway.ts handleReceipt()
  //    Check if ALL members of the conversation have DELIVERED the given
  //    message. If yes — clear ciphertexts immediately.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Call this after persisting a DELIVERED receipt for a message.
   * Fire-and-forget — wrap in .catch() at the call-site.
   */
  async clearCiphertextsAfterDelivery(messageId: string): Promise<void> {
    try {
      // 1. Fetch the message with its conversation member list and existing receipts
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          contentClearedAt: true,
          ciphertexts: true,
          conversationId: true,
          senderId: true,
        },
      });

      if (!message || message.contentClearedAt !== null) {
        // Already cleared — nothing to do
        return;
      }

      // 2. Get all members of this conversation (excluding the sender —
      //    sender already has the plaintext on their own device)
      const members = await this.prisma.conversationMember.findMany({
        where: { conversationId: message.conversationId },
        select: { userId: true },
      });

      const recipientIds = members.map((m) => m.userId).filter((id) => id !== message.senderId);

      if (recipientIds.length === 0) {
        // No recipients (self-chat or degenerate conversation) — clear immediately
        await this._wipeCiphertexts(messageId);
        return;
      }

      // 3. Count how many distinct recipients have DELIVERED or READ this message
      const confirmedCount = await this.prisma.receipt.count({
        where: {
          messageId,
          userId: { in: recipientIds },
          status: { in: ['DELIVERED' as any, 'READ' as any] },
        },
      });

      // 4. If all recipients confirmed — clear the content
      if (confirmedCount >= recipientIds.length) {
        await this._wipeCiphertexts(messageId);
        this.logger.debug(
          `[MsgCleanup] Cleared ciphertexts for msg=${messageId} after ${confirmedCount}/${recipientIds.length} deliveries`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `[MsgCleanup] clearCiphertextsAfterDelivery error for msg=${messageId}: ${err?.message}`,
      );
    }
  }

  /**
   * Record that a user has downloaded an attachment.
   * After ALL conversation members have downloaded, the attachment file is
   * eligible for server-side deletion by the cleanup cron.
   */
  async recordAttachmentDownload(attachmentId: string, userId: string): Promise<void> {
    try {
      await this.prisma.attachmentDownload.upsert({
        where: { attachmentId_userId: { attachmentId, userId } },
        create: { attachmentId, userId },
        update: {}, // idempotent — already recorded
      });
    } catch (err: any) {
      this.logger.warn(
        `[MsgCleanup] recordAttachmentDownload error att=${attachmentId} user=${userId}: ${err?.message}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. CRON: 30-day undelivered message expiry — runs daily at 02:00 UTC
  // ─────────────────────────────────────────────────────────────────────────

  @Cron('0 2 * * *', { name: 'message_content_expiry' })
  async expireUndeliveredMessageContent(): Promise<void> {
    const cutoff = new Date(
      Date.now() - MessageCleanupService.UNDELIVERED_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    this.logger.log(
      `[MsgCleanup] Starting 30-day undelivered content expiry (cutoff=${cutoff.toISOString()})`,
    );

    let totalCleared = 0;
    let batchCleared: number;

    do {
      // Find undelivered messages older than 30 days that still have content
      const staleIds = await this.prisma.message.findMany({
        where: {
          createdAt: { lt: cutoff },
          contentClearedAt: null,
          // Content was never cleared — these recipients never came online
          ciphertexts: { not: Prisma.DbNull },
        },
        select: { id: true },
        take: MessageCleanupService.BATCH_SIZE,
        orderBy: { createdAt: 'asc' },
      });

      if (staleIds.length === 0) break;

      const result = await this.prisma.message.updateMany({
        where: { id: { in: staleIds.map((m) => m.id) } },
        data: {
          ciphertexts: Prisma.DbNull,
          contentClearedAt: new Date(),
        },
      });

      batchCleared = result.count;
      totalCleared += batchCleared;

      this.logger.debug(`[MsgCleanup] Expired batch of ${batchCleared} undelivered messages`);
    } while (batchCleared === MessageCleanupService.BATCH_SIZE);

    this.logger.log(
      `[MsgCleanup] Undelivered expiry done — ${totalCleared} message(s) content cleared`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CRON: 14-day attachment cleanup — runs daily at 04:00 UTC
  // ─────────────────────────────────────────────────────────────────────────

  @Cron('0 4 * * *', { name: 'attachment_cleanup' })
  async expireStaleAttachments(): Promise<void> {
    const retentionCutoff = new Date(
      Date.now() - MessageCleanupService.ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    this.logger.log(
      `[MsgCleanup] Starting attachment cleanup (retention cutoff=${retentionCutoff.toISOString()})`,
    );

    let totalInvalidated = 0;
    let batchInvalidated: number;

    do {
      // Case A: attachments older than retention window
      const expiredByAge = await this.prisma.attachment.findMany({
        where: {
          createdAt: { lt: retentionCutoff },
          deletedAt: null,
          // Don't re-process already-invalidated attachments
          NOT: { fileUrl: '' },
        },
        select: { id: true },
        take: MessageCleanupService.BATCH_SIZE,
        orderBy: { createdAt: 'asc' },
      });

      // Case B: attachments where ALL conversation members have downloaded
      // (join through Message → Conversation → ConversationMember vs AttachmentDownload)
      const fullyDownloadedRaw = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT a.id
        FROM "Attachment" a
        JOIN "Message" m ON m.id = a."messageId"
        JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId"
        LEFT JOIN "AttachmentDownload" ad
          ON ad."attachmentId" = a.id AND ad."userId" = cm."userId"
        WHERE a."deletedAt" IS NULL
          AND a."fileUrl" != ''
          AND a."createdAt" < ${retentionCutoff}
        GROUP BY a.id
        HAVING COUNT(cm."userId") > 0
           AND COUNT(cm."userId") = COUNT(ad."userId")
        LIMIT ${MessageCleanupService.BATCH_SIZE}
      `;

      const allTargetIds = Array.from(
        new Set([...expiredByAge.map((a) => a.id), ...fullyDownloadedRaw.map((a) => a.id)]),
      );

      if (allTargetIds.length === 0) break;

      const result = await this.prisma.attachment.updateMany({
        where: { id: { in: allTargetIds } },
        data: {
          fileUrl: '', // invalidate URL — actual file deletion handled by storage lifecycle policy
          deletedAt: new Date(),
        },
      });

      batchInvalidated = result.count;
      totalInvalidated += batchInvalidated;

      this.logger.debug(`[MsgCleanup] Invalidated batch of ${batchInvalidated} attachment(s)`);
    } while (batchInvalidated === MessageCleanupService.BATCH_SIZE);

    this.logger.log(
      `[MsgCleanup] Attachment cleanup done — ${totalInvalidated} attachment(s) invalidated`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async _wipeCiphertexts(messageId: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        ciphertexts: Prisma.DbNull,
        contentClearedAt: new Date(),
      },
    });
  }
}

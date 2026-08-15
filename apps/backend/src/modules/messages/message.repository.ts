import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SendMessageDto, DeliveryStatus } from '@chat/shared-contracts';
import { Prisma } from '@prisma/client';

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMessage(senderUserId: string, senderDeviceId: string, dto: SendMessageDto) {
    return this.prisma.message.create({
      data: {
        conversationId: dto.conversationId,
        senderId: senderUserId,
        senderDeviceId,
        type: dto.type,
        ciphertexts: dto.ciphertexts as unknown as Prisma.JsonObject,
        replyToId: dto.replyToId,
        status: DeliveryStatus.SERVER_RECEIVED,
      },
      include: {
        attachments: true,
      },
    });
  }

  async findMessageById(messageId: string) {
    return this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            members: true,
          },
        },
        attachments: true,
      },
    });
  }

  /**
   * Soft Delete for Everyone (WhatsApp-style):
   * Sets deletedAt, wipes ciphertexts, and soft-deletes attached media references.
   */
  async softDeleteForEveryone(messageId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Soft-delete attachments
      await tx.attachment.updateMany({
        where: { messageId },
        data: { deletedAt: new Date() },
      });

      // 2. Soft-delete message and clear encrypted payloads
      return tx.message.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          ciphertexts: { deleted: true } as unknown as Prisma.JsonObject,
        },
        include: {
          attachments: true,
        },
      });
    });
  }

  /**
   * Soft Delete for Me:
   * Adds the requesting user's ID to deletedForUserIds array.
   */
  async softDeleteForMe(messageId: string, userId: string) {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { deletedForUserIds: true },
    });

    if (!msg) return null;

    const currentList = msg.deletedForUserIds || [];
    if (!currentList.includes(userId)) {
      currentList.push(userId);
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedForUserIds: currentList,
      },
    });
  }

  /**
   * Clear Chat History for a specific user:
   * Sets clearedHistoryAt on ConversationMember.
   */
  async clearConversationHistory(conversationId: string, userId: string) {
    return this.prisma.conversationMember.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: {
        clearedHistoryAt: new Date(),
      },
    });
  }

  /**
   * Fetch paged historical messages with soft delete filters applied.
   */
  async getHistoricalMessages(
    conversationId: string,
    requestingUserId?: string,
    limit = 50,
    cursor?: string,
  ) {
    let clearedHistoryAt: Date | null = null;

    if (requestingUserId) {
      const membership = await this.prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: { conversationId, userId: requestingUserId },
        },
        select: { clearedHistoryAt: true },
      });
      clearedHistoryAt = membership?.clearedHistoryAt || null;
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(clearedHistoryAt ? { createdAt: { gt: clearedHistoryAt } } : {}),
        ...(requestingUserId
          ? {
              NOT: {
                deletedForUserIds: {
                  has: requestingUserId,
                },
              },
            }
          : {}),
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        attachments: {
          where: {
            deletedAt: null,
          },
        },
        reactions: true,
        receipts: true,
      },
    });

    // Format soft-deleted messages for client (shows "This message was deleted")
    return messages.map((msg) => {
      const isDeletedForEveryone = !!msg.deletedAt;
      return {
        ...msg,
        isDeleted: isDeletedForEveryone,
        ciphertexts: isDeletedForEveryone ? { deleted: true } : msg.ciphertexts,
        attachments: isDeletedForEveryone ? [] : msg.attachments,
      };
    });
  }

  async updateReceipt(messageId: string, userId: string, deviceId: string, status: DeliveryStatus) {
    return this.prisma.receipt.upsert({
      where: {
        messageId_userId_deviceId: { messageId, userId, deviceId },
      },
      update: { status: status as any, updatedAt: new Date() },
      create: {
        messageId,
        userId,
        deviceId,
        status: status as any,
      },
    });
  }

  async getConversationMembers(conversationId: string) {
    return this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: {
        userId: true,
        user: {
          select: {
            devices: {
              select: { id: true, deviceId: true },
            },
          },
        },
      },
    });
  }
}

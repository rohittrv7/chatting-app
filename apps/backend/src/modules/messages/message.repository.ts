import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeliveryStatus, ConversationType } from '@chat/shared-contracts';
import { Prisma } from '@prisma/client';

/** Minimal shape expected by createMessage — decoupled from shared-contracts DTO */
interface CreateMessageInput {
  clientMessageId?: string;
  conversationId: string;
  receiverId?: string;
  type: 'TEXT' | 'IMAGE' | 'LOCATION' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'SYSTEM';
  ciphertexts: Prisma.JsonObject | Prisma.JsonArray | any;
  replyToId?: string;
}

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMessage(senderUserId: string, senderDeviceId: string, dto: CreateMessageInput) {
    // 1. Resolve sender — only active users can send messages.
    // Ghost account resurrection guard: if sender is deactivated, findFirst returns null
    // and we throw ForbiddenException instead of creating a new user record (old behaviour).
    const cleanUsernameOrPhone = (senderUserId || '').replace(/^@+/, '');
    const clean10 = cleanUsernameOrPhone.replace(/\D/g, '').slice(-10);
    const user = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { id: senderUserId },
          { username: cleanUsernameOrPhone },
          ...(clean10
            ? [
                { phoneNumber: clean10 },
                { phoneNumber: `+91${clean10}` },
                { phoneNumber: `+${clean10}` },
                { phoneNumber: `91${clean10}` },
              ]
            : []),
          { phoneNumber: cleanUsernameOrPhone },
        ],
      },
    });

    if (!user) {
      // Sender is deactivated or doesn't exist — reject the message.
      // Previously: created a ghost account here, which allowed deactivated users to
      // keep sending messages under a new record. That path is now removed.
      throw new ForbiddenException(`Sender not found or account is deactivated: ${senderUserId}`);
    }

    // 2. Ensure Device exists for the user
    let device = await this.prisma.device.findFirst({
      where: { userId: user.id },
    });

    if (!device) {
      device = await this.prisma.device.create({
        data: {
          userId: user.id,
          deviceId: 1,
          deviceName: 'Mobile App',
          platform: 'android',
        },
      });
    }

    // 3. Ensure Conversation exists in DB
    await this.prisma.conversation.upsert({
      where: { id: dto.conversationId },
      create: {
        id: dto.conversationId,
        type: ConversationType.DIRECT,
      },
      update: {},
    });

    // 4. Ensure sender is a member of this conversation
    await this.prisma.conversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId: dto.conversationId,
          userId: user.id,
        },
      },
      create: {
        conversationId: dto.conversationId,
        userId: user.id,
        role: 'MEMBER',
      },
      update: {},
    });

    // 4b. Ensure receiver is also a member if receiverId is provided
    if ((dto as any).receiverId) {
      const receiverRaw = (dto as any).receiverId;
      const cleanRec = receiverRaw.replace(/^@+/, '');
      const rec10 = cleanRec.replace(/\D/g, '').slice(-10);
      let recUser = await this.prisma.user.findFirst({
        where: {
          isActive: true,
          OR: [
            { id: receiverRaw },
            { username: { equals: cleanRec, mode: 'insensitive' } },
            ...(rec10 ? [{ phoneNumber: rec10 }, { phoneNumber: `+91${rec10}` }] : []),
            { phoneNumber: cleanRec },
          ],
        },
      });

      if (recUser) {
        await this.prisma.conversationMember.upsert({
          where: {
            conversationId_userId: {
              conversationId: dto.conversationId,
              userId: recUser.id,
            },
          },
          create: {
            conversationId: dto.conversationId,
            userId: recUser.id,
            role: 'MEMBER',
          },
          update: {},
        });
      }
    }

    // 4c. Extract participants from direct_a_b conversationId format
    if (dto.conversationId.includes('direct_')) {
      const rawParts = dto.conversationId.replace('room_', '').replace('direct_', '').split('_');
      for (const part of rawParts) {
        if (!part || part === 'me') continue;
        const cleanP = part.replace(/^@+/, '');
        const p10 = cleanP.replace(/\D/g, '').slice(-10);
        const pUser = await this.prisma.user.findFirst({
          where: {
            isActive: true,
            OR: [
              { id: part },
              { username: { equals: cleanP, mode: 'insensitive' } },
              ...(p10 ? [{ phoneNumber: p10 }, { phoneNumber: `+91${p10}` }] : []),
              { phoneNumber: cleanP },
            ],
          },
        });
        if (pUser) {
          await this.prisma.conversationMember.upsert({
            where: {
              conversationId_userId: {
                conversationId: dto.conversationId,
                userId: pUser.id,
              },
            },
            create: {
              conversationId: dto.conversationId,
              userId: pUser.id,
              role: 'MEMBER',
            },
            update: {},
          });
        }
      }
    }

    // 5. Create Message Record
    return this.prisma.message.create({
      data: {
        clientMessageId: dto.clientMessageId,
        conversationId: dto.conversationId,
        senderId: user.id,
        senderDeviceId: device.id,
        type: dto.type,
        ciphertexts: dto.ciphertexts as any,
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
   * Creates a MessageDeletion row (replaces old deletedForUserIds array approach).
   * The @@unique([messageId, userId]) constraint makes this idempotent on retry.
   */
  async softDeleteForMe(messageId: string, userId: string) {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true },
    });

    if (!msg) return null;

    // upsert is safe against concurrent duplicates
    await this.prisma.messageDeletion.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: {}, // already deleted — no-op
    });

    return { id: messageId };
  }

  /**
   * Clear Chat History for a specific user:
   * Sets clearedHistoryAt on ConversationMember and marks messages deleted for user.
   */
  async clearConversationHistory(conversationId: string, userId: string) {
    const clean = (userId || '').replace(/^@+/, '');
    const clean10 = clean.replace(/\D/g, '').slice(-10);
    const dbUser = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { id: userId },
          { username: { equals: clean, mode: 'insensitive' } },
          ...(clean10
            ? [
                { phoneNumber: clean10 },
                { phoneNumber: `+91${clean10}` },
                { phoneNumber: `+${clean10}` },
                { phoneNumber: `91${clean10}` },
              ]
            : []),
          { phoneNumber: clean },
        ],
      },
    });

    const targetUserId = dbUser?.id || userId;
    const cleanConv = conversationId.replace('room_', '');
    const convCandidates = Array.from(new Set([conversationId, cleanConv, `room_${cleanConv}`]));

    // 1. Update clearedHistoryAt on ConversationMember
    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId: { in: convCandidates },
        userId: targetUserId,
      },
      data: {
        clearedHistoryAt: new Date(),
      },
    });

    // FIX: Insert MessageDeletion rows for all messages in this conversation.
    // Uses createMany with skipDuplicates — idempotent and a single DB round-trip.
    const msgs = await this.prisma.message.findMany({
      where: {
        conversationId: { in: convCandidates },
        deletions: { none: { userId: targetUserId } },
      },
      select: { id: true },
    });

    if (msgs.length > 0) {
      await this.prisma.messageDeletion.createMany({
        data: msgs.map((m) => ({ messageId: m.id, userId: targetUserId })),
        skipDuplicates: true,
      });
    }

    return { success: true, message: 'Chat history cleared successfully' };
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
    const cleanConv = conversationId.replace('room_', '');
    const candidateIds = new Set<string>([conversationId, cleanConv, `room_${cleanConv}`]);

    if (conversationId.includes('direct_')) {
      const parts = conversationId.replace('room_', '').replace('direct_', '').split('_');
      if (parts.length >= 2) {
        const u1 = parts[0];
        const u2 = parts[1];
        const dbUsers = await this.prisma.user.findMany({
          where: {
            isActive: true,
            OR: [
              { username: { in: [u1, u2], mode: 'insensitive' } },
              { id: { in: [u1, u2] } },
              { phoneNumber: { in: [u1, u2] } },
            ],
          },
          select: { id: true },
        });
        if (dbUsers.length >= 2) {
          const directConvs = await this.prisma.conversation.findMany({
            where: {
              type: ConversationType.DIRECT,
              members: {
                every: {
                  userId: { in: [dbUsers[0].id, dbUsers[1].id] },
                },
              },
            },
            select: { id: true },
          });
          for (const dc of directConvs) {
            candidateIds.add(dc.id);
          }
        }
      }
    }

    let clearedHistoryAt: Date | null = null;

    if (requestingUserId) {
      const membership = await this.prisma.conversationMember.findFirst({
        where: {
          conversationId: { in: Array.from(candidateIds) },
          userId: requestingUserId,
        },
        select: { clearedHistoryAt: true },
      });
      clearedHistoryAt = membership?.clearedHistoryAt || null;
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: { in: Array.from(candidateIds) },
        ...(clearedHistoryAt ? { createdAt: { gt: clearedHistoryAt } } : {}),
        // FIX: Use MessageDeletion join table instead of array column for O(log n) lookup
        ...(requestingUserId ? { deletions: { none: { userId: requestingUserId } } } : {}),
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        attachments: { where: { deletedAt: null } },
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

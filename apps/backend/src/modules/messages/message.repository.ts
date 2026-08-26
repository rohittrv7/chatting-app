import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeliveryStatus, ConversationType } from '@chat/shared-contracts';
import { Prisma } from '@prisma/client';

/** Minimal shape expected by createMessage — decoupled from shared-contracts DTO */
interface CreateMessageInput {
  clientMessageId?: string;
  conversationId: string;
  receiverId?: string;
  type: 'TEXT' | 'IMAGE' | 'LOCATION' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'SYSTEM';
  ciphertexts: Prisma.JsonObject;
  replyToId?: string;
}

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMessage(senderUserId: string, senderDeviceId: string, dto: CreateMessageInput) {
    // 1. Resolve or ensure sender User exists in DB
    const cleanUsernameOrPhone = (senderUserId || '').replace(/^@+/, '');
    const clean10 = cleanUsernameOrPhone.replace(/\D/g, '').slice(-10);
    let user = await this.prisma.user.findFirst({
      where: {
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
      // Fallback create user if non-existent
      user = await this.prisma.user.create({
        data: {
          id: senderUserId.includes('-') && senderUserId.length === 36 ? senderUserId : undefined,
          phoneNumber: clean10 || cleanUsernameOrPhone || `user_${Date.now()}`,
          username: cleanUsernameOrPhone || `user_${Date.now()}`,
          displayName: cleanUsernameOrPhone || 'User',
        },
      });
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
        type: 'DIRECT',
        createdAt: new Date(),
      },
      update: {
        updatedAt: new Date(),
      },
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

    // 5. Create Message in PostgreSQL
    return this.prisma.message.create({
      data: {
        clientMessageId: dto.clientMessageId,
        conversationId: dto.conversationId,
        senderId: user.id,
        senderDeviceId: device.id,
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
   * Sets clearedHistoryAt on ConversationMember and marks messages deleted for user.
   */
  async clearConversationHistory(conversationId: string, userId: string) {
    const clean = (userId || '').replace(/^@+/, '');
    const clean10 = clean.replace(/\D/g, '').slice(-10);
    const dbUser = await this.prisma.user.findFirst({
      where: {
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

    // 2. Mark existing messages as deleted for this user
    const msgs = await this.prisma.message.findMany({
      where: {
        conversationId: { in: convCandidates },
      },
      select: { id: true, deletedForUserIds: true },
    });

    for (const msg of msgs) {
      const currentList = msg.deletedForUserIds || [];
      if (!currentList.includes(targetUserId)) {
        await this.prisma.message.update({
          where: { id: msg.id },
          data: {
            deletedForUserIds: [...currentList, targetUserId],
          },
        });
      }
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

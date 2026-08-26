import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConversationType, Role } from '@chat/shared-contracts';
// import { ConversationType, Role } from '@prisma/client';

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDirectConversation(userAId: string, userBId: string) {
    const convs = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        members: {
          every: {
            userId: { in: [userAId, userBId] },
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, phoneNumber: true, displayName: true, avatarUrl: true },
            },
          },
        },
      },
    });

    return convs.find((c: (typeof convs)[number]) => c.members.length === 2) || null;
  }

  async createDirectConversation(userAId: string, userBId: string) {
    return this.prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        members: {
          create: [
            { userId: userAId, role: Role.MEMBER },
            { userId: userBId, role: Role.MEMBER },
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, phoneNumber: true, displayName: true, avatarUrl: true },
            },
          },
        },
      },
    });
  }

  async createGroupConversation(
    creatorUserId: string,
    title: string,
    participantUserIds: string[],
  ) {
    const allMembers = Array.from(new Set([creatorUserId, ...participantUserIds]));
    return this.prisma.conversation.create({
      data: {
        type: ConversationType.GROUP,
        title,
        members: {
          create: allMembers.map((uid) => ({
            userId: uid,
            role: uid === creatorUserId ? Role.ADMIN : Role.MEMBER,
          })),
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, phoneNumber: true, displayName: true, avatarUrl: true },
            },
          },
        },
      },
    });
  }

  async listUserConversations(userId: string) {
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

    return this.prisma.conversation.findMany({
      where: {
        members: {
          some: { userId: targetUserId },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                phoneNumber: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                about: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            createdAt: true,
            status: true,
            senderId: true,
            ciphertexts: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findConversationById(conversationId: string) {
    return this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, phoneNumber: true, displayName: true, avatarUrl: true },
            },
          },
        },
      },
    });
  }

  async deleteUserConversation(userId: string, conversationId: string) {
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

    // 1. Remove user from ConversationMember for this conversation so it no longer appears in conversation list
    await this.prisma.conversationMember.deleteMany({
      where: {
        userId: targetUserId,
        conversationId: { in: convCandidates },
      },
    });

    // 2. Mark all existing messages as deleted for this user
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

    return { success: true, message: 'Conversation deleted successfully' };
  }
}

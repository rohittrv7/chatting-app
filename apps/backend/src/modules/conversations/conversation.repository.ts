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

  async createGroupConversation(creatorUserId: string, title: string, participantUserIds: string[]) {
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
    return this.prisma.conversation.findMany({
      where: {
        members: {
          some: { userId },
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
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            createdAt: true,
            status: true,
            senderId: true,
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
}

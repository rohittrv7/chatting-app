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
    });
  }

  async getHistoricalMessages(conversationId: string, limit = 50, cursor?: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        attachments: true,
        reactions: true,
        receipts: true,
      },
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

import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { MessageRepository } from './message.repository';
import { MessageRedisService } from './message-redis.service';
import { SendMessageDto, DeliveryStatus, SocketEvent } from '@chat/shared-contracts';
import { MessageGateway } from './message.gateway';

@Injectable()
export class MessageService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly messageRedisService: MessageRedisService,
    @Optional()
    @Inject(forwardRef(() => MessageGateway))
    private readonly messageGateway?: MessageGateway,
  ) {}

  async handleSendMessage(senderUserId: string, senderDeviceId: string, dto: SendMessageDto) {
    const message = await this.messageRepository.createMessage(senderUserId, senderDeviceId, dto);
    const members = await this.messageRepository.getConversationMembers(dto.conversationId);

    // Cache message in Redis for lightning-fast subsequent fetches
    await this.messageRedisService.cacheMessage(dto.conversationId, {
      ...message,
      clientMessageId: dto.clientMessageId,
      status: DeliveryStatus.SERVER_RECEIVED,
    });

    return {
      message,
      members,
    };
  }

  async getMessages(
    conversationId: string,
    requestingUserId?: string,
    limit = 50,
    cursor?: string,
  ) {
    // Check Redis cache first if no cursor is requested
    if (!cursor) {
      const cached = await this.messageRedisService.getCachedMessages(conversationId, limit);
      if (cached && cached.length > 0) {
        return cached;
      }
    }

    const messages = await this.messageRepository.getHistoricalMessages(
      conversationId,
      requestingUserId,
      limit,
      cursor,
    );

    // Warm up Redis cache with recent messages
    if (!cursor && messages && messages.length > 0) {
      for (const msg of [...messages].reverse()) {
        await this.messageRedisService.cacheMessage(conversationId, msg);
      }
    }

    return messages;
  }

  async updateReceipt(messageId: string, userId: string, deviceId: string, status: DeliveryStatus) {
    const receipt = await this.messageRepository.updateReceipt(messageId, userId, deviceId, status);
    const msg = await this.messageRepository.findMessageById(messageId);
    if (msg) {
      await this.messageRedisService.updateCachedMessageStatus(
        msg.conversationId,
        messageId,
        status,
      );
    }
    return receipt;
  }

  /**
   * Handles soft deletion:
   * - EVERYONE: Marks message deletedAt, removes ciphertext, soft deletes attachments, and broadcasts MESSAGE_DELETED
   * - ME: Adds userId to deletedForUserIds list so it's hidden for the requester only
   */
  async deleteMessage(userId: string, messageId: string, deleteType: 'EVERYONE' | 'ME' = 'ME') {
    const message = await this.messageRepository.findMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (deleteType === 'EVERYONE') {
      // Only message author can delete for everyone
      if (message.senderId !== userId) {
        throw new ForbiddenException('Only the sender can delete a message for everyone');
      }

      const deletedMessage = await this.messageRepository.softDeleteForEveryone(messageId);

      // Broadcast realtime WebSocket event to conversation members
      if (this.messageGateway?.server) {
        const members = await this.messageRepository.getConversationMembers(message.conversationId);
        for (const member of members) {
          this.messageGateway.server.to(`user_${member.userId}`).emit(SocketEvent.MESSAGE_DELETED, {
            messageId,
            conversationId: message.conversationId,
            deletedByUserId: userId,
            deletedAt: deletedMessage.deletedAt?.toISOString(),
          });
        }
      }

      return {
        success: true,
        messageId,
        deleteType: 'EVERYONE',
        isDeleted: true,
      };
    } else {
      // Delete for Me
      await this.messageRepository.softDeleteForMe(messageId, userId);
      return {
        success: true,
        messageId,
        deleteType: 'ME',
        isDeleted: true,
      };
    }
  }

  /**
   * Clear Chat History: soft clears historical messages for the requesting user
   */
  async clearConversationHistory(userId: string, conversationId: string) {
    await this.messageRepository.clearConversationHistory(conversationId, userId);
    return {
      success: true,
      conversationId,
      message: 'Conversation history cleared successfully',
    };
  }
}

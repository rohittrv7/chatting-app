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
import { ChatGateway, EVT_MESSAGE_DELETED } from './message.gateway';

@Injectable()
export class MessageService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly messageRedisService: MessageRedisService,
    @Optional()
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway?: ChatGateway,
  ) {}

  async getMessages(
    conversationId: string,
    requestingUserId?: string,
    limit = 50,
    cursor?: string,
  ) {
    // Check Redis cache first for recent page (no cursor)
    if (!cursor) {
      const cached = await this.messageRedisService.getCachedMessages(conversationId, limit);
      if (cached && cached.length > 0) return cached;
    }

    const messages = await this.messageRepository.getHistoricalMessages(
      conversationId,
      requestingUserId,
      limit,
      cursor,
    );

    // Warm up Redis cache with recent messages
    if (!cursor && messages?.length > 0) {
      for (const msg of [...messages].reverse()) {
        await this.messageRedisService.cacheMessage(conversationId, msg);
      }
    }

    return messages;
  }

  async updateReceipt(messageId: string, userId: string, deviceId: string, status: string) {
    const receipt = await this.messageRepository.updateReceipt(
      messageId,
      userId,
      deviceId,
      status as any,
    );
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
   * Soft delete:
   * - EVERYONE  → marks deletedAt, wipes ciphertexts, broadcasts MESSAGE_DELETED to all members
   * - ME        → adds userId to deletedForUserIds (hidden only for requester)
   */
  async deleteMessage(userId: string, messageId: string, deleteType: 'EVERYONE' | 'ME' = 'ME') {
    const message = await this.messageRepository.findMessageById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    if (deleteType === 'EVERYONE') {
      if (message.senderId !== userId) {
        throw new ForbiddenException('Only the sender can delete a message for everyone');
      }

      const deleted = await this.messageRepository.softDeleteForEveryone(messageId);

      // Broadcast delete event to all conversation members via their personal rooms
      if (this.chatGateway) {
        const members = await this.messageRepository.getConversationMembers(message.conversationId);
        for (const member of members) {
          this.chatGateway.broadcastToUser(member.userId, EVT_MESSAGE_DELETED, {
            messageId,
            conversationId: message.conversationId,
            deletedByUserId: userId,
            deletedAt: deleted.deletedAt?.toISOString(),
          });
        }
      }

      return { success: true, messageId, deleteType: 'EVERYONE', isDeleted: true };
    }

    await this.messageRepository.softDeleteForMe(messageId, userId);
    return { success: true, messageId, deleteType: 'ME', isDeleted: true };
  }

  async clearConversationHistory(userId: string, conversationId: string) {
    await this.messageRepository.clearConversationHistory(conversationId, userId);
    return { success: true, conversationId, message: 'Conversation history cleared successfully' };
  }
}

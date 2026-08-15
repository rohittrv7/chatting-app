import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { MessageRepository } from './message.repository';
import { SendMessageDto, DeliveryStatus, SocketEvent } from '@chat/shared-contracts';
import { MessageGateway } from './message.gateway';

@Injectable()
export class MessageService {
  constructor(
    private readonly messageRepository: MessageRepository,
    @Optional()
    @Inject(forwardRef(() => MessageGateway))
    private readonly messageGateway?: MessageGateway,
  ) {}

  async handleSendMessage(senderUserId: string, senderDeviceId: string, dto: SendMessageDto) {
    const message = await this.messageRepository.createMessage(senderUserId, senderDeviceId, dto);
    const members = await this.messageRepository.getConversationMembers(dto.conversationId);

    return {
      message,
      members,
    };
  }

  async getMessages(
    conversationId: string,
    requestingUserId?: string,
    limit?: number,
    cursor?: string,
  ) {
    return this.messageRepository.getHistoricalMessages(
      conversationId,
      requestingUserId,
      limit,
      cursor,
    );
  }

  async updateReceipt(messageId: string, userId: string, deviceId: string, status: DeliveryStatus) {
    return this.messageRepository.updateReceipt(messageId, userId, deviceId, status);
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

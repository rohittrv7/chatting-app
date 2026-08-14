import { Injectable } from '@nestjs/common';
import { MessageRepository } from './message.repository';
import { SendMessageDto, DeliveryStatus } from '@chat/shared-contracts';

@Injectable()
export class MessageService {
  constructor(private readonly messageRepository: MessageRepository) {}

  async handleSendMessage(senderUserId: string, senderDeviceId: string, dto: SendMessageDto) {
    const message = await this.messageRepository.createMessage(senderUserId, senderDeviceId, dto);
    const members = await this.messageRepository.getConversationMembers(dto.conversationId);

    return {
      message,
      members,
    };
  }

  async getMessages(conversationId: string, limit?: number, cursor?: string) {
    return this.messageRepository.getHistoricalMessages(conversationId, limit, cursor);
  }

  async updateReceipt(messageId: string, userId: string, deviceId: string, status: DeliveryStatus) {
    return this.messageRepository.updateReceipt(messageId, userId, deviceId, status);
  }
}

import { Injectable, BadRequestException } from '@nestjs/common';
import { ConversationRepository } from './conversation.repository';

@Injectable()
export class ConversationService {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  async getOrCreateDirect(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException('Cannot create a direct conversation with yourself');
    }

    const existing = await this.conversationRepository.findDirectConversation(
      currentUserId,
      targetUserId,
    );
    if (existing) return existing;

    return this.conversationRepository.createDirectConversation(currentUserId, targetUserId);
  }

  async createGroup(creatorUserId: string, title: string, participantUserIds: string[]) {
    if (!title || title.trim().length === 0) {
      throw new BadRequestException('Group title is required');
    }
    return this.conversationRepository.createGroupConversation(
      creatorUserId,
      title,
      participantUserIds,
    );
  }

  async listUserConversations(userId: string) {
    return this.conversationRepository.listUserConversations(userId);
  }

  async getConversationById(conversationId: string) {
    return this.conversationRepository.findConversationById(conversationId);
  }

  async deleteConversation(userId: string, conversationId: string) {
    return this.conversationRepository.deleteUserConversation(userId, conversationId);
  }
}

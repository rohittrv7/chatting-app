import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { ConversationRepository } from './conversation.repository';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [ConversationController],
  providers: [ConversationService, ConversationRepository, PrismaService],
  exports: [ConversationService, ConversationRepository],
})
export class ConversationModule {}

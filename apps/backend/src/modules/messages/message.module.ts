import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { MessageGateway } from './message.gateway';
import { MessageRepository } from './message.repository';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [MessageController],
  providers: [MessageService, MessageGateway, MessageRepository, PrismaService],
  exports: [MessageService, MessageGateway, MessageRepository],
})
export class MessageModule {}

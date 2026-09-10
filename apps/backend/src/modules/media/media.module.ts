import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MessageCleanupService } from '../messages/message-cleanup.service';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MessageCleanupService, PrismaService],
  exports: [MediaService],
})
export class MediaModule {}

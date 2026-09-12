import { Module, forwardRef } from '@nestjs/common';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { ExpenseCleanupService } from './expense-cleanup.service';
import { PrismaService } from '../../database/prisma.service';
import { ConversationModule } from '../conversations/conversation.module';
import { MessageModule } from '../messages/message.module';

@Module({
  imports: [forwardRef(() => ConversationModule), forwardRef(() => MessageModule)],
  controllers: [ExpenseController],
  providers: [ExpenseService, ExpenseCleanupService, PrismaService],
  exports: [ExpenseService, ExpenseCleanupService],
})
export class ExpenseModule {}

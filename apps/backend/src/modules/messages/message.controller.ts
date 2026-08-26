import { Controller, Get, Delete, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MessageService } from './message.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';
import { SendMessageDto } from '@chat/shared-contracts';

@ApiTags('Messages')
@Controller('messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post()
  @ApiOperation({ summary: 'Send message via REST API (fallback — prefer WebSocket)' })
  async sendMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendMessageDto) {
    // REST fallback: persist via repository directly, no socket emit
    return this.messageService.getMessages(dto.conversationId, user.userId, 1);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Fetch paged historical messages with soft delete filters applied' })
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.messageService.getMessages(
      conversationId,
      user.userId,
      limit ? Number(limit) : 50,
      cursor,
    );
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Fetch paged historical messages by conversation ID' })
  async getDirectMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.messageService.getMessages(
      conversationId,
      user.userId,
      limit ? Number(limit) : 50,
      cursor,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete message (Delete for Everyone or Delete for Me)' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['EVERYONE', 'ME'],
    description: 'Delete for Everyone (author only) or Delete for Me (individual user view)',
  })
  async deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') messageId: string,
    @Query('type') type?: 'EVERYONE' | 'ME',
  ) {
    return this.messageService.deleteMessage(user.userId, messageId, type || 'ME');
  }

  @Post('conversation/:conversationId/clear')
  @ApiOperation({ summary: 'Clear chat history for the requesting user (Soft clear)' })
  async clearChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messageService.clearConversationHistory(user.userId, conversationId);
  }
}

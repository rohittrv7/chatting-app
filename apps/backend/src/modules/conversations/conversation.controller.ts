import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationService } from './conversation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';
import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @IsNotEmpty()
  type!: 'DIRECT' | 'GROUP';

  @IsString()
  @IsOptional()
  targetUserId?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsArray()
  @IsOptional()
  participantUserIds?: string[];
}

@ApiTags('Conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post()
  @ApiOperation({ summary: 'Create 1:1 or Group conversation' })
  async createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConversationDto,
  ) {
    if (dto.type === 'DIRECT') {
      const targetUserId = dto.targetUserId || dto.participantUserIds?.[0];
      return this.conversationService.getOrCreateDirect(user.userId, targetUserId!);
    } else {
      return this.conversationService.createGroup(
        user.userId,
        dto.title || 'New Group',
        dto.participantUserIds || [],
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'List all active conversations for user' })
  async listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationService.listUserConversations(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific conversation' })
  async getConversation(@Param('id') id: string) {
    return this.conversationService.getConversationById(id);
  }
}

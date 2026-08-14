import { IsString, IsNotEmpty, IsBoolean, IsEnum } from 'class-validator';
import { PresenceStatus } from '../enums/domain.enums';

export class TypingEventDto {
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsBoolean()
  isTyping!: boolean;
}

export class PresenceStatusDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(PresenceStatus)
  status!: PresenceStatus;

  lastSeenAt?: string;
}

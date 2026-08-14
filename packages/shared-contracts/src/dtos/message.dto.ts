import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject, IsNumber } from 'class-validator';
import { MessageType, DeliveryStatus } from '../enums/domain.enums';

export class EncryptedPayloadForDeviceDto {
  @IsString()
  @IsNotEmpty()
  ciphertext!: string;

  @IsNumber()
  type!: number; // Signal Protocol message type (3 = PreKeySignalMessage, 1 = SignalMessage)

  @IsNumber()
  registrationId!: number;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  clientMessageId!: string;

  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @IsEnum(MessageType)
  type!: MessageType;

  @IsObject()
  @IsNotEmpty()
  ciphertexts!: Record<string, EncryptedPayloadForDeviceDto>;

  @IsString()
  @IsOptional()
  replyToId?: string;
}

export class MessageAckDto {
  clientMessageId!: string;
  serverMessageId!: string;
  status!: DeliveryStatus;
  createdAt!: string;
}

export class ReceiveMessageDto {
  serverMessageId!: string;
  conversationId!: string;
  senderId!: string;
  senderDeviceId!: string;
  type!: MessageType;
  ciphertext!: EncryptedPayloadForDeviceDto;
  replyToId?: string;
  createdAt!: string;
}

export class UpdateReceiptDto {
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  @IsEnum(DeliveryStatus)
  status!: DeliveryStatus;
}

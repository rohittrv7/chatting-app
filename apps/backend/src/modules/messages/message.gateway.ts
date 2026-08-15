import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe, Logger, Inject, forwardRef } from '@nestjs/common';
import { MessageService } from './message.service';
import {
  SocketEvent,
  SendMessageDto,
  UpdateReceiptDto,
  DeliveryStatus,
} from '@chat/shared-contracts';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class MessageGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MessageGateway.name);

  constructor(
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
  ) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.query['userId'] as string;
    const deviceId = client.handshake.query['deviceId'] as string;

    if (userId && deviceId) {
      const roomName = `user_${userId}_device_${deviceId}`;
      client.join(roomName);
      client.join(`user_${userId}`);
      this.logger.log(`Client connected: ${client.id} -> Room: ${roomName}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.MESSAGE_SEND)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageDto,
  ) {
    const senderUserId = client.handshake.query['userId'] as string;
    const senderDeviceId = client.handshake.query['deviceId'] as string;

    const { message, members } = await this.messageService.handleSendMessage(
      senderUserId,
      senderDeviceId,
      payload,
    );

    client.emit(SocketEvent.MESSAGE_ACK, {
      clientMessageId: payload.clientMessageId,
      serverMessageId: message.id,
      status: DeliveryStatus.SERVER_RECEIVED,
      createdAt: message.createdAt.toISOString(),
    });

    const ciphertextsMap = payload.ciphertexts as Record<
      string,
      { ciphertext: string; type: number; registrationId: number }
    >;

    for (const member of members) {
      for (const device of member.user.devices) {
        if (member.userId === senderUserId && device.id === senderDeviceId) continue;

        const deviceCiphertext =
          ciphertextsMap[device.deviceId.toString()] || ciphertextsMap[device.id];
        if (deviceCiphertext) {
          const targetRoom = `user_${member.userId}_device_${device.id}`;
          this.server.to(targetRoom).emit(SocketEvent.MESSAGE_RECEIVE, {
            serverMessageId: message.id,
            conversationId: payload.conversationId,
            senderId: senderUserId,
            senderDeviceId,
            type: payload.type,
            ciphertext: deviceCiphertext,
            replyToId: payload.replyToId,
            createdAt: message.createdAt.toISOString(),
          });
        }
      }
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.MESSAGE_RECEIPT_UPDATE)
  async handleReceiptUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UpdateReceiptDto,
  ) {
    const userId = client.handshake.query['userId'] as string;
    const deviceId = client.handshake.query['deviceId'] as string;

    await this.messageService.updateReceipt(payload.messageId, userId, deviceId, payload.status);

    this.server.emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, {
      messageId: payload.messageId,
      userId,
      deviceId,
      status: payload.status,
    });
  }
}

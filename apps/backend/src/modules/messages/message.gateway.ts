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
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageRedisService } from './message-redis.service';
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
    private readonly messageRedisService: MessageRedisService,
  ) {}

  async handleConnection(client: Socket) {
    const userId = (client.handshake.query['userId'] as string) || client.id;
    const deviceId = (client.handshake.query['deviceId'] as string) || '1';

    if (userId) {
      const cleanUserId = userId.replace(/^@+/, '');
      const roomName = `user_${userId}_device_${deviceId}`;
      client.join(roomName);
      client.join(`user_${userId}`);
      client.join(`user_${cleanUserId}`);
      client.join(`user_@${cleanUserId}`);
      this.logger.log(`Client connected: ${client.id} -> User: ${userId}`);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.handshake.query['userId'] as string;
    if (userId) {
      await this.messageRedisService.setUserActiveConversation(userId, null);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Track when a user opens a conversation (for instant READ receipt)
   */
  @SubscribeMessage('chat:open')
  async handleChatOpen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const userId = (client.handshake.query['userId'] as string) || client.id;
    if (userId && payload?.conversationId) {
      client.join(`room_${payload.conversationId}`);
      await this.messageRedisService.setUserActiveConversation(userId, payload.conversationId);
      this.logger.log(`User ${userId} opened chat room_${payload.conversationId}`);
    }
  }

  /**
   * Track when a user closes a conversation
   */
  @SubscribeMessage('chat:close')
  async handleChatClose(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const userId = (client.handshake.query['userId'] as string) || client.id;
    if (userId) {
      if (payload?.conversationId) {
        client.leave(`room_${payload.conversationId}`);
      }
      await this.messageRedisService.setUserActiveConversation(userId, null);
    }
  }

  /**
   * Handle incoming message (Both 1-on-1 direct and E2EE formats)
   */
  @SubscribeMessage(SocketEvent.MESSAGE_SEND)
  @SubscribeMessage('message:send')
  async handleSendMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    const senderUserId =
      (client.handshake.query['userId'] as string) || payload.senderId || client.id;
    const senderDeviceId = (client.handshake.query['deviceId'] as string) || '1';

    const convId = payload.conversationId || 'default_conv';
    const clientMsgId = payload.clientMessageId || `msg_${Date.now()}`;
    const text = payload.text || '';
    const senderName = payload.senderName || 'Anonymous';
    const imagePath = payload.imagePath || undefined;

    let serverMessageId = `srv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    let initialStatus: DeliveryStatus = DeliveryStatus.SERVER_RECEIVED;

    try {
      if (payload.ciphertexts) {
        // E2EE full payload
        const { message, members } = await this.messageService.handleSendMessage(
          senderUserId,
          senderDeviceId,
          payload as SendMessageDto,
        );
        serverMessageId = message.id;
      } else {
        // Direct standard message
        const created = await this.messageService.handleSendMessage(senderUserId, senderDeviceId, {
          clientMessageId: clientMsgId,
          conversationId: convId,
          type: imagePath ? ('IMAGE' as any) : ('TEXT' as any),
          ciphertexts: { text, senderName, imagePath } as any,
        });
        serverMessageId = created.message.id;
      }
    } catch (err) {
      this.logger.warn(`Could not save message to DB immediately, using cache fallback: ${err}`);
      await this.messageRedisService.cacheMessage(convId, {
        id: serverMessageId,
        conversationId: convId,
        senderId: senderUserId,
        senderName,
        text,
        imagePath,
        status: DeliveryStatus.SERVER_RECEIVED,
        createdAt: new Date().toISOString(),
      });
    }

    // 1. Send Single Tick ✓ (SERVER_RECEIVED) acknowledgement back to sender
    const ackPayload = {
      clientMessageId: clientMsgId,
      serverMessageId,
      conversationId: convId,
      status: DeliveryStatus.SERVER_RECEIVED,
      createdAt: new Date().toISOString(),
    };
    client.emit(SocketEvent.MESSAGE_ACK, ackPayload);
    client.emit('message:ack', ackPayload);

    // 2. Broadcast message to recipient(s)
    const receivePayload = {
      serverMessageId,
      conversationId: convId,
      senderId: senderUserId,
      senderName,
      text,
      imagePath,
      createdAt: new Date().toISOString(),
    };

    // Broadcast to the conversation room and target user rooms
    client.to(`room_${convId}`).emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
    client.to(`room_${convId}`).emit('message:receive', receivePayload);

    if (payload.receiverId) {
      this.server
        .to(`user_${payload.receiverId}`)
        .emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`user_${payload.receiverId}`).emit('message:receive', receivePayload);

      // Check if receiver has this chat currently open
      const receiverActiveConv = await this.messageRedisService.getUserActiveConversation(
        payload.receiverId,
      );
      if (receiverActiveConv === convId) {
        // Instant READ Violet Tick (✓✓)
        const readReceipt = {
          messageId: serverMessageId,
          clientMessageId: clientMsgId,
          conversationId: convId,
          status: DeliveryStatus.READ,
        };
        client.emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, readReceipt);
        client.emit('message:receipt', readReceipt);
        await this.messageRedisService.updateCachedMessageStatus(
          convId,
          serverMessageId,
          DeliveryStatus.READ,
        );
      } else {
        // DELIVERED Double Tick (✓✓)
        const deliveredReceipt = {
          messageId: serverMessageId,
          clientMessageId: clientMsgId,
          conversationId: convId,
          status: DeliveryStatus.DELIVERED,
        };
        client.emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, deliveredReceipt);
        client.emit('message:receipt', deliveredReceipt);
        await this.messageRedisService.updateCachedMessageStatus(
          convId,
          serverMessageId,
          DeliveryStatus.DELIVERED,
        );
      }
    } else {
      // Broadcast to room
      this.server.to(`room_${convId}`).emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`room_${convId}`).emit('message:receive', receivePayload);
    }
  }

  /**
   * Handle Receipt Updates (Single Tick ✓ -> Double Tick ✓✓ -> Violet Tick ✓✓)
   */
  @SubscribeMessage(SocketEvent.MESSAGE_RECEIPT_UPDATE)
  @SubscribeMessage('message:receipt')
  async handleReceiptUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; conversationId?: string; status: DeliveryStatus },
  ) {
    const userId = (client.handshake.query['userId'] as string) || client.id;
    const deviceId = (client.handshake.query['deviceId'] as string) || '1';

    try {
      await this.messageService.updateReceipt(payload.messageId, userId, deviceId, payload.status);
    } catch {
      // Ignored if receipt upsert fails
    }

    if (payload.conversationId) {
      await this.messageRedisService.updateCachedMessageStatus(
        payload.conversationId,
        payload.messageId,
        payload.status,
      );
    }

    const receiptPayload = {
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      userId,
      deviceId,
      status: payload.status,
    };

    // Fan-out receipt update to all clients in the conversation
    if (payload.conversationId) {
      this.server
        .to(`room_${payload.conversationId}`)
        .emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, receiptPayload);
      this.server.to(`room_${payload.conversationId}`).emit('message:receipt', receiptPayload);
    } else {
      this.server.emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, receiptPayload);
      this.server.emit('message:receipt', receiptPayload);
    }
  }
}

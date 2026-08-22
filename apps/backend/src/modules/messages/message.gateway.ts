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
  private readonly activeUserSockets = new Map<string, Set<string>>();

  constructor(
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    private readonly messageRedisService: MessageRedisService,
  ) {}

  private registerUserOnline(userId: string, socketId: string) {
    if (!userId) return;
    const clean = userId.replace(/^@+/, '').toLowerCase();
    const keys = [userId.toLowerCase(), clean, `@${clean}`];

    for (const key of keys) {
      if (!this.activeUserSockets.has(key)) {
        this.activeUserSockets.set(key, new Set());
      }
      this.activeUserSockets.get(key)!.add(socketId);
    }

    // Broadcast presence update to all connected clients
    this.server.emit('presence:update', {
      userId,
      username: clean,
      isOnline: true,
    });
  }

  private unregisterUserOnline(userId: string, socketId: string) {
    if (!userId) return;
    const clean = userId.replace(/^@+/, '').toLowerCase();
    const keys = [userId.toLowerCase(), clean, `@${clean}`];
    let isCompletelyOffline = false;

    for (const key of keys) {
      const set = this.activeUserSockets.get(key);
      if (set) {
        set.delete(socketId);
        if (set.size === 0) {
          this.activeUserSockets.delete(key);
          isCompletelyOffline = true;
        }
      }
    }

    if (isCompletelyOffline) {
      this.server.emit('presence:update', {
        userId,
        username: clean,
        isOnline: false,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  public isUserOnline(userId: string): boolean {
    if (!userId) return false;
    const clean = userId.replace(/^@+/, '').toLowerCase();
    return (
      (this.activeUserSockets.get(userId.toLowerCase())?.size ?? 0) > 0 ||
      (this.activeUserSockets.get(clean)?.size ?? 0) > 0 ||
      (this.activeUserSockets.get(`@${clean}`)?.size ?? 0) > 0
    );
  }

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

      this.registerUserOnline(userId, client.id);
      console.log(
        `\x1b[90m[${new Date().toTimeString().split(' ')[0]}]\x1b[0m \x1b[1m\x1b[92m🟢 [SOCKET CONNECTED]\x1b[0m User: \x1b[1m\x1b[97m${userId}\x1b[0m (Socket ID: ${client.id})`,
      );
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.handshake.query['userId'] as string;
    if (userId) {
      await this.messageRedisService.setUserActiveConversation(userId, null);
      this.unregisterUserOnline(userId, client.id);
      console.log(
        `\x1b[90m[${new Date().toTimeString().split(' ')[0]}]\x1b[0m \x1b[1m\x1b[91m🔴 [SOCKET DISCONNECTED]\x1b[0m User: \x1b[1m\x1b[97m${userId}\x1b[0m (Socket ID: ${client.id})`,
      );
    }
  }

  /**
   * Presence query by list of user IDs / handles
   */
  @SubscribeMessage('presence:query')
  async handlePresenceQuery(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userIds: string[] },
  ) {
    const presences: Record<string, { isOnline: boolean }> = {};
    if (payload?.userIds && Array.isArray(payload.userIds)) {
      for (const uid of payload.userIds) {
        presences[uid] = { isOnline: this.isUserOnline(uid) };
      }
    }
    client.emit('presence:result', { presences });
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
  async handleV1SendMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    return this.handleSendMessage(client, payload);
  }

  @SubscribeMessage('message:send')
  async handleDirectSendMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    return this.handleSendMessage(client, payload);
  }

  async handleSendMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    const senderUserId =
      (client.handshake.query['userId'] as string) || payload.senderId || client.id;
    const senderDeviceId = (client.handshake.query['deviceId'] as string) || '1';

    const convId = payload.conversationId || 'default_conv';
    const clientMsgId = payload.clientMessageId || `msg_${Date.now()}`;
    const text = payload.text || '';
    const senderName = payload.senderName || 'Anonymous';
    const imagePath = payload.imagePath || undefined;

    const serverMessageId = `srv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const initialStatus: DeliveryStatus = DeliveryStatus.SERVER_RECEIVED;

    // 1. Send Single Tick ✓ (SERVER_RECEIVED) acknowledgement back to sender immediately
    const ackPayload = {
      clientMessageId: clientMsgId,
      serverMessageId,
      conversationId: convId,
      status: DeliveryStatus.SERVER_RECEIVED,
      createdAt: new Date().toISOString(),
    };
    client.emit(SocketEvent.MESSAGE_ACK, ackPayload);
    client.emit('message:ack', ackPayload);

    // 2. Prepare payload for recipient(s)
    const receivePayload = {
      serverMessageId,
      conversationId: convId,
      senderId: senderUserId,
      senderName,
      text,
      imagePath,
      createdAt: new Date().toISOString(),
    };

    // 3. Broadcast message to recipient(s) and conversation rooms immediately
    console.log(
      `\x1b[90m[${new Date().toTimeString().split(' ')[0]}]\x1b[0m \x1b[1m\x1b[95m💬 [SOCKET MESSAGE]\x1b[0m \x1b[97mFrom: ${senderName} (@${senderUserId}) -> To: ${payload.receiverId || 'Room ' + convId}\x1b[0m | \x1b[93m"${text}"\x1b[0m`,
    );

    client.to(`room_${convId}`).emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
    client.to(`room_${convId}`).emit('message:receive', receivePayload);

    if (payload.receiverId) {
      const cleanReceiver = payload.receiverId.replace(/^@+/, '');
      this.server
        .to(`user_${payload.receiverId}`)
        .emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`user_${payload.receiverId}`).emit('message:receive', receivePayload);

      this.server.to(`user_${cleanReceiver}`).emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`user_${cleanReceiver}`).emit('message:receive', receivePayload);

      this.server.to(`user_@${cleanReceiver}`).emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`user_@${cleanReceiver}`).emit('message:receive', receivePayload);

      this.server
        .to(`user_${cleanReceiver.toLowerCase()}`)
        .emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`user_${cleanReceiver.toLowerCase()}`).emit('message:receive', receivePayload);

      this.server
        .to(`user_@${cleanReceiver.toLowerCase()}`)
        .emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server
        .to(`user_@${cleanReceiver.toLowerCase()}`)
        .emit('message:receive', receivePayload);
    } else {
      this.server.to(`room_${convId}`).emit(SocketEvent.MESSAGE_RECEIVE, receivePayload);
      this.server.to(`room_${convId}`).emit('message:receive', receivePayload);
    }

    // 4. Check recipient read/delivered status
    if (payload.receiverId) {
      this.messageRedisService
        .getUserActiveConversation(payload.receiverId)
        .then((receiverActiveConv) => {
          if (receiverActiveConv === convId) {
            const readReceipt = {
              messageId: serverMessageId,
              clientMessageId: clientMsgId,
              conversationId: convId,
              status: DeliveryStatus.READ,
            };
            client.emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, readReceipt);
            client.emit('message:receipt', readReceipt);
            this.messageRedisService.updateCachedMessageStatus(
              convId,
              serverMessageId,
              DeliveryStatus.READ,
            );
          } else {
            const deliveredReceipt = {
              messageId: serverMessageId,
              clientMessageId: clientMsgId,
              conversationId: convId,
              status: DeliveryStatus.DELIVERED,
            };
            client.emit(SocketEvent.MESSAGE_RECEIPT_UPDATE, deliveredReceipt);
            client.emit('message:receipt', deliveredReceipt);
            this.messageRedisService.updateCachedMessageStatus(
              convId,
              serverMessageId,
              DeliveryStatus.DELIVERED,
            );
          }
        })
        .catch(() => {});
    }

    // 5. Persist to PostgreSQL Database and cache to Redis in parallel
    (async () => {
      try {
        if (payload.ciphertexts) {
          await this.messageService.handleSendMessage(
            senderUserId,
            senderDeviceId,
            payload as SendMessageDto,
          );
        } else {
          await this.messageService.handleSendMessage(senderUserId, senderDeviceId, {
            clientMessageId: clientMsgId,
            conversationId: convId,
            type: imagePath ? ('IMAGE' as any) : ('TEXT' as any),
            ciphertexts: { text, senderName, imagePath } as any,
            receiverId: payload.receiverId,
          } as any);
        }
      } catch (err) {
        this.logger.warn(`Could not save message to DB immediately, caching to Redis: ${err}`);
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
    })();
  }

  /**
   * Handle Receipt Updates (Single Tick ✓ -> Double Tick ✓✓ -> Violet Tick ✓✓)
   */
  @SubscribeMessage(SocketEvent.MESSAGE_RECEIPT_UPDATE)
  async handleV1ReceiptUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; conversationId?: string; status: DeliveryStatus },
  ) {
    return this.handleReceiptUpdate(client, payload);
  }

  @SubscribeMessage('message:receipt')
  async handleDirectReceiptUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; conversationId?: string; status: DeliveryStatus },
  ) {
    return this.handleReceiptUpdate(client, payload);
  }

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

    console.log(
      `\x1b[90m[${new Date().toTimeString().split(' ')[0]}]\x1b[0m \x1b[1m\x1b[96m👁️ [RECEIPT UPDATE]\x1b[0m User: \x1b[97m${userId}\x1b[0m -> Status: \x1b[1m\x1b[93m${payload.status}\x1b[0m | MsgId: ${payload.messageId}`,
    );

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

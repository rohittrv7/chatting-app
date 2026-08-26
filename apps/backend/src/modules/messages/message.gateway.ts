import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import { MessageRepository } from './message.repository';
import { MessageRedisService } from './message-redis.service';
import { PrismaService } from '../../database/prisma.service';
import { ConversationService } from '../conversations/conversation.service';

// ─── Event name constants (single source of truth) ───────────────────────────
// Client → Server
export const EVT_MESSAGE_SEND = 'message:send';
export const EVT_MESSAGE_RECEIPT = 'message:receipt';
export const EVT_TYPING = 'typing';
export const EVT_PRESENCE_QUERY = 'presence:query';
export const EVT_CHAT_OPEN = 'chat:open';
export const EVT_CHAT_CLOSE = 'chat:close';

// Server → Client
export const EVT_MESSAGE_NEW = 'message:new'; // receiver gets new message
export const EVT_MESSAGE_ACK = 'message:ack'; // sender gets confirmation + DB id
export const EVT_RECEIPT_UPDATE = 'message:receipt'; // delivered / read tick update
export const EVT_TYPING_UPDATE = 'typing:update';
export const EVT_PRESENCE_UPDATE = 'presence:update';
export const EVT_PRESENCE_RESULT = 'presence:result';
export const EVT_MESSAGE_DELETED = 'message:deleted';
export const EVT_MISSED_MESSAGES = 'messages:missed'; // offline gap fill on reconnect

/**
 * ONE gateway, ONE namespace, ONE source of truth.
 *
 * Architecture:
 *  - JWT verified on every connect — unauthenticated sockets are disconnected immediately.
 *  - Each user joins a personal room  user:<userId>  on connect.
 *  - message:send  → synchronous DB write → emit message:new to receiver → emit message:ack to sender.
 *    The DB write is BLOCKING (awaited) before any emit, guaranteeing durability.
 *  - clientMessageId has a DB unique constraint per sender — retried sends are idempotent.
 *  - On reconnect the client sends its lastMessageId and we deliver any missed messages.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/',
  transports: ['websocket'],
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  /** userId → Set<socketId> — in-process presence tracking */
  private readonly onlineSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly messageRepo: MessageRepository,
    private readonly redis: MessageRedisService,
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Init — attach Redis adapter so the gateway works across multiple instances
  // ─────────────────────────────────────────────────────────────────────────

  afterInit(server: Server) {
    // Redis adapter is attached here only if Redis is available.
    // Falls back gracefully to in-memory if Redis is offline (dev mode).
    this.redis
      .getPubSubClients()
      .then(({ pub, sub }) => {
        if (pub && sub) {
          server.adapter(createAdapter(pub, sub));
          this.logger.log('✅ Socket.IO Redis adapter attached');
        } else {
          this.logger.warn(
            '⚠️  Redis unavailable — using in-memory adapter (single instance only)',
          );
        }
      })
      .catch(() => {
        this.logger.warn('⚠️  Redis unavailable — using in-memory adapter (single instance only)');
      });

    this.logger.log('🚀 ChatGateway initialised');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection — verify JWT, join personal room, deliver missed messages
  // ─────────────────────────────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      // Token from  socket.io-client:  io(url, { auth: { token } })
      const token =
        (client.handshake.auth as any)?.token ||
        (client.handshake.headers?.authorization || '').replace('Bearer ', '').trim();

      if (!token) {
        this.logger.warn(`🔴 No token — disconnecting ${client.id}`);
        client.disconnect(true);
        return;
      }

      let payload: { sub: string; deviceId: string };
      try {
        payload = this.jwtService.verify(token);
      } catch {
        this.logger.warn(`🔴 Invalid token — disconnecting ${client.id}`);
        client.disconnect(true);
        return;
      }

      const userId = payload.sub;
      (client as any)._userId = userId;
      (client as any)._deviceId = payload.deviceId;

      // Personal room — all messages for this user land here
      client.join(`user:${userId}`);
      this._markOnline(userId, client.id);

      // Broadcast online presence to everyone
      this.server.emit(EVT_PRESENCE_UPDATE, { userId, isOnline: true, lastSeen: null });

      this.logger.log(`🟢 CONNECTED  uid=${userId}  socket=${client.id}`);

      // ── Deliver missed messages (gap fill after reconnect) ────────────────
      const lastId = (client.handshake.auth as any)?.lastMessageId as string | undefined;
      if (lastId) {
        await this._deliverMissedMessages(client, userId, lastId);
      }
    } catch (err) {
      this.logger.error(`Connection error: ${err}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId: string | undefined = (client as any)._userId;
    if (!userId) return;

    await this.redis.setUserActiveConversation(userId, null);
    const wentOffline = this._markOffline(userId, client.id);

    if (wentOffline) {
      const lastSeen = new Date().toISOString();
      await this.redis.setLastSeen(userId, lastSeen);
      this.server.emit(EVT_PRESENCE_UPDATE, { userId, isOnline: false, lastSeen });
    }

    this.logger.log(`🔴 DISCONNECTED  uid=${userId}  socket=${client.id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // message:send  — the critical path
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage(EVT_MESSAGE_SEND)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      clientMessageId: string;
      conversationId: string;
      receiverId: string; // DB UUID of recipient — mandatory
      text?: string;
      imagePath?: string;
      location?: { lat: number; lng: number; label?: string };
      type?: string;
    },
  ) {
    const senderId: string = (client as any)._userId;
    const deviceId: string = (client as any)._deviceId ?? '1';

    if (!senderId) return;
    if (!payload?.clientMessageId || !payload?.conversationId || !payload?.receiverId) {
      client.emit(EVT_MESSAGE_ACK, {
        clientMessageId: payload?.clientMessageId,
        error: 'Missing required fields: clientMessageId, conversationId, receiverId',
      });
      return;
    }

    const { clientMessageId, text, imagePath, location } = payload;
    const msgType = imagePath ? 'IMAGE' : location ? 'LOCATION' : 'TEXT';

    // ── Resolve receiverId: must be a DB UUID ─────────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let receiverId = payload.receiverId;

    if (!UUID_RE.test(receiverId)) {
      // receiverId is not a UUID — try to resolve from conversation members first
      const members = await this.prisma.conversationMember
        .findMany({
          where: { conversationId: payload.conversationId },
          select: { userId: true },
        })
        .catch(() => [] as { userId: string }[]);
      const otherMember = members.find((m) => m.userId !== senderId);
      if (!otherMember) {
        // Try to find user by username / phone
        const resolved = await this.prisma.user
          .findFirst({
            where: {
              OR: [
                { username: { equals: receiverId.replace(/^@/, ''), mode: 'insensitive' } },
                { phoneNumber: receiverId.replace(/\D/g, '').slice(-10) || receiverId },
              ],
            },
            select: { id: true },
          })
          .catch(() => null);
        if (!resolved) {
          client.emit(EVT_MESSAGE_ACK, { clientMessageId, error: 'Recipient not found' });
          return;
        }
        receiverId = resolved.id;
      } else {
        receiverId = otherMember.userId;
      }
    }

    // ── Resolve conversationId: must be a real DB UUID ────────────────────
    // If client sends a string like "direct_riyal_rohit", auto-create / find the real conv.
    let conversationId = payload.conversationId;

    if (!UUID_RE.test(conversationId)) {
      try {
        const conv = await this.conversationService.getOrCreateDirect(senderId, receiverId);
        conversationId = conv.id;
      } catch {
        client.emit(EVT_MESSAGE_ACK, { clientMessageId, error: 'Could not create conversation' });
        return;
      }
    }

    // ── STEP 1: Synchronous DB write (blocking — durability first) ────────
    let savedMessage: any;
    try {
      savedMessage = await this.messageRepo.createMessage(senderId, deviceId, {
        clientMessageId,
        conversationId,
        receiverId,
        type: msgType as any,
        ciphertexts: { text: text ?? '', imagePath, location } as any,
      });
    } catch (err: any) {
      // Idempotency: if clientMessageId already exists for this sender, fetch existing row
      if (err?.code === 'P2002') {
        savedMessage = await this.prisma.message.findFirst({
          where: { senderId, clientMessageId },
        });
        if (!savedMessage) {
          client.emit(EVT_MESSAGE_ACK, {
            clientMessageId,
            error: 'Duplicate message, original not found',
          });
          return;
        }
      } else {
        this.logger.error(`DB write failed for ${clientMessageId}: ${err?.message}`);
        client.emit(EVT_MESSAGE_ACK, { clientMessageId, error: 'Failed to save message' });
        return;
      }
    }

    const serverMessageId = savedMessage.id;
    const createdAt = savedMessage.createdAt?.toISOString() ?? new Date().toISOString();

    let senderProfile: {
      displayName?: string | null;
      username?: string | null;
      avatarUrl?: string | null;
      phoneNumber?: string | null;
    } | null = null;
    try {
      senderProfile = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { displayName: true, username: true, avatarUrl: true, phoneNumber: true },
      });
    } catch {
      /* non-critical */
    }

    // ── STEP 2: Build the canonical message payload ───────────────────────
    const messagePayload = {
      serverMessageId,
      clientMessageId,
      conversationId,
      senderId,
      receiverId,
      senderName: senderProfile?.displayName ?? undefined,
      senderUsername: senderProfile?.username ?? undefined,
      senderAvatarUrl: senderProfile?.avatarUrl ?? undefined,
      senderPhone: senderProfile?.phoneNumber ?? undefined,
      text: text ?? '',
      imagePath,
      location,
      type: msgType,
      status: 'SERVER_RECEIVED',
      createdAt,
    };

    // ── STEP 3: Emit to receiver's personal room ──────────────────────────
    // This happens in the same tick as the DB write resolving — zero delay.
    this.server.to(`user:${receiverId}`).emit(EVT_MESSAGE_NEW, {
      ...messagePayload,
      status: 'DELIVERED',
    });

    // ── STEP 4: Ack back to sender (single grey tick → confirmed in DB) ───
    client.emit(EVT_MESSAGE_ACK, {
      clientMessageId,
      serverMessageId,
      conversationId,
      status: 'SERVER_RECEIVED',
      createdAt,
    });

    // ── STEP 5: Update delivery status based on receiver online state ─────
    // Fire-and-forget — status updates never block the critical send path
    process.nextTick(async () => {
      try {
        const isReceiverOnline = this._isOnline(receiverId);

        if (isReceiverOnline) {
          // Receiver is online — message was delivered, send double-tick to sender
          await this.prisma.message.update({
            where: { id: serverMessageId },
            data: { status: 'DELIVERED' as any },
          });
          client.emit(EVT_RECEIPT_UPDATE, {
            serverMessageId,
            clientMessageId,
            conversationId,
            status: 'DELIVERED',
          });

          // Check if receiver currently has this conversation open (auto-READ)
          const activeConv = await this.redis.getUserActiveConversation(receiverId);
          if (activeConv === conversationId) {
            await this.prisma.message.update({
              where: { id: serverMessageId },
              data: { status: 'READ' as any },
            });
            client.emit(EVT_RECEIPT_UPDATE, {
              serverMessageId,
              clientMessageId,
              conversationId,
              status: 'READ',
            });
          }
        }
        // If receiver is offline, message stays SENT in DB.
        // It will be delivered via _deliverMissedMessages when they reconnect.
      } catch {
        /* non-critical — never throw from nextTick */
      }
    });

    this.logger.log(
      `💬 MSG  from=${senderId}  to=${receiverId}  conv=${conversationId}  id=${serverMessageId}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // message:receipt  — DELIVERED / READ update from receiver
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage(EVT_MESSAGE_RECEIPT)
  async handleReceipt(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      serverMessageId: string;
      conversationId: string;
      status: 'DELIVERED' | 'READ';
    },
  ) {
    const userId: string = (client as any)._userId;
    if (!userId || !payload?.serverMessageId) return;

    const { serverMessageId, conversationId, status } = payload;

    // Persist receipt & update message status
    try {
      await this.prisma.message.update({
        where: { id: serverMessageId },
        data: { status: status as any },
      });
    } catch {
      /* message may not exist yet — safe to ignore */
    }
    // Fan-out receipt to the sender of this message
    try {
      const msg = await this.prisma.message.findUnique({
        where: { id: serverMessageId },
        select: { senderId: true },
      });
      if (msg?.senderId) {
        this.server.to(`user:${msg.senderId}`).emit(EVT_RECEIPT_UPDATE, {
          serverMessageId,
          conversationId,
          status,
          byUserId: userId,
        });
      }
    } catch {
      /* non-critical */
    }

    this.logger.log(`👁  RECEIPT  uid=${userId}  msg=${serverMessageId}  status=${status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // typing  — typing indicator
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage(EVT_TYPING)
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; receiverId: string; isTyping: boolean },
  ) {
    const userId: string = (client as any)._userId;
    if (!userId || !payload?.receiverId) return;

    this.server.to(`user:${payload.receiverId}`).emit(EVT_TYPING_UPDATE, {
      conversationId: payload.conversationId,
      senderId: userId,
      isTyping: payload.isTyping,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // presence:query  — batch online status request
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage(EVT_PRESENCE_QUERY)
  async handlePresenceQuery(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userIds: string[] },
  ) {
    if (!Array.isArray(payload?.userIds) || payload.userIds.length === 0) return;

    const lastSeenMap = await this.redis.getLastSeenBatch(payload.userIds);
    const presences: Record<string, { isOnline: boolean; lastSeen: string | null }> = {};

    for (const uid of payload.userIds) {
      const isOnline = this._isOnline(uid);
      presences[uid] = { isOnline, lastSeen: isOnline ? null : (lastSeenMap[uid] ?? null) };
    }

    client.emit(EVT_PRESENCE_RESULT, { presences });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // chat:open / chat:close  — track active conversation for auto-READ
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage(EVT_CHAT_OPEN)
  async handleChatOpen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const userId: string = (client as any)._userId;
    if (!userId || !payload?.conversationId) return;
    await this.redis.setUserActiveConversation(userId, payload.conversationId);
  }

  @SubscribeMessage(EVT_CHAT_CLOSE)
  async handleChatClose(@ConnectedSocket() client: Socket) {
    const userId: string = (client as any)._userId;
    if (!userId) return;
    await this.redis.setUserActiveConversation(userId, null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public helpers (used by MessageService for delete broadcast)
  // ─────────────────────────────────────────────────────────────────────────

  isUserOnline(userId: string): boolean {
    return this._isOnline(userId);
  }

  broadcastToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _isOnline(userId: string): boolean {
    return (this.onlineSockets.get(userId)?.size ?? 0) > 0;
  }

  private _markOnline(userId: string, socketId: string): void {
    if (!this.onlineSockets.has(userId)) this.onlineSockets.set(userId, new Set());
    this.onlineSockets.get(userId)!.add(socketId);
  }

  /** Returns true if the user has zero sockets left (fully offline). */
  private _markOffline(userId: string, socketId: string): boolean {
    const set = this.onlineSockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
      this.onlineSockets.delete(userId);
      return true;
    }
    return false;
  }

  /**
   * Deliver all SENT (undelivered) messages addressed to userId that arrived
   * after lastMessageId. Called on reconnect to fill the offline gap.
   */
  private async _deliverMissedMessages(
    client: Socket,
    userId: string,
    lastMessageId: string,
  ): Promise<void> {
    try {
      // Find the createdAt of the last known message
      const lastMsg = await this.prisma.message.findUnique({
        where: { id: lastMessageId },
        select: { createdAt: true },
      });

      const since = lastMsg?.createdAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Find messages in conversations the user is a member of, newer than lastMsg
      const missed = await this.prisma.message.findMany({
        where: {
          conversation: {
            members: { some: { userId } },
          },
          senderId: { not: userId }, // don't re-deliver own messages
          status: { in: ['SERVER_RECEIVED' as any] },
          createdAt: { gt: since },
          deletedAt: null,
          NOT: { deletedForUserIds: { has: userId } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          clientMessageId: true,
          conversationId: true,
          senderId: true,
          ciphertexts: true,
          type: true,
          status: true,
          createdAt: true,
          sender: {
            select: { displayName: true, username: true, avatarUrl: true, phoneNumber: true },
          },
        },
      });

      if (missed.length === 0) return;

      // Deliver each missed message to the reconnected client
      for (const msg of missed) {
        const ct = msg.ciphertexts as any;
        client.emit(EVT_MESSAGE_NEW, {
          serverMessageId: msg.id,
          clientMessageId: msg.clientMessageId,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          receiverId: userId,
          senderName: (msg as any).sender?.displayName,
          senderUsername: (msg as any).sender?.username,
          senderAvatarUrl: (msg as any).sender?.avatarUrl,
          senderPhone: (msg as any).sender?.phoneNumber,
          text: ct?.text ?? '',
          imagePath: ct?.imagePath,
          location: ct?.location,
          type: msg.type,
          status: 'DELIVERED',
          createdAt: msg.createdAt.toISOString(),
          isMissed: true,
        });
      }

      this.logger.log(`📬 Delivered ${missed.length} missed messages to uid=${userId}`);
    } catch (err) {
      this.logger.warn(`Failed to deliver missed messages: ${err}`);
    }
  }
}

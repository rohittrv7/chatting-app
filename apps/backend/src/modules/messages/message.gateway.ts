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
import { Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import { MessageRepository } from './message.repository';
import { MessageRedisService } from './message-redis.service';
import { PrismaService } from '../../database/prisma.service';
import { ConversationService } from '../conversations/conversation.service';
import { OtelService } from '../observability/otel.service';
import { PushNotificationService } from './push-notification.service';
import { MessageCleanupService } from './message-cleanup.service';

// ─── Event name constants (single source of truth) ───────────────────────────
// Client → Server
export const EVT_MESSAGE_SEND = 'message:send';
export const EVT_MESSAGE_RECEIPT = 'message:receipt';
export const EVT_TYPING = 'typing';
export const EVT_PRESENCE_QUERY = 'presence:query';
export const EVT_CHAT_OPEN = 'chat:open';
export const EVT_CHAT_CLOSE = 'chat:close';

// WebRTC Signaling Events
export const EVT_CALL_INITIATE = 'call:initiate';
export const EVT_CALL_INCOMING = 'call:incoming';
export const EVT_CALL_ACCEPT = 'call:accept';
export const EVT_CALL_ACCEPTED = 'call:accepted';
export const EVT_CALL_REJECT = 'call:reject';
export const EVT_CALL_END = 'call:end';
export const EVT_CALL_ENDED = 'call:ended';
export const EVT_CALL_BUSY = 'call:busy';
export const EVT_WEBRTC_OFFER = 'webrtc:offer';
export const EVT_WEBRTC_ANSWER = 'webrtc:answer';
export const EVT_WEBRTC_ICE_CANDIDATE = 'webrtc:ice-candidate';
export const EVT_CALL_SWITCH_VIDEO = 'call:switch-to-video';

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
  transports: ['polling', 'websocket'],
  maxHttpBufferSize: 5e7, // 50MB buffer to prevent transport close on high-res video/audio streaming
  pingTimeout: 20000,
  pingInterval: 10000,
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  /** userId → Set<socketId> — in-process presence tracking */
  private readonly onlineSockets = new Map<string, Set<string>>();
  private readonly activeCalls = new Map<
    string,
    { callId: string; callerId: string; receiverId: string }
  >();
  private readonly cancelledCallIds = new Set<string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly messageRepo: MessageRepository,
    private readonly redis: MessageRedisService,
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly messageCleanupService: MessageCleanupService,
    @Optional() private readonly otelService?: OtelService,
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
      // Check user's lastSeenVisibility setting before broadcasting
      const userSetting = await this.prisma.setting
        .findUnique({
          where: { userId },
          select: { lastSeenVisibility: true },
        })
        .catch(() => null);
      const broadcastLastSeen = userSetting?.lastSeenVisibility === 'NOBODY' ? null : lastSeen;

      const connectedSockets = Array.from(this.server?.sockets?.sockets?.values() || []);
      const recipientUserIds = Array.from(
        new Set(connectedSockets.map((s: any) => s._userId).filter(Boolean)),
      );

      if (broadcastLastSeen && recipientUserIds.length > 0) {
        const recipientSettings = await this.prisma.setting
          .findMany({
            where: { userId: { in: recipientUserIds } },
            select: { userId: true, lastSeenVisibility: true },
          })
          .catch(() => []);
        const recipientPrivacyMap = new Map(
          recipientSettings.map((s) => [s.userId, s.lastSeenVisibility]),
        );

        for (const sock of connectedSockets) {
          const rUid = (sock as any)._userId;
          if (!rUid) continue;
          const rHides = recipientPrivacyMap.get(rUid) === 'NOBODY';
          const payloadLastSeen = rHides ? null : broadcastLastSeen;
          sock.emit(EVT_PRESENCE_UPDATE, { userId, isOnline: false, lastSeen: payloadLastSeen });
        }
      } else {
        this.server.emit(EVT_PRESENCE_UPDATE, { userId, isOnline: false, lastSeen: null });
      }
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
      document?: { uri: string; name: string; size?: number | string; mimeType?: string };
      contact?: { name: string; phone: string; username?: string };
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

    const { clientMessageId, text, imagePath, location, document, contact } = payload;
    const msgType =
      payload.type ||
      (imagePath ? 'IMAGE' : location ? 'LOCATION' : document ? 'DOCUMENT' : 'TEXT');

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

    // ── Enforce strict 1-to-1 conversation isolation ──────────────────────
    // Regardless of what temporary ID client sent, lock 1-to-1 direct chat to verified DB conversation UUID
    let conversationId = payload.conversationId;
    try {
      const conv = await this.conversationService.getOrCreateDirect(senderId, receiverId);
      if (conv?.id) {
        conversationId = conv.id;
      }
    } catch {
      if (!UUID_RE.test(conversationId)) {
        client.emit(EVT_MESSAGE_ACK, { clientMessageId, error: 'Could not create conversation' });
        return;
      }
    }

    const mediaSize = (payload as any).mediaSize || (payload as any).fileSize;
    let extractedText = typeof text === 'string' ? text : '';
    const rawCiphertexts = (payload as any).ciphertexts;
    if (!extractedText && rawCiphertexts) {
      if (
        typeof rawCiphertexts === 'object' &&
        !Array.isArray(rawCiphertexts) &&
        rawCiphertexts.text
      ) {
        extractedText = rawCiphertexts.text;
      } else if (Array.isArray(rawCiphertexts) && rawCiphertexts[0]?.ciphertext) {
        extractedText = rawCiphertexts[0].ciphertext;
      }
    }

    const ciphertexts = rawCiphertexts || {
      text: extractedText,
      imagePath,
      location,
      document,
      contact,
      mediaSize,
    };

    // ── STEP 1: Synchronous DB write (blocking — durability first) ────────
    let savedMessage: any;
    try {
      savedMessage = await this.messageRepo.createMessage(senderId, deviceId, {
        clientMessageId,
        conversationId,
        receiverId,
        type: msgType as any,
        ciphertexts: ciphertexts as any,
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

    // If message contains a media attachment, persist an Attachment row for download tracking & cleanup
    if (imagePath || document?.uri) {
      const mediaUrl = imagePath || document?.uri || '';
      const fileName = document?.name || (msgType === 'AUDIO' ? 'voice_note.m4a' : 'media.jpg');
      this.prisma.attachment
        .create({
          data: {
            messageId: serverMessageId,
            fileUrl: mediaUrl,
            fileName,
            fileSize: typeof mediaSize === 'number' ? mediaSize : parseInt(mediaSize, 10) || 0,
            mimeType: document?.mimeType || (msgType === 'AUDIO' ? 'audio/m4a' : 'image/jpeg'),
          },
        })
        .catch((attErr) => this.logger.warn(`Failed to create Attachment row: ${attErr?.message}`));
    }

    let senderProfile: {
      displayName?: string | null;
      username?: string | null;
      avatarUrl?: string | null;
      phoneNumber?: string | null;
    } | null = null;
    try {
      senderProfile = await this.prisma.user.findFirst({
        where: { id: senderId, isActive: true },
        select: { displayName: true, username: true, avatarUrl: true, phoneNumber: true },
      });
    } catch {
      /* non-critical */
    }

    // ── STEP 2: Build the canonical message payload ───────────────────────
    let effectiveSenderAvatar = senderProfile?.avatarUrl ?? undefined;
    if (effectiveSenderAvatar) {
      const senderSetting = await this.prisma.setting
        .findUnique({
          where: { userId: senderId },
          select: { profilePhotoVis: true },
        })
        .catch(() => null);
      if (senderSetting?.profilePhotoVis === 'NOBODY') {
        effectiveSenderAvatar = undefined;
      }
    }

    const messagePayload = {
      serverMessageId,
      clientMessageId,
      conversationId,
      senderId,
      receiverId,
      senderName: senderProfile?.displayName ?? undefined,
      senderUsername: senderProfile?.username ?? undefined,
      senderAvatarUrl: effectiveSenderAvatar,
      senderPhone: senderProfile?.phoneNumber ?? undefined,
      ciphertexts,
      text: extractedText,
      imagePath,
      location,
      document,
      contact,
      mediaSize,
      type: msgType,
      status: 'SERVER_RECEIVED',
      createdAt,
    };

    // ── Check if receiver has blocked sender (WhatsApp block enforcement) ──
    const isBlockedByReceiver = await this.prisma.blockedUser.findFirst({
      where: { blockerId: receiverId, blockedId: senderId },
    });

    if (!isBlockedByReceiver) {
      // ── STEP 3: Emit to receiver's personal room ──────────────────────────
      this.server.to(`user:${receiverId}`).emit(EVT_MESSAGE_NEW, {
        ...messagePayload,
        status: 'DELIVERED',
      });
      this.otelService?.recordSocketEvent(EVT_MESSAGE_NEW, receiverId);
    }

    // ── STEP 4: Ack back to sender (single grey tick → confirmed in DB) ───
    client.emit(EVT_MESSAGE_ACK, {
      clientMessageId,
      serverMessageId,
      conversationId,
      status: 'SERVER_RECEIVED',
      createdAt,
    });
    this.otelService?.recordSocketEvent(EVT_MESSAGE_ACK, senderId);

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

          // Record DELIVERED receipt for receiver in Receipt table
          await this.prisma.receipt
            .upsert({
              where: {
                messageId_userId_deviceId: {
                  messageId: serverMessageId,
                  userId: receiverId,
                  deviceId: '1',
                },
              },
              create: {
                messageId: serverMessageId,
                userId: receiverId,
                deviceId: '1',
                status: 'DELIVERED',
              },
              update: {
                status: 'DELIVERED',
                updatedAt: new Date(),
              },
            })
            .catch(() => {});

          // Trigger ciphertext wipe check since message was delivered
          this.messageCleanupService.clearCiphertextsAfterDelivery(serverMessageId).catch(() => {});

          client.emit(EVT_RECEIPT_UPDATE, {
            serverMessageId,
            clientMessageId,
            conversationId,
            status: 'DELIVERED',
          });

          // Check if receiver currently has this conversation open (auto-READ)
          const activeConv = await this.redis.getUserActiveConversation(receiverId);
          if (activeConv === conversationId) {
            const [senderSetting, receiverSetting] = await Promise.all([
              this.prisma.setting
                .findUnique({ where: { userId: senderId }, select: { readReceipts: true } })
                .catch(() => null),
              this.prisma.setting
                .findUnique({ where: { userId: receiverId }, select: { readReceipts: true } })
                .catch(() => null),
            ]);
            const allowReadReceipt =
              senderSetting?.readReceipts !== false && receiverSetting?.readReceipts !== false;
            const finalStatus = allowReadReceipt ? 'READ' : 'DELIVERED';

            if (allowReadReceipt) {
              await this.prisma.message
                .update({
                  where: { id: serverMessageId },
                  data: { status: 'READ' as any },
                })
                .catch(() => {});
              await this.prisma.receipt
                .upsert({
                  where: {
                    messageId_userId_deviceId: {
                      messageId: serverMessageId,
                      userId: receiverId,
                      deviceId: '1',
                    },
                  },
                  create: {
                    messageId: serverMessageId,
                    userId: receiverId,
                    deviceId: '1',
                    status: 'READ',
                  },
                  update: {
                    status: 'READ',
                    updatedAt: new Date(),
                  },
                })
                .catch(() => {});
            }

            client.emit(EVT_RECEIPT_UPDATE, {
              serverMessageId,
              clientMessageId,
              conversationId,
              status: finalStatus,
            });
          }
        } else {
          // Receiver is offline — send FCM push notification so they see the message
          // even when the app is in the background or killed.
          const senderProfile = await this.prisma.user
            .findFirst({
              where: { id: senderId, isActive: true },
              select: { displayName: true, avatarUrl: true },
            })
            .catch(() => null);

          const preview = extractedText
            ? extractedText.substring(0, 100)
            : imagePath
              ? '📷 Photo'
              : document
                ? `📄 ${(document as any)?.name || 'Document'}`
                : location
                  ? '📍 Location'
                  : 'New message';

          this.pushNotificationService
            .sendMessagePush(receiverId, {
              conversationId,
              senderId,
              senderName: senderProfile?.displayName || 'Contact',
              senderAvatar: effectiveSenderAvatar || undefined,
              messagePreview: preview,
              messageType: msgType,
            })
            .catch(() => {});
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
    const deviceId: string = (client as any)._deviceId ?? '1';

    let effectiveStatus = status;
    let senderId: string | null = null;
    try {
      const msg = await this.prisma.message.findUnique({
        where: { id: serverMessageId },
        select: { senderId: true },
      });
      senderId = msg?.senderId ?? null;
      if (status === 'READ' && senderId) {
        const [senderSetting, receiverSetting] = await Promise.all([
          this.prisma.setting
            .findUnique({ where: { userId: senderId }, select: { readReceipts: true } })
            .catch(() => null),
          this.prisma.setting
            .findUnique({ where: { userId }, select: { readReceipts: true } })
            .catch(() => null),
        ]);
        if (senderSetting?.readReceipts === false || receiverSetting?.readReceipts === false) {
          effectiveStatus = 'DELIVERED';
        }
      }
    } catch {
      /* non-critical */
    }

    // Persist receipt & update message status using effectiveStatus (enforcing mutual read receipt in DB)
    try {
      await this.prisma.message.update({
        where: { id: serverMessageId },
        data: { status: effectiveStatus as any },
      });
    } catch {
      /* message may not exist yet — safe to ignore */
    }

    try {
      await this.prisma.receipt.upsert({
        where: {
          messageId_userId_deviceId: {
            messageId: serverMessageId,
            userId,
            deviceId,
          },
        },
        create: {
          messageId: serverMessageId,
          userId,
          deviceId,
          status: effectiveStatus as any,
        },
        update: {
          status: effectiveStatus as any,
          updatedAt: new Date(),
        },
      });
    } catch (rErr: any) {
      this.logger.warn(`Failed to upsert Receipt: ${rErr?.message}`);
    }

    // Fan-out receipt to the sender of this message
    if (senderId) {
      this.server.to(`user:${senderId}`).emit(EVT_RECEIPT_UPDATE, {
        serverMessageId,
        conversationId,
        status: effectiveStatus,
        byUserId: userId,
      });
    }

    this.logger.log(
      `👁  RECEIPT  uid=${userId}  msg=${serverMessageId}  status=${effectiveStatus} (raw=${status})`,
    );

    // Relay-only architecture: after a DELIVERED/READ receipt, check whether all
    // conversation members have confirmed delivery. If yes — clear the
    // server-side ciphertexts (fire-and-forget, never blocks socket response).
    if (effectiveStatus === 'DELIVERED' || effectiveStatus === 'READ') {
      this.messageCleanupService.clearCiphertextsAfterDelivery(serverMessageId).catch(() => {});
    }
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
  // message:reaction  — emoji reaction on message
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage('message:reaction')
  async handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { conversationId: string; messageId: string; receiverId?: string; emoji: string },
  ) {
    const userId: string = (client as any)._userId;
    if (!userId || !payload?.messageId || !payload?.emoji) return;

    let receiverId = payload.receiverId;
    if (!receiverId && payload.conversationId) {
      try {
        const members = await this.prisma.conversationMember.findMany({
          where: { conversationId: payload.conversationId },
          select: { userId: true },
        });
        const other = members.find((m) => m.userId !== userId);
        receiverId = other?.userId;
      } catch {}
    }

    if (receiverId) {
      this.server.to(`user:${receiverId}`).emit('message:reaction:update', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        emoji: payload.emoji,
        senderId: userId,
      });
      this.logger.log(
        `❤️  REACTION  uid=${userId} msg=${payload.messageId} emoji=${payload.emoji}`,
      );
    }
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
    const requesterId: string | undefined = (client as any)._userId;

    const [requesterSetting, blockedUsers, targetSettings, lastSeenMap] = await Promise.all([
      requesterId
        ? this.prisma.setting
            .findUnique({
              where: { userId: requesterId },
              select: { lastSeenVisibility: true },
            })
            .catch(() => null)
        : null,
      requesterId
        ? this.prisma.blockedUser
            .findMany({
              where: {
                OR: [
                  { blockerId: requesterId, blockedId: { in: payload.userIds } },
                  { blockerId: { in: payload.userIds }, blockedId: requesterId },
                ],
              },
              select: { blockerId: true, blockedId: true },
            })
            .catch(() => [])
        : [],
      this.prisma.setting
        .findMany({
          where: { userId: { in: payload.userIds } },
          select: { userId: true, lastSeenVisibility: true },
        })
        .catch(() => []),
      this.redis.getLastSeenBatch(payload.userIds),
    ]);

    const blockedSet = new Set<string>();
    for (const b of blockedUsers || []) {
      if (b.blockerId === requesterId) blockedSet.add(b.blockedId);
      if (b.blockedId === requesterId) blockedSet.add(b.blockerId);
    }
    const targetPrivacyMap = new Map<string, string>();
    for (const s of targetSettings || []) {
      targetPrivacyMap.set(s.userId, s.lastSeenVisibility);
    }

    const requesterHidesLastSeen = requesterSetting?.lastSeenVisibility === 'NOBODY';

    const presences: Record<string, { isOnline: boolean; lastSeen: string | null }> = {};
    const offlineMissingIds: string[] = [];

    for (const uid of payload.userIds) {
      if (blockedSet.has(uid)) {
        presences[uid] = { isOnline: false, lastSeen: null };
        continue;
      }
      const isOnline = this._isOnline(uid);
      const targetHidesLastSeen = targetPrivacyMap.get(uid) === 'NOBODY';
      const allowLastSeen = !requesterHidesLastSeen && !targetHidesLastSeen;
      const redisLastSeen = isOnline ? null : allowLastSeen ? (lastSeenMap[uid] ?? null) : null;
      presences[uid] = { isOnline, lastSeen: redisLastSeen };
      if (!isOnline && allowLastSeen && !redisLastSeen) {
        offlineMissingIds.push(uid);
      }
    }

    // DB Fallback for users whose Redis presence expired / not yet cached
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validMissingIds = offlineMissingIds.filter((id) => UUID_RE.test(id));

    if (validMissingIds.length > 0) {
      try {
        const devices = await this.prisma.device.findMany({
          where: { userId: { in: validMissingIds } },
          select: { userId: true, lastActiveAt: true },
          orderBy: { lastActiveAt: 'desc' },
        });
        for (const dev of devices) {
          if (presences[dev.userId] && !presences[dev.userId].lastSeen && dev.lastActiveAt) {
            const iso = dev.lastActiveAt.toISOString();
            presences[dev.userId].lastSeen = iso;
            await this.redis.setLastSeen(dev.userId, iso);
          }
        }
      } catch {}
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
          // FIX: Use MessageDeletion join table instead of array column
          deletions: { none: { userId } },
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
            select: {
              displayName: true,
              username: true,
              avatarUrl: true,
              phoneNumber: true,
              settings: { select: { profilePhotoVis: true } },
            },
          },
        },
      });

      if (missed.length === 0) return;

      // Deliver each missed message to the reconnected client
      for (const msg of missed) {
        const ct = msg.ciphertexts as any;
        const msgText =
          typeof ct === 'object' && ct !== null
            ? Array.isArray(ct)
              ? (ct[0]?.ciphertext ?? '')
              : (ct?.text ?? '')
            : '';
        const hideAvatar = (msg as any).sender?.settings?.profilePhotoVis === 'NOBODY';
        client.emit(EVT_MESSAGE_NEW, {
          serverMessageId: msg.id,
          clientMessageId: msg.clientMessageId,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          receiverId: userId,
          senderName: (msg as any).sender?.displayName,
          senderUsername: (msg as any).sender?.username,
          senderAvatarUrl: hideAvatar ? undefined : (msg as any).sender?.avatarUrl,
          senderPhone: (msg as any).sender?.phoneNumber,
          ciphertexts: msg.ciphertexts,
          text: msgText,
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

  // ─────────────────────────────────────────────────────────────────────────
  // WebRTC Audio / Video Calling Signaling Handlers
  // ─────────────────────────────────────────────────────────────────────────

  private async _resolveUserId(
    input?: string,
    conversationId?: string,
    senderId?: string,
  ): Promise<string | null> {
    if (!input) return null;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(input)) {
      return input;
    }

    // 1. Try finding other member in conversation
    if (conversationId) {
      try {
        const members = await this.prisma.conversationMember.findMany({
          where: { conversationId },
          select: { userId: true },
        });
        const other = members.find((m) => m.userId !== senderId);
        if (other?.userId) return other.userId;
      } catch (_) {}
    }

    // 2. Try looking up User by username, displayName, or phoneNumber — active users only
    try {
      const cleanHandle = input.replace(/^@/, '').trim();
      const phoneDigits = input.replace(/\D/g, '').slice(-10);
      const user = await this.prisma.user.findFirst({
        where: {
          isActive: true,
          OR: [
            { id: input },
            { username: { equals: cleanHandle, mode: 'insensitive' } },
            { displayName: { equals: cleanHandle, mode: 'insensitive' } },
            ...(phoneDigits ? [{ phoneNumber: { contains: phoneDigits } }] : []),
          ],
        },
        select: { id: true },
      });
      if (user?.id) return user.id;
    } catch (_) {}

    return input;
  }

  @SubscribeMessage(EVT_CALL_INITIATE)
  async handleCallInitiate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      receiverId: string;
      callType: 'audio' | 'video';
      callerName?: string;
      callerAvatar?: string;
      conversationId?: string;
    },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.receiverId) return;

    const targetUserId =
      (await this._resolveUserId(payload.receiverId, payload.conversationId, senderId)) ||
      payload.receiverId;

    // Check if target user has blocked caller
    const isBlockedByTarget = await this.prisma.blockedUser.findFirst({
      where: { blockerId: targetUserId, blockedId: senderId },
    });

    if (isBlockedByTarget) {
      // Caller hears calling endlessly, receiver is never notified (WhatsApp block behavior)
      client.emit('call:status', {
        callId: payload.callId,
        status: 'CALLING',
        isOnline: false,
      });
      return;
    }

    // If call was already cancelled before initiate arrived, abort immediately!
    if (this.cancelledCallIds.has(payload.callId)) {
      this.logger.log(
        `📞 [Call Initiate Aborted] callId=${payload.callId} was already cancelled by caller`,
      );
      client.emit('call:status', {
        callId: payload.callId,
        status: 'ENDED',
        reason: 'cancelled',
      });
      return;
    }

    this.activeCalls.set(payload.callId, {
      callId: payload.callId,
      callerId: senderId,
      receiverId: targetUserId,
    });

    const isReceiverOnline = this._isOnline(targetUserId) || this._isOnline(payload.receiverId);

    this.logger.log(
      `📞 [Call Initiate] from=${senderId} to=${targetUserId} (raw=${payload.receiverId}) type=${payload.callType} receiverOnline=${isReceiverOnline}`,
    );
    this.otelService?.recordSocketEvent(EVT_CALL_INITIATE, targetUserId);

    // Immediately inform caller about status: 'RINGING' if receiver is online, 'CALLING' if offline
    client.emit('call:status', {
      callId: payload.callId,
      status: isReceiverOnline ? 'RINGING' : 'CALLING',
      isOnline: isReceiverOnline,
    });

    const callData = {
      callId: payload.callId,
      callerId: senderId,
      callerName: payload.callerName || 'Contact',
      callerAvatar: payload.callerAvatar,
      callType: payload.callType || 'audio',
      conversationId: payload.conversationId,
      sdp: (payload as any).sdp,
    };

    // Broadcast incoming call to receiver's personal room
    this.server.to(`user:${targetUserId}`).emit(EVT_CALL_INCOMING, callData);
    if (payload.receiverId !== targetUserId) {
      this.server.to(`user:${payload.receiverId}`).emit(EVT_CALL_INCOMING, callData);
    }

    // ⚡ FIX 3: Fallback push notification if receiver socket is disconnected/offline
    if (!isReceiverOnline) {
      this.pushNotificationService.sendIncomingCallPush(targetUserId, callData).catch(() => {});
      if (payload.receiverId !== targetUserId) {
        this.pushNotificationService
          .sendIncomingCallPush(payload.receiverId, callData)
          .catch(() => {});
      }
    }
  }

  @SubscribeMessage('call:ringing')
  async handleCallRinging(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; callerId: string },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.callerId) return;

    const targetCallerId = (await this._resolveUserId(payload.callerId)) || payload.callerId;
    this.logger.log(
      `📞 [Call Ringing ACK] callId=${payload.callId} receiver=${senderId} -> caller=${targetCallerId}`,
    );

    this.server.to(`user:${targetCallerId}`).emit('call:status', {
      callId: payload.callId,
      status: 'RINGING',
      isOnline: true,
    });
    if (payload.callerId !== targetCallerId) {
      this.server.to(`user:${payload.callerId}`).emit('call:status', {
        callId: payload.callId,
        status: 'RINGING',
        isOnline: true,
      });
    }
  }

  @SubscribeMessage(EVT_CALL_ACCEPT)
  async handleCallAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; callerId: string; sdp?: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.callerId) return;

    const targetCallerId = (await this._resolveUserId(payload.callerId)) || payload.callerId;
    this.logger.log(
      `📞 [Call Accept] callId=${payload.callId} acceptedBy=${senderId} callerId=${targetCallerId}`,
    );
    this.otelService?.recordSocketEvent(EVT_CALL_ACCEPTED, targetCallerId);

    const acceptData = {
      callId: payload.callId,
      receiverId: senderId,
      sdp: payload.sdp,
    };

    this.server.to(`user:${targetCallerId}`).emit(EVT_CALL_ACCEPTED, acceptData);
    this.server.to(`user:${targetCallerId}`).emit('call:status', {
      callId: payload.callId,
      status: 'CONNECTED',
      isOnline: true,
    });
    if (payload.callerId !== targetCallerId) {
      this.server.to(`user:${payload.callerId}`).emit(EVT_CALL_ACCEPTED, acceptData);
      this.server.to(`user:${payload.callerId}`).emit('call:status', {
        callId: payload.callId,
        status: 'CONNECTED',
        isOnline: true,
      });
    }
  }

  @SubscribeMessage(EVT_CALL_REJECT)
  async handleCallReject(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { callId: string; callerId?: string; targetUserId?: string; reason?: string },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.callId) return;

    this.cancelledCallIds.add(payload.callId);
    setTimeout(() => this.cancelledCallIds.delete(payload.callId), 60000);

    const callRecord = this.activeCalls.get(payload.callId);
    this.activeCalls.delete(payload.callId);

    const rawTarget = payload.callerId || payload.targetUserId || callRecord?.callerId;
    const targetCallerId = rawTarget ? (await this._resolveUserId(rawTarget)) || rawTarget : null;
    this.logger.log(
      `📞 [Call Rejected] callId=${payload.callId} by=${senderId} target=${targetCallerId}`,
    );

    const endData = {
      callId: payload.callId,
      reason: payload.reason || 'rejected',
      cancelledBy: senderId,
    };

    if (targetCallerId) {
      this.server.to(`user:${targetCallerId}`).emit(EVT_CALL_ENDED, endData);
      this.server.to(`user:${targetCallerId}`).emit('call:cancelled', endData);
      this.server.to(`user:${targetCallerId}`).emit('call:status', {
        callId: payload.callId,
        status: 'ENDED',
        reason: payload.reason || 'rejected',
      });
    }

    client.emit(EVT_CALL_ENDED, endData);
    client.emit('call:cancelled', endData);
    client.emit('call:status', {
      callId: payload.callId,
      status: 'ENDED',
      reason: payload.reason || 'rejected',
    });
  }

  @SubscribeMessage(EVT_CALL_END)
  @SubscribeMessage('call:cancel')
  @SubscribeMessage('call:error')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      targetUserId?: string;
      receiverId?: string;
      callerId?: string;
      reason?: string;
      error?: string;
    },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.callId) return;

    // Guard against late call:initiate race conditions
    this.cancelledCallIds.add(payload.callId);
    setTimeout(() => this.cancelledCallIds.delete(payload.callId), 60000);

    const callRecord = this.activeCalls.get(payload.callId);
    this.activeCalls.delete(payload.callId);

    const rawTarget =
      payload.targetUserId ||
      payload.receiverId ||
      (callRecord
        ? callRecord.callerId === senderId
          ? callRecord.receiverId
          : callRecord.callerId
        : null);
    const targetUserId = rawTarget ? (await this._resolveUserId(rawTarget)) || rawTarget : null;

    this.logger.log(
      `📞 [Call Ended/Cancelled/Error] callId=${payload.callId} by=${senderId} target=${targetUserId} reason=${payload.reason || 'ended'} error=${payload.error || 'none'}`,
    );

    const endData = {
      callId: payload.callId,
      reason: payload.reason || 'ended',
      cancelledBy: senderId,
      error: payload.error,
    };

    // Broadcast cancel/end/error signal to target user room
    if (targetUserId) {
      this.server.to(`user:${targetUserId}`).emit(EVT_CALL_ENDED, endData);
      this.server.to(`user:${targetUserId}`).emit('call:end', endData);
      this.server.to(`user:${targetUserId}`).emit('call:cancelled', endData);
      this.server.to(`user:${targetUserId}`).emit('call:cancel', endData);
      this.server.to(`user:${targetUserId}`).emit('call:error', endData);
      this.server.to(`user:${targetUserId}`).emit('call:status', {
        callId: payload.callId,
        status: 'ENDED',
        reason: payload.reason || 'ended',
      });
    }

    // Also notify sender socket/room to guarantee synchronized cleanup
    client.emit(EVT_CALL_ENDED, endData);
    client.emit('call:end', endData);
    client.emit('call:cancelled', endData);
    client.emit('call:cancel', endData);
    client.emit('call:error', endData);
    client.emit('call:status', {
      callId: payload.callId,
      status: 'ENDED',
      reason: payload.reason || 'ended',
    });
  }

  @SubscribeMessage(EVT_WEBRTC_OFFER)
  async handleWebRtcOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; sdp: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.targetUserId) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.server.to(`user:${targetUserId}`).emit(EVT_WEBRTC_OFFER, {
      callId: payload.callId,
      sdp: payload.sdp,
      senderId,
    });
  }

  @SubscribeMessage(EVT_WEBRTC_ANSWER)
  async handleWebRtcAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; sdp: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.targetUserId) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.server.to(`user:${targetUserId}`).emit(EVT_WEBRTC_ANSWER, {
      callId: payload.callId,
      sdp: payload.sdp,
      senderId,
    });
  }

  @SubscribeMessage(EVT_WEBRTC_ICE_CANDIDATE)
  async handleWebRtcIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; candidate: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.targetUserId) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.server.to(`user:${targetUserId}`).emit(EVT_WEBRTC_ICE_CANDIDATE, {
      callId: payload.callId,
      candidate: payload.candidate,
      senderId,
    });
    this.server.to(`user:${targetUserId}`).emit('call:ice-candidate', {
      callId: payload.callId,
      candidate: payload.candidate,
      senderId,
    });
  }

  @SubscribeMessage('call:ice-candidate')
  async handleCallIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; candidate: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.targetUserId) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.server.to(`user:${targetUserId}`).emit('call:ice-candidate', {
      callId: payload.callId,
      candidate: payload.candidate,
      senderId,
    });
    this.server.to(`user:${targetUserId}`).emit(EVT_WEBRTC_ICE_CANDIDATE, {
      callId: payload.callId,
      candidate: payload.candidate,
      senderId,
    });
  }

  @SubscribeMessage(EVT_CALL_SWITCH_VIDEO)
  async handleCallSwitchToVideo(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      targetUserId: string;
      action: 'request' | 'accept' | 'reject';
      isVideo?: boolean;
    },
  ) {
    await this._relaySwitchVideo(client, payload);
  }

  @SubscribeMessage('call:switch-video')
  async handleCallSwitchVideo(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      targetUserId: string;
      action: 'request' | 'accept' | 'reject';
      isVideo?: boolean;
    },
  ) {
    await this._relaySwitchVideo(client, payload);
  }

  private async _relaySwitchVideo(
    client: Socket,
    payload: {
      callId: string;
      targetUserId: string;
      action: 'request' | 'accept' | 'reject';
      isVideo?: boolean;
    },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload.targetUserId) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.logger.log(
      `📹 [Call Switch Video] from=${senderId} to=${targetUserId} action=${payload.action} isVideo=${payload.isVideo}`,
    );
    const data = {
      callId: payload.callId,
      senderId,
      action: payload.action,
      isVideo:
        payload.isVideo !== undefined
          ? payload.isVideo
          : payload.action === 'request' || payload.action === 'accept',
    };
    this.server.to(`user:${targetUserId}`).emit(EVT_CALL_SWITCH_VIDEO, data);
    this.server.to(`user:${targetUserId}`).emit('call:switch-video', data);
    if (payload.targetUserId !== targetUserId) {
      this.server.to(`user:${payload.targetUserId}`).emit(EVT_CALL_SWITCH_VIDEO, data);
      this.server.to(`user:${payload.targetUserId}`).emit('call:switch-video', data);
    }
  }

  // Relay call emoji reactions between call participants
  @SubscribeMessage('call:reaction')
  async handleCallReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; emoji: string },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.targetUserId || !payload?.emoji) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.server.to(`user:${targetUserId}`).emit('call:reaction', {
      callId: payload.callId,
      emoji: payload.emoji,
      senderId,
    });
  }

  @SubscribeMessage('call:audio-chunk')
  async handleCallAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      targetUserId: string;
      audioBase64?: string;
      chunkBase64?: string;
      chunkIndex?: number;
    },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    const audioData = payload.audioBase64 || payload.chunkBase64;
    if (!senderId || !payload.targetUserId || !audioData) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    const chunkObj = {
      callId: payload.callId,
      senderId,
      audioBase64: audioData,
      chunkBase64: audioData,
      chunkIndex: payload.chunkIndex,
    };

    this.server.to(`user:${targetUserId}`).emit('call:audio-chunk', chunkObj);
    if (payload.targetUserId !== targetUserId) {
      this.server.to(`user:${payload.targetUserId}`).emit('call:audio-chunk', chunkObj);
    }
  }

  @SubscribeMessage('call:video-frame')
  async handleCallVideoFrame(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      targetUserId: string;
      frameBase64: string;
      timestamp?: number;
    },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.targetUserId || !payload?.frameBase64) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    const frameData = {
      callId: payload.callId,
      senderId,
      frameBase64: payload.frameBase64,
      timestamp: payload.timestamp || Date.now(),
    };

    this.server.to(`user:${targetUserId}`).emit('call:video-frame', frameData);
    if (payload.targetUserId !== targetUserId) {
      this.server.to(`user:${payload.targetUserId}`).emit('call:video-frame', frameData);
    }
  }

  @SubscribeMessage('user:block')
  async handleUserBlock(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { targetUserId: string },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.targetUserId) return;
    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    await this.prisma.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId: senderId, blockedId: targetUserId } },
      update: {},
      create: { blockerId: senderId, blockedId: targetUserId },
    });
    this.server.to(`user:${targetUserId}`).emit('user:blocked', { blockerId: senderId });
    client.emit('user:blocked', { blockedId: targetUserId });
  }

  @SubscribeMessage('user:unblock')
  async handleUserUnblock(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { targetUserId: string },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.targetUserId) return;
    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    await this.prisma.blockedUser.deleteMany({
      where: { blockerId: senderId, blockedId: targetUserId },
    });
    this.server.to(`user:${targetUserId}`).emit('user:unblocked', { blockerId: senderId });
    client.emit('user:unblocked', { blockedId: targetUserId });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX: WebRTC Mid-Call SDP Renegotiation Relay (for video upgrade)
  // Previously missing — without this, upgradeToVideo() offer/answer never
  // reached the remote peer, causing one-sided or no video.
  // ─────────────────────────────────────────────────────────────────────────

  @SubscribeMessage('webrtc:renegotiate-offer')
  async handleRenegotiateOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; sdp: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.targetUserId || !payload?.sdp) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.logger.log(
      `🔄 [Renegotiate Offer] from=${senderId} to=${targetUserId} callId=${payload.callId}`,
    );
    this.server.to(`user:${targetUserId}`).emit('webrtc:renegotiate-offer', {
      callId: payload.callId,
      sdp: payload.sdp,
      senderId,
    });
  }

  @SubscribeMessage('webrtc:renegotiate-answer')
  async handleRenegotiateAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string; targetUserId: string; sdp: any },
  ) {
    const senderId = (client as any)._userId || client.data?.userId;
    if (!senderId || !payload?.targetUserId || !payload?.sdp) return;

    const targetUserId = (await this._resolveUserId(payload.targetUserId)) || payload.targetUserId;
    this.logger.log(
      `🔄 [Renegotiate Answer] from=${senderId} to=${targetUserId} callId=${payload.callId}`,
    );
    this.server.to(`user:${targetUserId}`).emit('webrtc:renegotiate-answer', {
      callId: payload.callId,
      sdp: payload.sdp,
      senderId,
    });
  }

  public emitToUser(userId: string, event: string, payload: any) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, payload);
    }
  }

  public broadcastToUsers(userIds: string[], event: string, payload: any) {
    if (this.server) {
      for (const uid of userIds) {
        this.server.to(`user:${uid}`).emit(event, payload);
      }
    }
  }
}

/**
 * RealtimeSocketService — single app-wide socket instance.
 *
 * Rules enforced here:
 *  1. ONE socket connection for the entire app lifetime — created on login, destroyed on logout.
 *  2. JWT token sent in handshake.auth (not query param) so backend can verify it.
 *  3. lastMessageId sent on connect so backend delivers missed messages from offline gap.
 *  4. All listeners are registered once in _setup() and torn down in _teardown().
 *     No component ever registers its own socket.on() — zero duplicate-handler risk.
 *  5. Reconnection is built-in — socket.io-client handles it automatically.
 */

import { io, Socket } from 'socket.io-client';
import { serverConfig } from './serverConfig';
import { safeStorage } from './storageHelper';
import { AUTH_STORAGE_KEYS } from '../store/authSlice';
import { apiService, handleSessionExpired } from './apiService';

// ─── Event constants (must match backend message.gateway.ts) ─────────────────
export const EVT_MESSAGE_SEND = 'message:send';
export const EVT_MESSAGE_NEW = 'message:new';
export const EVT_MESSAGE_ACK = 'message:ack';
export const EVT_MESSAGE_RECEIPT = 'message:receipt';
export const EVT_TYPING = 'typing';
export const EVT_TYPING_UPDATE = 'typing:update';
export const EVT_PRESENCE_QUERY = 'presence:query';
export const EVT_PRESENCE_UPDATE = 'presence:update';
export const EVT_PRESENCE_RESULT = 'presence:result';
export const EVT_CHAT_OPEN = 'chat:open';
export const EVT_CHAT_CLOSE = 'chat:close';
export const EVT_MESSAGE_DELETED = 'message:deleted';
export const EVT_MISSED_MESSAGES = 'messages:missed';

// WebRTC Calling Events
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

// ─── Payload types ────────────────────────────────────────────────────────────

export interface IncomingMessage {
  serverMessageId: string;
  clientMessageId?: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  senderName?: string;
  senderUsername?: string;
  senderAvatarUrl?: string;
  senderPhone?: string;
  text: string;
  imagePath?: string;
  location?: {
    lat: number;
    lng: number;
    label?: string;
    isLive?: boolean;
    liveDurationMinutes?: number;
    expiresAt?: string;
    isLiveEnded?: boolean;
    accuracy?: number;
  };
  document?: { uri: string; name: string; size?: number | string; mimeType?: string };
  contact?: { name: string; phone: string; username?: string };
  type: string;
  status: string;
  createdAt: string;
  isMissed?: boolean;
}

export interface MessageAck {
  clientMessageId: string;
  serverMessageId: string;
  conversationId: string;
  status: string;
  createdAt: string;
  error?: string;
}

export interface ReceiptUpdate {
  serverMessageId: string;
  clientMessageId?: string;
  conversationId: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  byUserId?: string;
}

export interface PresenceUpdate {
  userId: string;
  isOnline: boolean;
  lastSeen: string | null;
}

export interface TypingUpdate {
  conversationId: string;
  senderId: string;
  isTyping: boolean;
}

export interface SocketCallbacks {
  onMessageNew?: (msg: IncomingMessage) => void;
  onMessageAck?: (ack: MessageAck) => void;
  onReceiptUpdate?: (receipt: ReceiptUpdate) => void;
  onPresenceUpdate?: (presence: PresenceUpdate) => void;
  onPresenceResult?: (data: {
    presences: Record<string, { isOnline: boolean; lastSeen: string | null }>;
  }) => void;
  onTypingUpdate?: (data: TypingUpdate) => void;
  onReactionUpdate?: (data: {
    conversationId: string;
    messageId: string;
    emoji: string;
    senderId: string;
  }) => void;
  onMessageDeleted?: (data: { messageId: string; conversationId: string }) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class RealtimeSocketService {
  private socket: Socket | null = null;
  private callbacks: SocketCallbacks = {};
  private currentUserId = '';
  private currentToken = '';
  private eventListeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor() {
    // Reconnect when server URL toggles (Local ↔ Live in dev)
    serverConfig.subscribe(() => {
      if (this.currentToken) this._reconnect();
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Connect (or reconnect) the socket.
   * Call once after login with the JWT token + userId.
   * Safe to call again if token rotates — tears down old socket and creates fresh one.
   */
  async connect(opts: {
    token: string;
    userId: string;
    callbacks?: SocketCallbacks;
  }): Promise<void> {
    if (opts.callbacks) this.callbacks = opts.callbacks;

    const tokenChanged = opts.token !== this.currentToken;
    const userChanged = opts.userId !== this.currentUserId;

    this.currentToken = opts.token;
    this.currentUserId = opts.userId;

    // Reuse existing live socket if identity has not changed
    if (this.socket?.connected && !tokenChanged && !userChanged) return;

    this._teardown();
    await this._setup();
  }

  /** Hard disconnect — call on logout. */
  disconnect(): void {
    this._teardown();
    this.currentToken = '';
    this.currentUserId = '';
    this.callbacks = {};
  }

  /**
   * Update token on the live socket without full reconnect.
   * Called by ChatContext when tokensRefreshedAction fires.
   * If socket is currently disconnected it will reconnect with the new token.
   */
  updateToken(newToken: string): void {
    if (newToken === this.currentToken) return;
    this.currentToken = newToken;
    // Always reconnect — socket.io auth is set at connect-time only
    this._teardown();
    this._setup();
  }

  /**
   * Send a message.
   * receiverId MUST be the recipient's DB UUID — backend uses user:<receiverId> room.
   */
  sendMessage(payload: {
    clientMessageId: string;
    conversationId: string;
    receiverId: string;
    text?: string;
    imagePath?: string;
    location?: {
      lat: number;
      lng: number;
      label?: string;
      isLive?: boolean;
      liveDurationMinutes?: number;
      expiresAt?: string;
      isLiveEnded?: boolean;
      accuracy?: number;
    };
    document?: { uri: string; name: string; size?: number | string; mimeType?: string };
    contact?: { name: string; phone: string; username?: string };
    type?: string;
  }): void {
    if (!this.socket?.connected) return;
    this.socket.emit(EVT_MESSAGE_SEND, payload);
  }

  /** Send DELIVERED or READ receipt. */
  sendReceipt(serverMessageId: string, conversationId: string, status: 'DELIVERED' | 'READ'): void {
    if (!this.socket?.connected) return;
    this.socket.emit(EVT_MESSAGE_RECEIPT, { serverMessageId, conversationId, status });
  }

  /** Send typing indicator to a specific conversation/recipient. */
  sendTyping(conversationId: string, receiverId: string, isTyping: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit(EVT_TYPING, { conversationId, receiverId, isTyping });
  }

  /** Notify server this conversation is currently open (enables auto-READ). */
  openChat(conversationId: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit(EVT_CHAT_OPEN, { conversationId });
  }

  /** Notify server this conversation was closed. */
  closeChat(conversationId: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit(EVT_CHAT_CLOSE, { conversationId });
  }

  /** Batch-query online status + lastSeen for a list of userIds. */
  queryPresence(userIds: string[]): void {
    if (!this.socket?.connected || userIds.length === 0) return;
    this.socket.emit(EVT_PRESENCE_QUERY, { userIds });
  }

  /** Send emoji reaction on a message. */
  sendReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
    receiverId?: string,
  ): void {
    if (!this.socket?.connected) return;
    this.socket.emit('message:reaction', { conversationId, messageId, emoji, receiverId });
  }

  /** Generic emit */
  emit(event: string, data: any): void {
    if (!this.socket?.connected) return;
    this.socket.emit(event, data);
  }

  /** Generic on */
  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
    if (this.socket) {
      this.socket.off(event, handler);
      this.socket.on(event, handler);
    }
  }

  /** Generic off */
  off(event: string, handler?: (...args: any[]) => void): void {
    if (handler) {
      this.eventListeners.get(event)?.delete(handler);
      this.socket?.off(event, handler);
    } else {
      this.eventListeners.delete(event);
      this.socket?.off(event);
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async _setup(): Promise<void> {
    if (this.socket?.connected) return;
    const url = serverConfig.getSocketUrl();

    // Load the id of the last message we have locally — sent to server on connect
    // so it can push any messages we missed while offline.
    const lastMessageId = (await safeStorage.getItem('@chat_last_message_id')) ?? undefined;

    try {
      console.log('📡 [Socket] Connecting to:', url);
      this.socket = io(url, {
        transports: ['polling', 'websocket'],
        upgrade: true,
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 25000,
        // JWT goes in auth — backend reads from handshake.auth.token
        auth: {
          token: this.currentToken,
          lastMessageId: lastMessageId ?? null,
        },
      });

      this._registerListeners();
    } catch (err: any) {
      console.warn('🔴 [Socket] setup error:', err?.message);
    }
  }

  private _registerListeners(): void {
    if (!this.socket) return;

    // Attach all registered dynamic listeners (e.g. call:incoming, call:status, etc.)
    for (const [event, handlers] of this.eventListeners.entries()) {
      for (const handler of handlers) {
        this.socket.off(event, handler);
        this.socket.on(event, handler);
      }
    }

    this.socket.on('connect', () => {
      console.log('🟢 [Socket] Connected successfully! Socket ID:', this.socket?.id);
      this.callbacks.onConnect?.();
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('🟡 [Socket] Disconnected. Reason:', reason);
      this.callbacks.onDisconnect?.(reason);

      if (reason === 'io server disconnect') {
        // Server rejected our token — attempt token refresh and reconnect with new token
        apiService
          .refreshAuthToken()
          .then((refreshed) => {
            if (refreshed?.accessToken) {
              this.currentToken = refreshed.accessToken;
              if (this.socket) {
                this.socket.auth = {
                  token: this.currentToken,
                  lastMessageId: null,
                };
                this.socket.connect();
              }
            } else {
              handleSessionExpired();
            }
          })
          .catch(() => {});
      }
    });

    this.socket.on('connect_error', (err: any) => {
      console.warn('🔴 [Socket] Connection error:', err?.message);
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('token') || msg.includes('auth') || msg.includes('unauthorized')) {
        apiService
          .refreshAuthToken()
          .then((refreshed) => {
            if (refreshed?.accessToken) {
              this.currentToken = refreshed.accessToken;
              if (this.socket) {
                this.socket.auth = {
                  token: this.currentToken,
                  lastMessageId: null,
                };
                this.socket.connect();
              }
            }
          })
          .catch(() => {});
      }
    });

    // ── New message arriving (receiver side) ─────────────────────────────
    this.socket.on(EVT_MESSAGE_NEW, (data: IncomingMessage) => {
      if (!data?.serverMessageId) return;
      this.callbacks.onMessageNew?.(data);
    });

    // ── Server ack (sender side — DB confirmed, single tick → double tick) ─
    this.socket.on(EVT_MESSAGE_ACK, (ack: MessageAck) => {
      if (!ack?.clientMessageId) return;
      // Persist the last confirmed serverMessageId for gap-fill on next connect
      if (ack.serverMessageId) {
        safeStorage.setItem('@chat_last_message_id', ack.serverMessageId).catch(() => {});
      }
      this.callbacks.onMessageAck?.(ack);
    });

    // ── Receipt update (DELIVERED / READ tick change) ─────────────────────
    this.socket.on(EVT_MESSAGE_RECEIPT, (receipt: ReceiptUpdate) => {
      if (!receipt?.serverMessageId) return;
      this.callbacks.onReceiptUpdate?.(receipt);
    });

    // ── Presence online/offline broadcast ─────────────────────────────────
    this.socket.on(EVT_PRESENCE_UPDATE, (data: PresenceUpdate) => {
      if (!data?.userId) return;
      this.callbacks.onPresenceUpdate?.(data);
    });

    // ── Presence query result ─────────────────────────────────────────────
    this.socket.on(EVT_PRESENCE_RESULT, (data: any) => {
      if (!data?.presences) return;
      this.callbacks.onPresenceResult?.(data);
    });

    // ── Typing indicator ──────────────────────────────────────────────────
    this.socket.on(EVT_TYPING_UPDATE, (data: TypingUpdate) => {
      if (!data?.senderId) return;
      this.callbacks.onTypingUpdate?.(data);
    });

    // ── Reaction broadcast ───────────────────────────────────────────────
    this.socket.on('message:reaction:update', (data: any) => {
      if (!data?.messageId || !data?.emoji) return;
      this.callbacks.onReactionUpdate?.(data);
    });

    // ── Delete-for-everyone broadcast ─────────────────────────────────────
    this.socket.on(EVT_MESSAGE_DELETED, (data: any) => {
      if (!data?.messageId) return;
      this.callbacks.onMessageDeleted?.(data);
    });
  }

  private _teardown(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private _reconnect(): void {
    this._teardown();
    if (this.currentToken) this._setup();
  }
}

// Single app-wide singleton — imported everywhere
export const socketService = new RealtimeSocketService();

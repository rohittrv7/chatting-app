import { Platform } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { devInspector } from './devInspectorService';

// 💻 LOCAL DEVELOPMENT SOCKET URL (Active Host Wi-Fi IP)
export const LOCAL_IP = '10.36.162.14';
export const LOCAL_SOCKET_URL =
  Platform.OS === 'web' ? 'http://localhost:3000' : `http://${LOCAL_IP}:3000`;

export const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || LOCAL_SOCKET_URL;

export interface SocketMessagePayload {
  serverMessageId?: string;
  clientMessageId?: string;
  conversationId: string;
  senderId?: string;
  senderName?: string;
  receiverId?: string;
  text?: string;
  imagePath?: string;
  status?: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED';
  createdAt?: string;
}

export interface SocketReceiptPayload {
  messageId: string;
  clientMessageId?: string;
  conversationId?: string;
  userId?: string;
  status: 'DELIVERED' | 'READ';
}

class RealtimeSocketService {
  private socket: Socket | null = null;
  private currentUserId: string = '';
  private callbacks?: {
    onMessageReceived?: (payload: SocketMessagePayload) => void;
    onMessageAck?: (ack: {
      clientMessageId: string;
      serverMessageId: string;
      status: any;
    }) => void;
    onReceiptUpdate?: (receipt: SocketReceiptPayload) => void;
  };

  public isConnected(): boolean {
    return Boolean(this.socket && this.socket.connected);
  }

  public getSocketId(): string | null {
    return this.socket?.id || null;
  }

  public connect(
    userId?: string,
    callbacks?: {
      onMessageReceived?: (payload: SocketMessagePayload) => void;
      onMessageAck?: (ack: {
        clientMessageId: string;
        serverMessageId: string;
        status: any;
      }) => void;
      onReceiptUpdate?: (receipt: SocketReceiptPayload) => void;
    },
  ) {
    if (callbacks) {
      this.callbacks = callbacks;
    }

    const newUserId = userId || this.currentUserId || `user_${Date.now()}`;
    const userChanged = this.currentUserId && this.currentUserId !== newUserId;
    this.currentUserId = newUserId;

    if (this.socket && this.socket.connected && !userChanged) {
      return;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket.removeAllListeners();
      this.socket = null;
    }

    try {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        query: {
          userId: this.currentUserId,
          deviceId: '1',
        },
      });

      this.socket.on('connect', () => {
        devInspector.logSocket('connect', 'incoming', {
          socketId: this.socket?.id,
          userId: this.currentUserId,
        });
      });

      // 📩 Incoming Message Handlers
      const handleReceive = (data: any) => {
        if (data && typeof data === 'object') {
          const convId = data.conversationId?.toString() || 'conv_1';
          const sender = data.senderName?.toString() || 'Friend';
          const text = data.text?.toString() || '';
          const serverMsgId =
            data.serverMessageId?.toString() || data.id?.toString() || `msg_${Date.now()}`;

          devInspector.logSocket('message:receive', 'incoming', {
            serverMsgId,
            convId,
            sender,
            text,
          });

          // Send DELIVERED receipt back to server immediately
          this.sendReceipt(serverMsgId, convId, 'DELIVERED');

          if (this.callbacks?.onMessageReceived) {
            this.callbacks.onMessageReceived({
              serverMessageId: serverMsgId,
              conversationId: convId,
              senderName: sender,
              senderId: data.senderId,
              text,
              imagePath: data.imagePath,
              status: 'DELIVERED',
              createdAt: data.createdAt || new Date().toISOString(),
            });
          }
        }
      };

      this.socket.off('v1.message.receive');
      this.socket.off('message:receive');
      this.socket.on('v1.message.receive', handleReceive);
      this.socket.on('message:receive', handleReceive);

      // ✅ Single Tick ✓ (SERVER_RECEIVED Ack)
      const handleAck = (ack: any) => {
        if (ack) {
          devInspector.logSocket('message:ack', 'incoming', ack);
          if (this.callbacks?.onMessageAck) {
            this.callbacks.onMessageAck({
              clientMessageId: ack.clientMessageId,
              serverMessageId: ack.serverMessageId,
              status: ack.status || 'SERVER_RECEIVED',
            });
          }
        }
      };
      this.socket.off('v1.message.ack');
      this.socket.off('message:ack');
      this.socket.on('v1.message.ack', handleAck);
      this.socket.on('message:ack', handleAck);

      // 👁️ Double Tick (DELIVERED) & Violet Tick (READ) Receipts
      const handleReceipt = (receipt: any) => {
        if (receipt) {
          devInspector.logSocket('message:receipt', 'incoming', receipt);
          if (this.callbacks?.onReceiptUpdate) {
            this.callbacks.onReceiptUpdate({
              messageId: receipt.messageId,
              clientMessageId: receipt.clientMessageId,
              conversationId: receipt.conversationId,
              userId: receipt.userId,
              status: receipt.status || 'READ',
            });
          }
        }
      };
      this.socket.off('v1.message.receipt');
      this.socket.off('message:receipt');
      this.socket.on('v1.message.receipt', handleReceipt);
      this.socket.on('message:receipt', handleReceipt);

      this.socket.on('disconnect', (reason) => {
        devInspector.logSocket('disconnect', 'incoming', { reason });
      });
    } catch (e: any) {
      devInspector.logSocket('error', 'incoming', { error: e?.message });
    }
  }

  public openChat(conversationId: string) {
    if (this.socket && this.socket.connected) {
      devInspector.logSocket('chat:open', 'outgoing', { conversationId });
      this.socket.emit('chat:open', { conversationId });
    }
  }

  public closeChat(conversationId: string) {
    if (this.socket && this.socket.connected) {
      devInspector.logSocket('chat:close', 'outgoing', { conversationId });
      this.socket.emit('chat:close', { conversationId });
    }
  }

  public sendMessage(payload: {
    conversationId: string;
    clientMessageId: string;
    senderName: string;
    receiverId?: string;
    text: string;
    imagePath?: string;
  }) {
    if (this.socket && this.socket.connected) {
      const socketPayload = {
        ...payload,
        senderId: this.currentUserId,
        timestamp: new Date().toISOString(),
      };
      devInspector.logSocket('message:send', 'outgoing', socketPayload);
      this.socket.emit('message:send', socketPayload);
    }
  }

  public sendReceipt(messageId: string, conversationId: string, status: 'DELIVERED' | 'READ') {
    if (this.socket && this.socket.connected) {
      const payload = {
        messageId,
        conversationId,
        status,
      };
      devInspector.logSocket('message:receipt', 'outgoing', payload);
      this.socket.emit('message:receipt', payload);
    }
  }

  public disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new RealtimeSocketService();

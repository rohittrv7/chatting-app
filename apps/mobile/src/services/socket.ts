import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'https://chatting-app-rme6.onrender.com';

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
    this.currentUserId = userId || this.currentUserId || `user_${Date.now()}`;

    if (this.socket && this.socket.connected) return;

    try {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket'],
        autoConnect: true,
        query: {
          userId: this.currentUserId,
          deviceId: '1',
        },
      });

      this.socket.on('connect', () => {
        console.log('Connected to WebSocket Realtime Gateway with userId:', this.currentUserId);
      });

      // 📩 Incoming Message Handlers
      const handleReceive = (data: any) => {
        if (data && typeof data === 'object') {
          const convId = data.conversationId?.toString() || 'conv_1';
          const sender = data.senderName?.toString() || 'Friend';
          const text = data.text?.toString() || '';
          const serverMsgId =
            data.serverMessageId?.toString() || data.id?.toString() || `msg_${Date.now()}`;

          // Send DELIVERED receipt back to server immediately
          this.sendReceipt(serverMsgId, convId, 'DELIVERED');

          if (callbacks?.onMessageReceived) {
            callbacks.onMessageReceived({
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

      this.socket.on('v1.message.receive', handleReceive);
      this.socket.on('message:receive', handleReceive);

      // ✅ Single Tick ✓ (SERVER_RECEIVED Ack)
      const handleAck = (ack: any) => {
        if (ack && callbacks?.onMessageAck) {
          callbacks.onMessageAck({
            clientMessageId: ack.clientMessageId,
            serverMessageId: ack.serverMessageId,
            status: ack.status || 'SERVER_RECEIVED',
          });
        }
      };
      this.socket.on('v1.message.ack', handleAck);
      this.socket.on('message:ack', handleAck);

      // 👁️ Double Tick (DELIVERED) & Violet Tick (READ) Receipts
      const handleReceipt = (receipt: any) => {
        if (receipt && callbacks?.onReceiptUpdate) {
          callbacks.onReceiptUpdate({
            messageId: receipt.messageId,
            clientMessageId: receipt.clientMessageId,
            conversationId: receipt.conversationId,
            userId: receipt.userId,
            status: receipt.status || 'READ',
          });
        }
      };
      this.socket.on('v1.message.receipt', handleReceipt);
      this.socket.on('message:receipt', handleReceipt);

      this.socket.on('disconnect', () => {
        console.log('Disconnected from Realtime Socket Gateway');
      });
    } catch (e) {
      console.warn('Realtime Socket connection error:', e);
    }
  }

  public openChat(conversationId: string) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('chat:open', { conversationId });
    }
  }

  public closeChat(conversationId: string) {
    if (this.socket && this.socket.connected) {
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
      this.socket.emit('v1.message.send', socketPayload);
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
      this.socket.emit('v1.message.receipt', payload);
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

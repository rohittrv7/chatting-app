import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'https://chatting-app-rme6.onrender.com';

class RealtimeSocketService {
  private socket: Socket | null = null;

  public connect(onMessageReceived?: (convId: string, sender: string, text: string) => void) {
    if (this.socket && this.socket.connected) return;

    try {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket'],
        autoConnect: true,
      });

      this.socket.on('connect', () => {
        console.log('Connected to NestJS WebSocket Realtime Gateway');
      });

      this.socket.on('message:receive', (data: any) => {
        if (data && typeof data === 'object') {
          const convId = data.conversationId?.toString() || 'conv_1';
          const sender = data.senderName?.toString() || 'Alex Morgan';
          const text = data.text?.toString() || '';

          if (onMessageReceived) {
            onMessageReceived(convId, sender, text);
          }
        }
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from Realtime Socket Gateway');
      });
    } catch (e) {
      console.warn('Realtime Socket connection error:', e);
    }
  }

  public sendMessage(conversationId: string, senderName: string, text: string) {
    if (this.socket) {
      this.socket.emit('message:send', {
        conversationId,
        senderName,
        text,
        timestamp: new Date().toISOString(),
      });
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

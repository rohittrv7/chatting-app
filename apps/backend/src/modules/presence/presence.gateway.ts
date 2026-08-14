import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { SocketEvent, TypingEventDto } from '@chat/shared-contracts';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class PresenceGateway {
  @WebSocketServer()
  server!: Server;

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.PRESENCE_TYPING)
  handleTyping(@ConnectedSocket() client: Socket, @MessageBody() payload: TypingEventDto) {
    const userId = client.handshake.query['userId'] as string;

    client.broadcast.emit(SocketEvent.PRESENCE_TYPING, {
      conversationId: payload.conversationId,
      userId,
      isTyping: payload.isTyping,
    });
  }
}

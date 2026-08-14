import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Minimal WebSocket gateway that exposes the Socket.io Server instance
 * so AuthService can emit device force-logout events without a circular
 * dependency on other gateway modules.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/' })
export class AuthGateway {
  @WebSocketServer()
  server!: Server;
}

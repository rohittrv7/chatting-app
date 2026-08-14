import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import {
  SocketEvent,
  CallOfferDto,
  CallAnswerDto,
  IceCandidateDto,
  CallRejectDto,
  CallEndDto,
} from '@chat/shared-contracts';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class CallGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallGateway.name);

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.CALL_OFFER)
  handleCallOffer(@ConnectedSocket() client: Socket, @MessageBody() payload: CallOfferDto) {
    const callerUserId = client.handshake.query['userId'] as string;
    this.logger.log(`Call Offer from ${callerUserId} to ${payload.targetUserId}`);

    this.server.to(`user_${payload.targetUserId}`).emit(SocketEvent.CALL_OFFER, {
      ...payload,
      callerUserId,
    });
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.CALL_ANSWER)
  handleCallAnswer(@ConnectedSocket() client: Socket, @MessageBody() payload: CallAnswerDto) {
    const calleeUserId = client.handshake.query['userId'] as string;
    this.logger.log(`Call Answer from ${calleeUserId} to ${payload.callerUserId}`);

    this.server.to(`user_${payload.callerUserId}`).emit(SocketEvent.CALL_ANSWER, {
      ...payload,
      calleeUserId,
    });
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.CALL_ICE_CANDIDATE)
  handleIceCandidate(@ConnectedSocket() client: Socket, @MessageBody() payload: IceCandidateDto) {
    const senderUserId = client.handshake.query['userId'] as string;

    this.server.to(`user_${payload.targetUserId}`).emit(SocketEvent.CALL_ICE_CANDIDATE, {
      ...payload,
      senderUserId,
    });
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.CALL_REJECT)
  handleCallReject(@ConnectedSocket() client: Socket, @MessageBody() payload: CallRejectDto) {
    this.server.to(`user_${payload.callerUserId}`).emit(SocketEvent.CALL_REJECT, payload);
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvent.CALL_END)
  handleCallEnd(@ConnectedSocket() client: Socket, @MessageBody() payload: CallEndDto) {
    this.server.to(`user_${payload.targetUserId}`).emit(SocketEvent.CALL_END, payload);
  }
}

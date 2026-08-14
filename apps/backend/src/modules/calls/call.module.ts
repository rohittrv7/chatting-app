import { Module } from '@nestjs/common';
import { CallGateway } from './call.gateway';

@Module({
  providers: [CallGateway],
  exports: [CallGateway],
})
export class CallModule {}

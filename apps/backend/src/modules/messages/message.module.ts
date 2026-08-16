import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { MessageGateway } from './message.gateway';
import { MessageRepository } from './message.repository';
import { MessageRedisService } from './message-redis.service';
import { PrismaService } from '../../database/prisma.service';

import { createRedisClient } from '../../common/utils/redis-factory';

const REDIS_CLIENT_PROVIDER = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService): Redis => {
    return createRedisClient(configService);
  },
  inject: [ConfigService],
};

@Module({
  imports: [ConfigModule],
  controllers: [MessageController],
  providers: [
    REDIS_CLIENT_PROVIDER,
    MessageService,
    MessageGateway,
    MessageRepository,
    MessageRedisService,
    PrismaService,
  ],
  exports: [MessageService, MessageGateway, MessageRepository, MessageRedisService],
})
export class MessageModule {}

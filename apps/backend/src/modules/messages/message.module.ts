import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { ChatGateway } from './message.gateway';
import { MessageRepository } from './message.repository';
import { MessageRedisService } from './message-redis.service';
import { PrismaService } from '../../database/prisma.service';
import { createRedisClient } from '../../common/utils/redis-factory';
import { ConversationModule } from '../conversations/conversation.module';

import { PushNotificationService } from './push-notification.service';

const REDIS_CLIENT_PROVIDER = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService): Redis => {
    return createRedisClient(configService);
  },
  inject: [ConfigService],
};

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET', 'super_secret_jwt_access_key_12345'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    forwardRef(() => ConversationModule),
  ],
  controllers: [MessageController],
  providers: [
    REDIS_CLIENT_PROVIDER,
    MessageService,
    ChatGateway,
    MessageRepository,
    MessageRedisService,
    PushNotificationService,
    PrismaService,
  ],
  exports: [
    MessageService,
    ChatGateway,
    MessageRepository,
    MessageRedisService,
    PushNotificationService,
  ],
})
export class MessageModule {}

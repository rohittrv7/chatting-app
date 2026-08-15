import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthGateway } from './auth.gateway';
import { OtpRedisService } from './otp-redis.service';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../database/prisma.service';

/**
 * A shared Redis client factory token reused across the auth module.
 * ioredis is already a dependency; we inject it directly rather than
 * pulling in a full NestJS Redis module.
 */
const REDIS_CLIENT_PROVIDER = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService): Redis => {
    const client = new Redis({
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 1000, 3000)),
    });
    client.on('error', () => {
      // Suppress unhandled crash — in-memory fallback handles cache operations when Redis is offline
    });
    return client;
  },
  inject: [ConfigService],
};

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'super_secret_jwt_access_key_12345'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    /**
     * OTP send-endpoint throttle: 5 requests per 10 minutes per IP.
     * Uses in-memory storage (no Redis dependency required for throttling).
     * Requirement 1.1, 22.2
     */
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'otp',
          ttl: 10 * 60 * 1000, // 10 minutes in ms
          limit: 5,
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    REDIS_CLIENT_PROVIDER,
    AuthService,
    AuthRepository,
    AuthGateway,
    OtpRedisService,
    JwtStrategy,
    PrismaService,
  ],
  exports: [AuthService, AuthRepository, JwtModule, PassportModule],
})
export class AuthModule {}

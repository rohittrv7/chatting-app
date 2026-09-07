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
import { MediaModule } from '../media/media.module';
import { TokenCleanupService } from './token-cleanup.service';
import { createRedisClient } from '../../common/utils/redis-factory';

const REDIS_CLIENT_PROVIDER = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService): Redis => {
    return createRedisClient(configService);
  },
  inject: [ConfigService],
};

@Module({
  imports: [
    MediaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        // FIX: Crash loudly in production if JWT_SECRET is not set.
        // A missing/weak secret would let attackers forge tokens.
        if (!secret && process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET environment variable is required in production');
        }
        return {
          secret: secret || 'dev_only_jwt_secret_change_in_production',
          signOptions: { expiresIn: '15m' },
        };
      },
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
    // FIX 3: Daily cron job — deletes expired RefreshToken rows at 03:00 UTC.
    // Requires ScheduleModule.forRoot() in AppModule (already registered).
    TokenCleanupService,
  ],
  exports: [AuthService, AuthRepository, JwtModule, PassportModule, TokenCleanupService],
})
export class AuthModule {}

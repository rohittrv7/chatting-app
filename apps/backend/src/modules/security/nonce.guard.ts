import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Redis from 'ioredis';

@Injectable()
export class NonceGuard implements CanActivate {
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      lazyConnect: true,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const nonce = request.headers['x-nonce'] as string | undefined;

    // Nonce is optional — if absent, allow through
    if (!nonce) {
      return true;
    }

    const key = `nonce:${nonce}`;
    const ttlSeconds = 300; // 5 minutes

    // SET key value NX EX ttl — returns "OK" if set (key did not exist), null if key already existed
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');

    if (result === null) {
      // Key already existed → replay detected
      throw new HttpException(
        {
          success: false,
          code: 'REPLAY_DETECTED',
          message: 'Duplicate nonce detected',
          details: null,
        },
        HttpStatus.CONFLICT,
      );
    }

    return true;
  }
}

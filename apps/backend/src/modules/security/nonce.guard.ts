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
import { createRedisClient } from '../../common/utils/redis-factory';

@Injectable()
export class NonceGuard implements CanActivate {
  private readonly redis: Redis;
  private readonly memoryNonces = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {
    this.redis = createRedisClient(this.configService);
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

    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
        if (result === null) {
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
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // fallback to memory
    }

    // In-memory nonce check
    const now = Date.now();
    const existingExpiry = this.memoryNonces.get(nonce);
    if (existingExpiry && existingExpiry > now) {
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

    this.memoryNonces.set(nonce, now + ttlSeconds * 1000);
    return true;
  }
}

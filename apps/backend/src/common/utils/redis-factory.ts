import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export function createRedisClient(
  configService: ConfigService,
  customOptions?: RedisOptions,
): Redis {
  const redisUrl = configService.get<string>('REDIS_URL');

  let client: Redis;

  if (redisUrl && redisUrl.trim().length > 0) {
    const isTls = redisUrl.startsWith('rediss://');
    client = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      tls: isTls ? { rejectUnauthorized: false } : undefined,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 1000, 3000)),
      ...customOptions,
    });
  } else {
    client = new Redis({
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
      password: configService.get<string>('REDIS_PASSWORD'),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 1000, 3000)),
      ...customOptions,
    });
  }

  client.on('error', () => {
    // Suppress unhandled crash — in-memory fallbacks handle cache operations when Redis is unreachable
  });

  return client;
}

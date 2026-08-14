export const APP_CONSTANTS = {
  APP_NAME: 'Chatting System',
  API_PREFIX: 'api/v1',
  JWT_ACCESS_EXPIRATION: '15m',
  JWT_REFRESH_EXPIRATION: '7d',
  PREKEY_POOL_MIN_THRESHOLD: 15,
  PREKEY_POOL_REPLENISH_COUNT: 50,
  DEFAULT_PAGE_SIZE: 30,
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
  CALL_ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
} as const;

export interface AppEnvironment {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  MINIO_ENDPOINT: string;
  MINIO_PORT: number;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET_NAME: string;
  COTURN_SECRET: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
}

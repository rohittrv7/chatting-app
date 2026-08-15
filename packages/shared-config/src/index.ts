export const APP_CONSTANTS = {
  APP_NAME: 'Chatting System',
  API_PREFIX: 'api/v1',
  JWT_ACCESS_EXPIRATION: '15m',
  JWT_REFRESH_EXPIRATION: '7d',
  PREKEY_POOL_MIN_THRESHOLD: 15,
  PREKEY_POOL_REPLENISH_COUNT: 50,
  DEFAULT_PAGE_SIZE: 30,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB Max Attachment Size
  CALL_ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }],
} as const;

export interface AppEnvironment {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  B2_BUCKET_NAME: string;
  B2_REGION?: string;
  B2_ENDPOINT?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  COTURN_SECRET: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
}

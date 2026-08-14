import { z } from 'zod';

/**
 * Zod schema for all required environment variables.
 * Use `validateEnv(process.env)` at application startup to fail fast
 * on misconfiguration.
 *
 * Validates: Requirements 38.3, 35.1
 */
export const envSchema = z.object({
  // ── Runtime ─────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v > 0 && v <= 65535, {
      message: 'PORT must be a valid port number (1–65535)',
    }),

  CORS_ORIGIN: z
    .string()
    .min(1, 'CORS_ORIGIN is required')
    .describe('Comma-separated list of allowed CORS origins, or a single URL'),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid PostgreSQL connection string')
    .startsWith('postgresql://', {
      message: 'DATABASE_URL must start with postgresql://',
    }),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: z
    .string()
    .url('REDIS_URL must be a valid URL')
    .startsWith('redis', {
      message: 'REDIS_URL must start with redis:// or rediss://',
    }),

  // ── JWT / Auth ────────────────────────────────────────────────────────────
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long'),

  JWT_EXPIRES_IN: z
    .string()
    .optional()
    .default('15m')
    .describe('Access token lifetime — e.g. 15m, 1h'),

  REFRESH_TOKEN_EXPIRES_IN: z
    .string()
    .optional()
    .default('7d')
    .describe('Refresh token lifetime — e.g. 7d, 30d'),

  // ── MinIO (object storage) ────────────────────────────────────────────────
  MINIO_ENDPOINT: z
    .string()
    .min(1, 'MINIO_ENDPOINT is required'),

  MINIO_PORT: z
    .string()
    .optional()
    .default('9000')
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v > 0 && v <= 65535, {
      message: 'MINIO_PORT must be a valid port number (1–65535)',
    }),

  MINIO_ACCESS_KEY: z
    .string()
    .min(1, 'MINIO_ACCESS_KEY is required'),

  MINIO_SECRET_KEY: z
    .string()
    .min(8, 'MINIO_SECRET_KEY must be at least 8 characters long'),

  MINIO_BUCKET: z
    .string()
    .min(1, 'MINIO_BUCKET is required')
    .regex(/^[a-z0-9][a-z0-9\-.]{1,61}[a-z0-9]$/, {
      message:
        'MINIO_BUCKET must be a valid S3-compatible bucket name (3–63 lower-case chars)',
    }),

  // ── Firebase (push notifications) ─────────────────────────────────────────
  FIREBASE_PROJECT_ID: z
    .string()
    .min(1, 'FIREBASE_PROJECT_ID is required'),

  FIREBASE_PRIVATE_KEY: z
    .string()
    .min(1, 'FIREBASE_PRIVATE_KEY is required')
    .describe('PEM-encoded RSA private key for Firebase Admin SDK'),

  FIREBASE_CLIENT_EMAIL: z
    .string()
    .email('FIREBASE_CLIENT_EMAIL must be a valid email address'),

  // ── Rate limiting (NestJS Throttler) ──────────────────────────────────────
  THROTTLE_TTL: z
    .string()
    .optional()
    .default('60000')
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v > 0, {
      message: 'THROTTLE_TTL must be a positive integer (milliseconds)',
    }),

  THROTTLE_LIMIT: z
    .string()
    .optional()
    .default('100')
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v > 0, {
      message: 'THROTTLE_LIMIT must be a positive integer',
    }),
});

/** Inferred TypeScript type of the validated environment object. */
export type Env = z.infer<typeof envSchema>;

/**
 * Validates `rawEnv` against `envSchema` and returns the typed, coerced
 * environment object.  Throws a descriptive `Error` listing every invalid or
 * missing variable when validation fails — designed to crash the process at
 * startup so misconfigurations are never silently swallowed.
 *
 * @example
 * // In your NestJS main.ts or ConfigModule factory:
 * import { validateEnv } from '@chat/shared-config';
 * const env = validateEnv(process.env);
 */
export function validateEnv(rawEnv: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  • ${e.path.join('.')} — ${e.message}`)
      .join('\n');

    throw new Error(
      `Environment validation failed:\n${formatted}\n\n` +
        `Ensure all required variables are set before starting the application.`,
    );
  }

  return result.data;
}

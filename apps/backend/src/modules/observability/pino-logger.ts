/**
 * Pino logger configuration for global structured JSON logging.
 *
 * Configures pino to emit JSON logs with level, timestamp, requestId, and
 * message fields as required by Requirement 23.6.
 * Ensures that sensitive fields (JWT, OTP, keys) are never logged (Req 23.7).
 */
import pino, { Logger } from 'pino';

/** Fields that must never appear in log output (Requirement 23.7). */
const REDACTED_PATHS: string[] = [
  'req.headers.authorization',
  'req.body.otp',
  'req.body.refreshToken',
  'req.body.token',
  'req.body.privateKey',
  'req.body.identityKey',
  'req.body.signedPreKey',
  'req.body.oneTimePreKeys',
  'req.body.encryptionKey',
  'req.body.password',
  'body.otp',
  'body.refreshToken',
  'body.token',
  'body.privateKey',
  'body.identityKey',
  'body.signedPreKey',
  'body.oneTimePreKeys',
  'body.encryptionKey',
  'body.password',
];

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

export const pinoLogger: Logger = pino({
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: undefined, // removes pid and hostname from every log line
  messageKey: 'message',
});

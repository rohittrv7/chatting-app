/**
 * ObservabilityModule — encapsulates all observability infrastructure:
 *   - pino structured JSON logging (bound to NestJS Logger via LoggerModule)
 *   - PrometheusInterceptor for request count + duration metrics
 *   - OtelService for OpenTelemetry tracer provider + requestId span attributes
 *
 * Requirements: 23.3, 23.4, 23.5, 23.6, 23.7
 */
import { Module, Global } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { IncomingMessage } from 'http';
import { OtelService } from './otel.service';
import { PrometheusInterceptor } from './prometheus.interceptor';
import { pinoLogger } from './pino-logger';

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        logger: pinoLogger,
        // Attach a requestId to every request log (Requirement 23.6)
        genReqId(req: IncomingMessage): string {
          // Re-use an existing X-Request-ID header when provided by a reverse proxy
          const existingId = (req as IncomingMessage & { headers: Record<string, string | string[] | undefined> }).headers['x-request-id'];
          if (existingId && typeof existingId === 'string' && existingId.length > 0) {
            return existingId;
          }
          return uuidv4();
        },
        // Serialise request/response with standard pino-http fields
        serializers: {
          req(req: IncomingMessage & { id?: string }) {
            return {
              id: req.id,
              method: req.method,
              url: req.url,
            };
          },
        },
        // Do not log successful health-check or metrics scrapes (reduces noise)
        autoLogging: {
          ignore(req: IncomingMessage) {
            return (
              req.url === '/api/v1/health' ||
              req.url === '/api/v1/health/ready' ||
              req.url === '/metrics'
            );
          },
        },
        // Redact sensitive fields in request body before logging (Requirement 23.7)
        redact: {
          paths: [
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
          ],
          censor: '[REDACTED]',
        },
        customSuccessMessage(req, res) {
          return `${req.method} ${req.url} ${res.statusCode}`;
        },
        customErrorMessage(req, res, err) {
          return `${req.method} ${req.url} ${res.statusCode} - ${(err as Error).message}`;
        },
      },
    }),
  ],
  providers: [OtelService, PrometheusInterceptor],
  exports: [OtelService, PrometheusInterceptor],
})
export class ObservabilityModule {}

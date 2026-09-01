/**
 * OtelService — initialises the OpenTelemetry tracer provider and exposes
 * helpers for creating spans with requestId propagation, query timing,
 * redis, api, message queue, file storage, grpc, and error tracing.
 *
 * Requirements: 23.4, 23.5
 */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { trace, Tracer, Span, SpanStatusCode, context, Context } from '@opentelemetry/api';

@Injectable()
export class OtelService implements OnModuleInit {
  private readonly logger = new Logger(OtelService.name);
  private sdk: NodeSDK | null = null;
  private readonly serviceName: string;

  constructor() {
    this.serviceName = process.env.OTEL_SERVICE_NAME ?? 'whatsapp-style-chat-backend';
  }

  onModuleInit(): void {
    this.initSdk();
  }

  private initSdk(): void {
    try {
      this.sdk = new NodeSDK({
        serviceName: this.serviceName,
        instrumentations: [
          getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': { enabled: false },
          }),
        ],
      });

      this.sdk.start();
      console.log(
        '\x1b[96m📊 [OpenTelemetry]\x1b[0m \x1b[1mFull observability active (Traces: DB, Redis, API, Sockets, Storage, gRPC, Errors)\x1b[0m',
      );
    } catch (err) {
      this.logger.error(
        'Failed to start OpenTelemetry SDK',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Returns the tracer for the given instrument name (defaults to serviceName). */
  getTracer(name?: string): Tracer {
    return trace.getTracer(name ?? this.serviceName);
  }

  /**
   * Starts a new span and sets the requestId as a span attribute (Req 23.5).
   */
  startSpan(spanName: string, requestId?: string, parentContext?: Context): Span {
    const tracer = this.getTracer();
    const ctx = parentContext ?? context.active();
    const span = tracer.startSpan(spanName, {}, ctx);
    if (requestId) {
      span.setAttribute('requestId', requestId);
    }
    return span;
  }

  /**
   * Wraps an async operation in an OTel span with requestId propagation.
   */
  async traceAsync<T>(
    spanName: string,
    requestId: string,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    const span = this.startSpan(spanName, requestId);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Record Database Query Timing & Details in OpenTelemetry Span
   */
  recordDbQuery(model: string, action: string, durationMs: number, error?: Error): void {
    const tracer = this.getTracer('prisma-db');
    const span = tracer.startSpan(`db.${model}.${action}`);
    span.setAttribute('db.system', 'postgresql');
    span.setAttribute('db.model', model);
    span.setAttribute('db.action', action);
    span.setAttribute('db.duration_ms', durationMs);
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      this.logger.warn(
        `\x1b[91m[OTel DB Error]\x1b[0m ${model}.${action} (${durationMs}ms): ${error.message}`,
      );
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
      if (durationMs > 20) {
        this.logger.debug(
          `\x1b[96m[OTel DB Query]\x1b[0m ${model}.${action} took ${durationMs.toFixed(1)}ms`,
        );
      }
    }
    span.end();
  }

  /**
   * Record Redis Operation in OpenTelemetry Span
   */
  recordRedisOp(command: string, key: string, durationMs: number, error?: Error): void {
    const tracer = this.getTracer('redis-cache');
    const span = tracer.startSpan(`redis.${command.toLowerCase()}`);
    span.setAttribute('db.system', 'redis');
    span.setAttribute('redis.command', command);
    span.setAttribute('redis.key', key);
    span.setAttribute('redis.duration_ms', durationMs);
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      this.logger.warn(
        `\x1b[91m[OTel Redis Error]\x1b[0m ${command} ${key} (${durationMs}ms): ${error.message}`,
      );
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  /**
   * Record Socket / Message Queue Event in OpenTelemetry Span
   */
  recordSocketEvent(event: string, recipientId?: string, durationMs?: number, error?: Error): void {
    const tracer = this.getTracer('websocket-queue');
    const span = tracer.startSpan(`socket.emit.${event}`);
    span.setAttribute('messaging.system', 'socket.io');
    span.setAttribute('messaging.destination', event);
    if (recipientId) span.setAttribute('messaging.recipient_id', recipientId);
    if (durationMs !== undefined) span.setAttribute('messaging.duration_ms', durationMs);
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      this.logger.warn(`\x1b[91m[OTel Socket Error]\x1b[0m ${event}: ${error.message}`);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  /**
   * Record File Storage / Cloud Upload in OpenTelemetry Span
   */
  recordFileStorage(
    storage: 'backblaze_b2' | 'local_fs',
    fileName: string,
    sizeBytes: number,
    durationMs: number,
    error?: Error,
  ): void {
    const tracer = this.getTracer('file-storage');
    const span = tracer.startSpan(`storage.${storage}.upload`);
    span.setAttribute('storage.system', storage);
    span.setAttribute('storage.file_name', fileName);
    span.setAttribute('storage.file_size_bytes', sizeBytes);
    span.setAttribute('storage.duration_ms', durationMs);
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      this.logger.warn(
        `\x1b[91m[OTel Storage Error]\x1b[0m ${storage} ${fileName}: ${error.message}`,
      );
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
      this.logger.log(
        `\x1b[92m[OTel Storage Upload]\x1b[0m ${storage} file="${fileName}" size=${(sizeBytes / 1024).toFixed(1)}KB in ${durationMs}ms`,
      );
    }
    span.end();
  }

  /**
   * Record gRPC / External HTTP in OpenTelemetry Span
   */
  recordGrpcOrRemoteCall(service: string, method: string, durationMs: number, error?: Error): void {
    const tracer = this.getTracer('grpc-remote');
    const span = tracer.startSpan(`rpc.${service}/${method}`);
    span.setAttribute('rpc.service', service);
    span.setAttribute('rpc.method', method);
    span.setAttribute('rpc.duration_ms', durationMs);
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
        this.logger.log('OpenTelemetry SDK shut down gracefully');
      } catch (err) {
        this.logger.error(
          'Error shutting down OpenTelemetry SDK',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
}

/**
 * OtelService — initialises the OpenTelemetry tracer provider and exposes
 * helpers for creating spans with requestId propagation.
 *
 * Requirements: 23.4, 23.5
 */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  trace,
  Tracer,
  Span,
  SpanStatusCode,
  context,
  Context,
} from '@opentelemetry/api';

@Injectable()
export class OtelService implements OnModuleInit {
  private readonly logger = new Logger(OtelService.name);
  private sdk: NodeSDK | null = null;
  private readonly serviceName: string;

  constructor() {
    this.serviceName =
      process.env.OTEL_SERVICE_NAME ?? 'whatsapp-style-chat-backend';
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
            // Disable noisy fs instrumentation to avoid log spam
            '@opentelemetry/instrumentation-fs': { enabled: false },
          }),
        ],
      });

      this.sdk.start();
      this.logger.log(
        `OpenTelemetry SDK started for service "${this.serviceName}"`,
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
   * The caller is responsible for ending the span.
   */
  startSpan(
    spanName: string,
    requestId: string,
    parentContext?: Context,
  ): Span {
    const tracer = this.getTracer();
    const ctx = parentContext ?? context.active();
    const span = tracer.startSpan(spanName, {}, ctx);
    span.setAttribute('requestId', requestId);
    return span;
  }

  /**
   * Wraps an async operation in an OTel span with requestId propagation.
   * Sets span status to ERROR on exception and rethrows.
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

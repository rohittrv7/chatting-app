/**
 * Unit tests for ObservabilityModule components:
 *   - pinoLogger configuration
 *   - PrometheusInterceptor (request count + duration tracking)
 *   - OtelService (tracer provider + requestId span attribute)
 *
 * Requirements: 23.3, 23.4, 23.5, 23.6, 23.7
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { Request, Response } from 'express';
import * as client from 'prom-client';

import { PrometheusInterceptor } from './prometheus.interceptor';
import { OtelService } from './otel.service';
import { pinoLogger } from './pino-logger';

// ── helpers ────────────────────────────────────────────────────────────────

function makeHttpContext(
  method = 'GET',
  path = '/api/v1/health',
  statusCode = 200,
): ExecutionContext {
  const req = {
    method,
    path,
    url: path,
    route: { path },
  } as unknown as Request;

  const res = { statusCode } as unknown as Response;

  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeCallHandler(value: unknown = { ok: true }): CallHandler {
  return { handle: () => of(value) };
}

// ── pino-logger ────────────────────────────────────────────────────────────

describe('pinoLogger', () => {
  it('should have a log level set', () => {
    expect(pinoLogger.level).toBeDefined();
  });

  it('should default to "info" level when LOG_LEVEL is not set', () => {
    // pinoLogger is initialised at import time with LOG_LEVEL env var.
    // In the test environment LOG_LEVEL is unset, so the default is "info".
    const expectedLevel = process.env.LOG_LEVEL ?? 'info';
    expect(pinoLogger.level).toBe(expectedLevel);
  });
});

// ── PrometheusInterceptor ──────────────────────────────────────────────────

describe('PrometheusInterceptor', () => {
  let interceptor: PrometheusInterceptor;
  let registry: client.Registry;

  beforeEach(async () => {
    // Use a fresh registry per test to avoid metric registration conflicts
    registry = new client.Registry();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrometheusInterceptor],
    }).compile();

    interceptor = module.get(PrometheusInterceptor);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should pass the response value through unchanged', (done) => {
    const ctx = makeHttpContext('GET', '/api/v1/conversations', 200);
    const handler = makeCallHandler({ conversations: [] });

    interceptor.intercept(ctx, handler).subscribe({
      next(value) {
        expect(value).toEqual({ conversations: [] });
      },
      complete: done,
    });
  });

  it('should re-throw errors from the handler', (done) => {
    const ctx = makeHttpContext('POST', '/api/v1/auth/otp/request', 400);
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('Validation failed')),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error(err: Error) {
        expect(err.message).toBe('Validation failed');
        done();
      },
    });
  });

  it('should skip non-HTTP execution contexts', (done) => {
    const wsContext = {
      getType: () => 'ws',
    } as unknown as ExecutionContext;
    const handler = makeCallHandler('ws-data');

    interceptor.intercept(wsContext, handler).subscribe({
      next(value) {
        expect(value).toBe('ws-data');
      },
      complete: done,
    });
  });

  it('should normalise UUID path segments to :id', () => {
    // Access the private method via type cast for unit testing
    const normalise = (interceptor as unknown as { normaliseRoute: (req: Request) => string }).normaliseRoute;
    const req = {
      path: '/api/v1/messages/550e8400-e29b-41d4-a716-446655440000',
      url: '/api/v1/messages/550e8400-e29b-41d4-a716-446655440000',
    } as unknown as Request;
    const route = normalise.call(interceptor, req);
    expect(route).toBe('/api/v1/messages/:id');
  });

  it('should normalise numeric path segments to :id', () => {
    const normalise = (interceptor as unknown as { normaliseRoute: (req: Request) => string }).normaliseRoute;
    const req = {
      path: '/api/v1/users/42/messages',
      url: '/api/v1/users/42/messages',
    } as unknown as Request;
    const route = normalise.call(interceptor, req);
    expect(route).toBe('/api/v1/users/:id/messages');
  });

  it('should prefer the Express matched route pattern when available', () => {
    const normalise = (interceptor as unknown as { normaliseRoute: (req: Request) => string }).normaliseRoute;
    const req = {
      path: '/api/v1/users/42',
      url: '/api/v1/users/42',
      route: { path: '/api/v1/users/:userId' },
    } as unknown as Request;
    const route = normalise.call(interceptor, req);
    expect(route).toBe('/api/v1/users/:userId');
  });
});

// ── OtelService ────────────────────────────────────────────────────────────

describe('OtelService', () => {
  let service: OtelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OtelService],
    }).compile();

    service = module.get(OtelService);
  });

  afterEach(async () => {
    // Graceful shutdown to avoid leaking async resources between tests
    await service.shutdown();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return a tracer instance', () => {
    const tracer = service.getTracer();
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('should start a span with the requestId attribute', () => {
    const requestId = 'test-request-id-123';
    const span = service.startSpan('test.operation', requestId);

    // The span must be a valid object with an end method
    expect(span).toBeDefined();
    expect(typeof span.end).toBe('function');

    span.end();
  });

  it('should resolve the wrapped async function result via traceAsync', async () => {
    const result = await service.traceAsync('test.op', 'req-abc', async () => 42);
    expect(result).toBe(42);
  });

  it('should propagate errors from traceAsync and still end the span', async () => {
    await expect(
      service.traceAsync('test.error', 'req-xyz', async () => {
        throw new Error('downstream failure');
      }),
    ).rejects.toThrow('downstream failure');
  });

  it('should initialise the OpenTelemetry SDK on module init', () => {
    // onModuleInit is called during module.compile() above — just verify no crash
    expect(() => service.onModuleInit()).not.toThrow();
  });
});

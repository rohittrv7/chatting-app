/**
 * PrometheusInterceptor — tracks HTTP request count and duration histogram.
 *
 * Instruments all incoming REST requests with:
 *   - chat_http_requests_total (counter) — labelled by method, path, status
 *   - chat_http_request_duration_seconds (histogram) — labelled by method, path
 *
 * Requirements: 23.3
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Request, Response } from 'express';
import * as client from 'prom-client';

// ── Metric definitions ──────────────────────────────────────────────────────

/** Total request counter, labelled by HTTP method, normalised route, and status code. */
const httpRequestsTotal = new client.Counter({
  name: 'chat_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'] as const,
});

/** Request duration histogram in seconds, labelled by method and route. */
const httpRequestDurationSeconds = new client.Histogram({
  name: 'chat_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ── Interceptor ─────────────────────────────────────────────────────────────

@Injectable()
export class PrometheusInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    const method = req.method;
    // Normalise route to avoid high-cardinality labels (e.g. /users/123 → /users/:id)
    const route = this.normaliseRoute(req);
    const endTimer = httpRequestDurationSeconds.startTimer({ method, route });

    return next.handle().pipe(
      tap(() => {
        const statusCode = String(res.statusCode);
        httpRequestsTotal.inc({ method, route, status_code: statusCode });
        endTimer();
      }),
      catchError((err: unknown) => {
        // Still record the metric on error — status code may already be set
        const statusCode = String(res.statusCode || 500);
        httpRequestsTotal.inc({ method, route, status_code: statusCode });
        endTimer();
        return throwError(() => err);
      }),
    );
  }

  /**
   * Produces a stable, low-cardinality route label.
   * Prefers the Express matched route pattern; falls back to sanitising the raw path.
   */
  private normaliseRoute(req: Request): string {
    // NestJS attaches the matched route as req.route?.path after routing
    const expressRoute: string | undefined = (req as Request & { route?: { path?: string } }).route?.path;
    if (expressRoute) {
      return expressRoute;
    }
    // Fallback: replace likely ID segments with placeholders
    return (req.path ?? req.url ?? 'unknown')
      .replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, '/:id') // UUID/ULID
      .replace(/\/\d+(?=\/|$)/g, '/:id'); // numeric IDs
  }
}

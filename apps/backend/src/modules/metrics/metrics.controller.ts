/**
 * MetricsController — exposes GET /metrics in Prometheus text exposition format.
 *
 * The endpoint is mounted at the root level (outside /api/v1) so that standard
 * Prometheus scrapers can reach it at the conventional path.
 *
 * Requirements: 23.3
 */
import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import * as client from 'prom-client';

// Collect default Node.js process metrics once at module load time.
// The collectDefaultMetrics function is idempotent — calling it multiple times
// with the same prefix is safe because prom-client guards against duplicate
// metric registrations.
client.collectDefaultMetrics({ prefix: 'chat_' });

@ApiTags('Health & Observability')
@Controller('metrics')
export class MetricsController {
  /**
   * Returns all registered Prometheus metrics in text exposition format.
   *
   * Requirement 23.3 specifies GET /metrics in Prometheus text format.
   * The NestJS global prefix (/api/v1) is applied but the endpoint path is kept
   * at `/metrics` relative to the controller root so that `GET /api/v1/metrics`
   * is the resolved URL — consistent with the rest of the API.
   * If the deployment requires the conventional bare `/metrics` path, a reverse-proxy
   * rewrite rule can map `/metrics` → `/api/v1/metrics` without code changes.
   */
  @Get()
  @ApiExcludeEndpoint() // hide from Swagger — not part of the application API
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.end(metrics);
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  colors,
  colorizeMethod,
  colorizeStatus,
  colorizeDuration,
  formatBytes,
  getTimestamp,
} from '../utils/logger-colors';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const startHr = process.hrtime.bigint();
    const url = req.originalUrl || req.url;
    const method = req.method;
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || '127.0.0.1';
    const cleanIp = ip.replace(/^.*:/, '') || '127.0.0.1';
    const reqIdShort = req.requestId ? `[${req.requestId.slice(0, 8)}]` : '';

    // Ignore high-frequency polling/metrics to avoid spamming if preferred, or log cleanly
    const isMetrics = url === '/metrics';

    if (!isMetrics) {
      // Inbound log marker
      const inboundMsg = `${getTimestamp()} ${colors.dim}➜${colors.reset} ${colorizeMethod(method)} ${colors.brightWhite}${url}${colors.reset} ${colors.gray}from ${cleanIp}${reqIdShort ? ` ${reqIdShort}` : ''}${colors.reset}`;
      console.log(inboundMsg);
    }

    res.on('finish', () => {
      if (isMetrics) return;

      const endHr = process.hrtime.bigint();
      const durationMs = Number(endHr - startHr) / 1_000_000;
      const statusCode = res.statusCode;
      const contentLengthHeader = res.getHeader('content-length');
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader as string, 10)
        : undefined;
      const sizeStr = formatBytes(contentLength);

      let icon = `${colors.brightGreen}✔${colors.reset}`;
      if (statusCode >= 400 && statusCode < 500) {
        icon = `${colors.brightYellow}⚠${colors.reset}`;
      } else if (statusCode >= 500) {
        icon = `${colors.brightRed}✖${colors.reset}`;
      }

      const statusBadge = colorizeStatus(statusCode);
      const durationBadge = colorizeDuration(durationMs);

      const logLine = `${getTimestamp()} ${icon} ${colorizeMethod(method)} ${colors.brightWhite}${url.padEnd(30, ' ')}${colors.reset} ${statusBadge.padEnd(20, ' ')} ${durationBadge} ${colors.dim}${sizeStr.padStart(8, ' ')}${colors.reset} ${colors.gray}[${cleanIp}]${reqIdShort ? ` ${reqIdShort}` : ''}${colors.reset}`;

      console.log(logLine);
    });

    next();
  }
}

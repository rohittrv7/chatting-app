import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Generates a UUIDv4 `requestId` for every incoming HTTP request.
 * - Attaches `req.requestId` for downstream use (logging, filters, interceptors).
 * - Sets the `X-Request-Id` response header so clients can correlate requests.
 * Satisfies Requirements 20.3, 20.6.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    // Attach to the request object so guards, filters, and interceptors can read it
    (req as Request & { requestId: string }).requestId = requestId;
    // Set the response header immediately so it is present on all responses,
    // including error responses handled by HttpExceptionFilter.
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

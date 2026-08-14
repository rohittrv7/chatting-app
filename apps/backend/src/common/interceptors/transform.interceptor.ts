import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponseEnvelope } from '@chat/shared-contracts';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

/**
 * Wraps every successful response in the standard success envelope:
 *
 * ```json
 * { "success": true, "message": "OK", "data": <original>, "timestamp": "<iso>" }
 * ```
 *
 * Also echoes the `X-Request-Id` header (set by RequestIdMiddleware) so it is
 * visible on success responses as well as error responses.
 *
 * Satisfies Requirements 20.1, 20.2, 20.3.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponseEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponseEnvelope<T>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request & { requestId?: string }>();
    const response = httpContext.getResponse<Response>();

    return next.handle().pipe(
      map((data: T) => {
        // Ensure X-Request-Id is reflected on success responses too.
        // (The middleware already sets it, but this is an extra safety net.)
        const requestId = request?.requestId;
        if (requestId && !response.getHeader(REQUEST_ID_HEADER)) {
          response.setHeader(REQUEST_ID_HEADER, requestId);
        }

        return {
          success: true,
          message: 'OK',
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

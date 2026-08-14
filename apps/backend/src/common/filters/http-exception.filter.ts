import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorEnvelope } from '@chat/shared-contracts';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

/** Maps HTTP status codes to design-specified UPPER_SNAKE_CASE error codes. */
const HTTP_STATUS_TO_CODE: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Global exception filter that formats every error — including unhandled
 * runtime exceptions — as the standard error envelope:
 *
 * ```json
 * { "success": false, "code": "UPPER_SNAKE_CASE", "message": "…", "details": {} }
 * ```
 *
 * Stack traces and raw internal errors are suppressed when
 * `NODE_ENV !== 'development'`, satisfying Requirements 20.1, 20.2.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly isDevelopment: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected internal error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorCode = HTTP_STATUS_TO_CODE[status] ?? `HTTP_${status}`;
      const resPayload = exception.getResponse();

      if (typeof resPayload === 'string') {
        message = resPayload;
      } else if (typeof resPayload === 'object' && resPayload !== null) {
        const payloadObj = resPayload as Record<string, unknown>;

        // NestJS ValidationPipe produces an array of messages
        if (Array.isArray(payloadObj['message'])) {
          errorCode = 'VALIDATION_ERROR';
          message = 'Validation failed for incoming payload';
          details = { validationErrors: payloadObj['message'] };
        } else {
          // Use the code/error field from the payload when it carries a
          // design-specified code (e.g. REPLAY_DETECTED, USER_BLOCKED, …)
          const payloadCode = (payloadObj['code'] ?? payloadObj['error']) as string | undefined;
          if (payloadCode) {
            // Only use it when it looks like UPPER_SNAKE_CASE (custom code)
            errorCode = /^[A-Z][A-Z0-9_]+$/.test(payloadCode)
              ? payloadCode
              : errorCode;
          }
          message = (payloadObj['message'] as string) || message;
        }
      }

      // In development, include the original stack for faster debugging
      if (this.isDevelopment) {
        details = { ...details, stack: exception.stack };
      }
    } else if (exception instanceof Error) {
      message = this.isDevelopment ? exception.message : 'An unexpected internal error occurred';
      if (this.isDevelopment) {
        details = { stack: exception.stack };
      }
    }

    // Ensure X-Request-Id is set (middleware sets it, but guard against edge cases)
    const requestId = request?.requestId;
    if (requestId && !response.getHeader(REQUEST_ID_HEADER)) {
      response.setHeader(REQUEST_ID_HEADER, requestId);
    }

    const errorEnvelope: ApiErrorEnvelope = {
      success: false,
      code: errorCode,
      message,
      details: Object.keys(details).length > 0 ? details : undefined,
    };

    response.status(status).json(errorEnvelope);
  }
}

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/** HTTP methods that mutate state and therefore require CSRF protection. */
const STATE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Safe methods pass through without any CSRF check
    if (!STATE_MUTATING_METHODS.has(method)) {
      return true;
    }

    // Double-submit cookie pattern:
    //   - Read token from header  : x-csrf-token
    //   - Read token from cookie  : _csrf
    // Both must be present and identical.
    const headerToken = request.headers['x-csrf-token'] as string | undefined;
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[
      '_csrf'
    ];

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      throw new HttpException(
        {
          success: false,
          code: 'CSRF_VIOLATION',
          message: 'CSRF token invalid or missing',
          details: null,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}

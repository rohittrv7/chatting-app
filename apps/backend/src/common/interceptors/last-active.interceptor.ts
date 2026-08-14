import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../decorators/user.decorator';

/**
 * Updates Device.lastActiveAt on every authenticated request.
 * Skipped when there is no authenticated user (public routes).
 */
@Injectable()
export class LastActiveInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.deviceId) {
      return next.handle();
    }

    // Fire-and-forget: update lastActiveAt without blocking the response
    return next.handle().pipe(
      tap(() => {
        this.prisma.device
          .update({
            where: { id: user.deviceId },
            data: { lastActiveAt: new Date() },
          })
          .catch(() => {
            // Silently ignore errors (e.g., device deleted mid-request)
          });
      }),
    );
  }
}

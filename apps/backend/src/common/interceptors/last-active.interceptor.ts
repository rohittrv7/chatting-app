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
  private static readonly lastUpdateMap = new Map<string, number>();
  private static readonly THROTTLE_MS = 60_000; // At most once per 60 seconds per device

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.deviceId) {
      return next.handle();
    }

    const now = Date.now();
    const lastUpdate = LastActiveInterceptor.lastUpdateMap.get(user.deviceId) || 0;

    // Skip DB write if already updated within the last 60 seconds
    if (now - lastUpdate < LastActiveInterceptor.THROTTLE_MS) {
      return next.handle();
    }

    LastActiveInterceptor.lastUpdateMap.set(user.deviceId, now);

    // Periodic cleanup if map grows large
    if (LastActiveInterceptor.lastUpdateMap.size > 5000) {
      for (const [id, time] of LastActiveInterceptor.lastUpdateMap.entries()) {
        if (now - time > LastActiveInterceptor.THROTTLE_MS * 5) {
          LastActiveInterceptor.lastUpdateMap.delete(id);
        }
      }
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

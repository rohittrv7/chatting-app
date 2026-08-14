import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public — the JwtAuthGuard will skip authentication for
 * any handler decorated with @Public().
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

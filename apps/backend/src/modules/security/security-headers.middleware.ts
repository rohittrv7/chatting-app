import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // Require HTTPS and tell browsers to remember this for 1 year (including subdomains)
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );

    // Prevent browsers from MIME-sniffing the content-type
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Deny embedding this site in any frame/iframe
    res.setHeader('X-Frame-Options', 'DENY');

    // Restrict resource loading to same origin; forbid framing
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; frame-ancestors 'none'",
    );

    // Send only origin on cross-origin requests, full URL on same-origin
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    next();
  }
}

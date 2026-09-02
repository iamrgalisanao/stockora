import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Baseline security headers for a JSON API (a hand-rolled subset of what Helmet would set — no extra
 * dependency). The API serves no HTML, so a strict, locked-down CSP is safe.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly isProd = process.env.NODE_ENV === 'production';

  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.removeHeader('X-Powered-By');
    if (this.isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  }
}

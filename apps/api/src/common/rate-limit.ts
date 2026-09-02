import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

/**
 * Rate-limit tiers. Different endpoint classes get different budgets — authentication and expensive
 * operations (search/resolve, import, export) are tighter than ordinary reads/writes.
 */
export type RateTier = 'auth' | 'sensitive' | 'default';

/** Requests allowed per 60s window, per client, before scaling by RATE_LIMIT_FACTOR. */
export const TIER_LIMITS: Record<RateTier, number> = {
  auth: 10,
  sensitive: 30,
  default: 300,
};

export const RATE_TIER_KEY = 'rateTier';
/** Tag a controller/route with a stricter tier than the default. */
export const RateLimit = (tier: RateTier) => SetMetadata(RATE_TIER_KEY, tier);

/**
 * A fixed-window counter keyed by an arbitrary string. Pure and in-memory (single-instance scope);
 * a distributed deployment would swap the store for Redis without changing callers.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly windowMs = 60_000) {}

  /** Returns whether the request is allowed, plus when the window resets. */
  check(key: string, limit: number, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.hits.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }
    entry.count += 1;
    const allowed = entry.count <= limit;
    return { allowed, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
  }

  /** Drop expired buckets so the map doesn't grow unbounded. */
  prune(now = Date.now()): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new SlidingWindowLimiter();
  private readonly factor: number;
  private readonly enabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.factor = config.get<number>('RATE_LIMIT_FACTOR', 1);
    // Off under tests so auth-heavy suites aren't throttled; the algorithm is unit-tested directly.
    this.enabled = config.get<string>('NODE_ENV') !== 'test';
    setInterval(() => this.limiter.prune(), 60_000).unref?.();
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) return true;
    const tier =
      this.reflector.getAllAndOverride<RateTier>(RATE_TIER_KEY, [context.getHandler(), context.getClass()]) ??
      'default';
    const req = context.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const limit = Math.ceil(TIER_LIMITS[tier] * this.factor);

    const { allowed, remaining, resetAt } = this.limiter.check(`${tier}:${ip}`, limit);
    const res = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string | number) => void }>();
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    if (!allowed) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', retryAfter);
      throw new HttpException('Too many requests — slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

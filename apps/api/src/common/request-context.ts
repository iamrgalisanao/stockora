import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditSource } from '@iw/contracts';
import type { RequestUser } from './request-user';

/**
 * Per-request ambient context. A single logical operation (one HTTP request) shares one
 * `correlationId`, so every audit record it emits can later be shown as "these N entries came
 * from the same operation" — the foundation the explorer and (later) the outbox build on.
 */
export interface RequestContext {
  correlationId: string;
  actorId: string | null;
  actorDisplayName: string | null;
  source: AuditSource;
}

const storage = new AsyncLocalStorage<RequestContext>();

@Injectable()
export class RequestContextService {
  get(): RequestContext | undefined {
    return storage.getStore();
  }

  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  }
}

/**
 * Establishes the request context for every request. Runs after the auth guard, so `req.user`
 * is populated and the actor snapshot (id + display name) is captured for the whole request.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestContextService) {}

  intercept(execution: ExecutionContext, next: CallHandler) {
    const req = execution.switchToHttp().getRequest<{ user?: RequestUser; headers?: Record<string, string | undefined> }>();
    const user = req.user;
    // A caller-supplied correlation id (e.g. an upstream service) is honored when present.
    const header = req.headers?.['x-correlation-id'];
    const ctx: RequestContext = {
      correlationId: (typeof header === 'string' && /^[0-9a-f-]{36}$/i.test(header) ? header : randomUUID()),
      actorId: user?.userId ?? null,
      actorDisplayName: user?.name ?? null,
      source: 'USER',
    };
    return this.context.run(ctx, () => next.handle());
  }
}

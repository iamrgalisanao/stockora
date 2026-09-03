import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, OutboxEvent } from '@prisma/client';
import type { OutboxEventListItem, OutboxHealthResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ConsumerRegistry } from './consumer-registry.service';
import { ConsumerReceipts } from './consumer-receipts.service';
import type { DomainEventEnvelope } from './consumer';

export interface RelayConfig {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
  jitterMs: number;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export interface BatchResult {
  claimed: number;
  published: number;
  failed: number;
  deadLettered: number;
}

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger('OutboxRelay');
  // Environment-configurable with safe defaults; tests may tweak fields directly.
  config: RelayConfig = {
    batchSize: num(process.env.OUTBOX_BATCH_SIZE, 20),
    leaseMs: num(process.env.OUTBOX_LEASE_MS, 30_000),
    maxAttempts: num(process.env.OUTBOX_MAX_ATTEMPTS, 8),
    baseRetryMs: num(process.env.OUTBOX_BASE_RETRY_MS, 1_000),
    maxRetryMs: num(process.env.OUTBOX_MAX_RETRY_MS, 300_000),
    jitterMs: num(process.env.OUTBOX_JITTER_MS, 250),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConsumerRegistry,
    private readonly receipts: ConsumerReceipts,
  ) {}

  /**
   * Claim a batch and deliver each event independently. Safe to run concurrently (SKIP LOCKED claim).
   * `organizationId` optionally narrows the claim to one tenant (drain a single org, or test isolation);
   * omitted, it processes all orgs.
   */
  async processBatch(opts: { organizationId?: string } = {}): Promise<BatchResult> {
    const claimed = await this.claim(new Date(), opts.organizationId);
    const result: BatchResult = { claimed: claimed.length, published: 0, failed: 0, deadLettered: 0 };
    for (const ev of claimed) {
      // Each event is dispatched independently — one poison event never aborts the loop.
      const outcome = await this.dispatch(ev);
      result[outcome] += 1;
    }
    return result;
  }

  /**
   * Atomically claim eligible rows into PROCESSING under a lease. Eligible = PENDING/FAILED whose
   * availableAt has arrived, OR a PROCESSING row whose lease expired (crashed-worker recovery).
   * `FOR UPDATE SKIP LOCKED` lets concurrent workers claim disjoint sets without blocking.
   */
  private async claim(now: Date, organizationId?: string): Promise<OutboxEvent[]> {
    const orgClause = organizationId ? Prisma.sql`AND organization_id = ${organizationId}::uuid` : Prisma.empty;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM outbox_events
        WHERE ( (status IN ('PENDING', 'FAILED') AND available_at <= ${now})
             OR (status = 'PROCESSING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ${now}) )
        ${orgClause}
        ORDER BY available_at ASC
        LIMIT ${this.config.batchSize}
        FOR UPDATE SKIP LOCKED`);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { status: 'PROCESSING', leaseExpiresAt: new Date(now.getTime() + this.config.leaseMs) },
      });
      return tx.outboxEvent.findMany({ where: { id: { in: ids } } });
    });
  }

  private async dispatch(ev: OutboxEvent): Promise<'published' | 'failed' | 'deadLettered'> {
    // attemptCount increments when the delivery attempt actually begins (honest retry accounting).
    const attempt = ev.attemptCount + 1;
    await this.prisma.outboxEvent.update({ where: { id: ev.id }, data: { attemptCount: attempt } });

    const envelope: DomainEventEnvelope = {
      id: ev.id,
      organizationId: ev.organizationId,
      eventType: ev.eventType,
      aggregateType: ev.aggregateType,
      aggregateId: ev.aggregateId,
      occurredAt: ev.occurredAt,
      correlationId: ev.correlationId,
      causationId: ev.causationId,
      source: ev.source,
      schemaVersion: ev.schemaVersion,
      payload: (ev.payload ?? {}) as Record<string, unknown>,
    };

    try {
      for (const consumer of this.registry.consumersFor(ev.eventType)) {
        if (await this.receipts.has(consumer.consumerName, ev.id)) continue; // already delivered — skip
        await consumer.handle(envelope);
        await this.receipts.record(consumer.consumerName, ev.id);
      }
      await this.prisma.outboxEvent.update({
        where: { id: ev.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), leaseExpiresAt: null, lastError: null },
      });
      return 'published';
    } catch (err) {
      const lastError = this.sanitize(err);
      if (attempt >= this.config.maxAttempts) {
        await this.prisma.outboxEvent.update({
          where: { id: ev.id },
          data: { status: 'DEAD_LETTER', leaseExpiresAt: null, lastError },
        });
        this.logger.warn(`event ${ev.id} (${ev.eventType}) dead-lettered after ${attempt} attempt(s)`);
        return 'deadLettered';
      }
      await this.prisma.outboxEvent.update({
        where: { id: ev.id },
        data: { status: 'FAILED', availableAt: new Date(Date.now() + this.backoff(attempt)), leaseExpiresAt: null, lastError },
      });
      return 'failed';
    }
  }

  /** Exponential backoff with jitter, capped at maxRetryMs. */
  private backoff(attempt: number): number {
    const capped = Math.min(this.config.baseRetryMs * 2 ** (attempt - 1), this.config.maxRetryMs);
    return capped + Math.floor(Math.random() * this.config.jitterMs);
  }

  /** Message only — never a stack trace or raw object (may carry secrets); capped length. */
  private sanitize(err: unknown): string {
    return (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }

  async health(organizationId: string): Promise<OutboxHealthResponse> {
    const now = new Date();
    const where: Prisma.OutboxEventWhereInput = { organizationId };
    const grouped = await this.prisma.outboxEvent.groupBy({ by: ['status'], where, _count: { _all: true } });
    const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;

    const oldestPending = await this.prisma.outboxEvent.findFirst({
      where: { organizationId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const lastPublished = await this.prisma.outboxEvent.findFirst({
      where: { organizationId, status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      select: { publishedAt: true },
    });
    const expiredLeaseCount = await this.prisma.outboxEvent.count({
      where: { organizationId, status: 'PROCESSING', leaseExpiresAt: { lte: now } },
    });

    return {
      pending: count('PENDING'),
      processing: count('PROCESSING'),
      retrying: count('FAILED'),
      deadLetter: count('DEAD_LETTER'),
      published: count('PUBLISHED'),
      oldestPendingAgeSeconds: oldestPending ? Math.floor((now.getTime() - oldestPending.createdAt.getTime()) / 1000) : null,
      lastPublishedAt: lastPublished?.publishedAt ? lastPublished.publishedAt.toISOString() : null,
      expiredLeaseCount,
    };
  }

  /** Recent outbox rows for the ops table (org-scoped, newest first). No payload — gated more tightly. */
  async recentEvents(organizationId: string, limit = 50): Promise<OutboxEventListItem[]> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      status: e.status,
      attemptCount: e.attemptCount,
      occurredAt: e.occurredAt.toISOString(),
      availableAt: e.availableAt.toISOString(),
      publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
      correlationId: e.correlationId,
      lastError: e.lastError,
    }));
  }

  /**
   * Manual retry (authorized ops). Allowed only from FAILED / DEAD_LETTER → PENDING, availableAt now,
   * lastError cleared. attemptCount is PRESERVED (lifetime attempt history), not reset.
   */
  async retry(organizationId: string, id: string): Promise<void> {
    const ev = await this.prisma.outboxEvent.findFirst({ where: { id, organizationId }, select: { status: true } });
    if (!ev) throw new NotFoundException('Outbox event not found');
    if (ev.status !== 'FAILED' && ev.status !== 'DEAD_LETTER') {
      throw new BadRequestException(`Only a FAILED or DEAD_LETTER event can be retried (is ${ev.status})`);
    }
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PENDING', availableAt: new Date(), leaseExpiresAt: null, lastError: null },
    });
  }
}

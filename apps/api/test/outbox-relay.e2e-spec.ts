process.env.OUTBOX_POLLER = 'off'; // deterministic: tests drive processBatch() directly

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { ConsumerRegistry } from '../src/outbox/consumer-registry.service';
import type { DomainEventConsumer, DomainEventEnvelope } from '../src/outbox/consumer';

class Recorder implements DomainEventConsumer {
  calls: DomainEventEnvelope[] = [];
  constructor(public readonly consumerName: string, public readonly eventType: string) {}
  async handle(e: DomainEventEnvelope) { this.calls.push(e); }
}
class Failer implements DomainEventConsumer {
  constructor(public readonly consumerName: string, public readonly eventType: string, private readonly msg = 'boom') {}
  async handle() { throw new Error(this.msg); }
}

/**
 * 2D.1B — Outbox relay + delivery semantics (ADR 0010). Claim (SKIP LOCKED) + lease, at-least-once delivery
 * to idempotent consumers via per-consumer receipts, bounded exponential backoff, dead-letter, crash
 * recovery, and observable queue health — one poison event never blocks unrelated ones.
 */
describe('Outbox relay (e2e, 2D.1B)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let relay: OutboxRelayService;
  let registry: ConsumerRegistry;
  const org = randomUUID();

  const enqueue = (eventType: string, opts: { org?: string; availableAt?: Date; status?: any; leaseExpiresAt?: Date; correlationId?: string; source?: string; payload?: Record<string, unknown> } = {}) =>
    prisma.outboxEvent.create({
      data: {
        organizationId: opts.org ?? org, eventType, aggregateType: 'test', aggregateId: randomUUID(),
        payload: (opts.payload ?? {}) as never, correlationId: opts.correlationId ?? null, source: opts.source ?? 'SYSTEM',
        ...(opts.availableAt ? { availableAt: opts.availableAt } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.leaseExpiresAt ? { leaseExpiresAt: opts.leaseExpiresAt } : {}),
      },
    });
  const row = (id: string) => prisma.outboxEvent.findUnique({ where: { id } });
  const makeClaimable = (id: string) => prisma.outboxEvent.update({ where: { id }, data: { availableAt: new Date() } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    relay = app.get(OutboxRelayService);
    registry = app.get(ConsumerRegistry);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    registry.clear();
    relay.config.jitterMs = 0; relay.config.maxAttempts = 8; relay.config.baseRetryMs = 1000; relay.config.batchSize = 50;
    // Isolate each test to this spec's org rows. (No global receipt wipe — each test uses fresh event
    // ids, and wiping all receipts would race concurrently-running specs under maxWorkers.)
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org } });
  });

  it('claims an eligible pending event, publishes it, and delivers the full envelope once', async () => {
    const rec = new Recorder('rec', 'LotExpired');
    registry.register(rec);
    const cid = randomUUID();
    const ev = await enqueue('LotExpired', { correlationId: cid, source: 'USER', payload: { k: 'v' } });
    const r = await relay.processBatch({ organizationId: org });
    expect(r.published).toBe(1);
    const after = (await row(ev.id))!;
    expect(after.status).toBe('PUBLISHED');
    expect(after.publishedAt).toBeTruthy();
    expect(after.attemptCount).toBe(1);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.correlationId).toBe(cid);
    expect(rec.calls[0]!.source).toBe('USER');
    expect(rec.calls[0]!.schemaVersion).toBe(1);
  });

  it('skips an event whose availableAt is still in the future', async () => {
    const ev = await enqueue('LotExpired', { availableAt: new Date(Date.now() + 3_600_000) });
    await relay.processBatch({ organizationId: org });
    const after = (await row(ev.id))!;
    expect(after.status).toBe('PENDING');
    expect(after.attemptCount).toBe(0);
  });

  it('a failed delivery becomes FAILED with a future availableAt and a sanitized error', async () => {
    registry.register(new Failer('f', 'CycleCountCompleted'));
    const ev = await enqueue('CycleCountCompleted');
    const t = Date.now();
    const r = await relay.processBatch({ organizationId: org });
    expect(r.failed).toBe(1);
    const after = (await row(ev.id))!;
    expect(after.status).toBe('FAILED');
    expect(after.attemptCount).toBe(1);
    expect(new Date(after.availableAt).getTime()).toBeGreaterThan(t);
    expect(after.lastError).toContain('boom');
    expect(after.lastError).not.toContain('\n'); // message only, no stack
  });

  it('retry backoff grows across attempts', async () => {
    registry.register(new Failer('f', 'CycleCountCompleted'));
    const ev = await enqueue('CycleCountCompleted');
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      await makeClaimable(ev.id);
      const t = Date.now();
      await relay.processBatch({ organizationId: org });
      const after = (await row(ev.id))!;
      delays.push(new Date(after.availableAt).getTime() - t);
    }
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
    expect(delays[2]!).toBeGreaterThan(delays[1]!);
  });

  it('reaches DEAD_LETTER after the max attempts', async () => {
    relay.config.maxAttempts = 3;
    registry.register(new Failer('f', 'ReorderRequired'));
    const ev = await enqueue('ReorderRequired');
    for (let i = 0; i < 3; i++) { await makeClaimable(ev.id); await relay.processBatch({ organizationId: org }); }
    const after = (await row(ev.id))!;
    expect(after.status).toBe('DEAD_LETTER');
    expect(after.attemptCount).toBe(3);
  });

  it('a poison event does not block an unrelated event from publishing', async () => {
    registry.register(new Failer('f', 'CycleCountCompleted'));
    registry.register(new Recorder('rec', 'LotExpired'));
    const bad = await enqueue('CycleCountCompleted');
    const good = await enqueue('LotExpired');
    const r = await relay.processBatch({ organizationId: org });
    expect(r.published).toBe(1);
    expect(r.failed).toBe(1);
    expect((await row(good.id))!.status).toBe('PUBLISHED');
    expect((await row(bad.id))!.status).toBe('FAILED');
  });

  it('recovers an expired PROCESSING lease but does not steal a live one', async () => {
    const rec = new Recorder('rec', 'LotExpired');
    registry.register(rec);
    const expired = await enqueue('LotExpired', { status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() - 1000) });
    const live = await enqueue('LotExpired', { status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() + 60_000) });
    const r = await relay.processBatch({ organizationId: org });
    expect(r.published).toBe(1);
    expect((await row(expired.id))!.status).toBe('PUBLISHED');
    expect((await row(live.id))!.status).toBe('PROCESSING'); // not stolen
  });

  it('two concurrent workers never claim the same row (each processed once per attempt)', async () => {
    registry.register(new Recorder('rec', 'LotExpired'));
    const evs = await Promise.all(Array.from({ length: 6 }, () => enqueue('LotExpired')));
    const [a, b] = await Promise.all([relay.processBatch({ organizationId: org }), relay.processBatch({ organizationId: org })]);
    expect(a.published + b.published).toBe(6);
    for (const ev of evs) {
      const after = (await row(ev.id))!;
      expect(after.status).toBe('PUBLISHED');
      expect(after.attemptCount).toBe(1); // claimed exactly once
    }
  });

  it('a per-consumer receipt prevents a repeated side effect on re-dispatch', async () => {
    const rec = new Recorder('rec', 'LotExpired');
    registry.register(rec);
    const ev = await enqueue('LotExpired');
    await relay.processBatch({ organizationId: org });
    // Force a re-dispatch of the same event id.
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'PENDING', availableAt: new Date(), publishedAt: null } });
    await relay.processBatch({ organizationId: org });
    expect(rec.calls).toHaveLength(1); // second delivery skipped by receipt
    expect((await row(ev.id))!.status).toBe('PUBLISHED');
  });

  it('invokes multiple consumers for one event; a single consumer failure retries only that consumer', async () => {
    const a = new Recorder('A', 'ReturnReceived');
    const b = new Failer('B', 'ReturnReceived');
    registry.register(a);
    registry.register(b);
    const ev = await enqueue('ReturnReceived');
    await relay.processBatch({ organizationId: org }); // A succeeds (+receipt), B fails → event FAILED
    expect(a.calls).toHaveLength(1);
    expect((await row(ev.id))!.status).toBe('FAILED');
    // Retry: A is skipped (receipt), only B re-runs.
    await makeClaimable(ev.id);
    await relay.processBatch({ organizationId: org });
    expect(a.calls).toHaveLength(1); // not repeated
    expect((await row(ev.id))!.status).toBe('FAILED');
  });

  it('exposes queue health that reflects the current state, scoped to the org', async () => {
    const morg = randomUUID();
    registry.register(new Recorder('rec', 'LotExpired'));
    registry.register(new Failer('f', 'CycleCountCompleted'));
    await enqueue('LotExpired', { org: morg }); // → PUBLISHED
    await enqueue('CycleCountCompleted', { org: morg }); // → FAILED
    await relay.processBatch({ organizationId: morg });
    // Static rows for the remaining states.
    await enqueue('LotExpired', { org: morg, availableAt: new Date(Date.now() + 3_600_000) }); // PENDING
    await prisma.outboxEvent.create({ data: { organizationId: morg, eventType: 'X', aggregateType: 't', aggregateId: randomUUID(), payload: {}, status: 'DEAD_LETTER' } });
    await prisma.outboxEvent.create({ data: { organizationId: morg, eventType: 'X', aggregateType: 't', aggregateId: randomUUID(), payload: {}, status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() - 1000) } });

    const h = await relay.health(morg);
    expect(h.published).toBe(1);
    expect(h.retrying).toBe(1);
    expect(h.pending).toBe(1);
    expect(h.deadLetter).toBe(1);
    expect(h.processing).toBe(1);
    expect(h.expiredLeaseCount).toBe(1);
    expect(h.lastPublishedAt).toBeTruthy();
    expect(h.oldestPendingAgeSeconds).not.toBeNull();
  });
});

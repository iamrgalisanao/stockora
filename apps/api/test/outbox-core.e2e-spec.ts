import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { RequestContextService } from '../src/common/request-context';

/**
 * 2D.1A — Transactional outbox core (ADR 0010). The outbox row commits atomically with the business
 * mutation (same tx); a rollback emits nothing; a replayed command (same dedupeKey) does not duplicate the
 * logical event; the envelope carries correlation id + schema version. No dispatch yet.
 */
describe('Transactional outbox — core (e2e, 2D.1A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let context: RequestContextService;

  const ctx = { correlationId: randomUUID(), actorId: randomUUID(), actorDisplayName: 'Tester', source: 'USER' as const };
  const run = <T>(fn: () => T): T => context.run(ctx, fn);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    outbox = app.get(OutboxService);
    context = app.get(RequestContextService);
  });
  afterAll(async () => { await app.close(); });

  it('commits the outbox row atomically with the business mutation, with a full envelope', async () => {
    const org = randomUUID();
    const agg = randomUUID();
    const name = `OBX-A-${Date.now()}`;
    await run(() => prisma.$transaction(async (tx) => {
      await tx.brand.create({ data: { organizationId: org, name } });
      await outbox.enqueue(tx, { organizationId: org, eventType: 'InventoryReceived', aggregateType: 'brand', aggregateId: agg, payload: { name, qty: '100' } });
    }));
    expect(await prisma.brand.findFirst({ where: { organizationId: org, name } })).toBeTruthy();
    const ev = await prisma.outboxEvent.findFirst({ where: { aggregateId: agg } });
    expect(ev).toBeTruthy();
    expect(ev!.status).toBe('PENDING');
    expect(ev!.correlationId).toBe(ctx.correlationId); // envelope carries the correlation id
    expect(ev!.schemaVersion).toBe(1); // schema version present from day one
    expect(ev!.source).toBe('USER');
    expect(ev!.attemptCount).toBe(0);
  });

  it('a business rollback produces no outbox event', async () => {
    const org = randomUUID();
    const agg = randomUUID();
    const name = `OBX-R-${Date.now()}`;
    await expect(
      run(() => prisma.$transaction(async (tx) => {
        await tx.brand.create({ data: { organizationId: org, name } });
        await outbox.enqueue(tx, { organizationId: org, eventType: 'InventoryReceived', aggregateType: 'brand', aggregateId: agg, payload: {} });
        throw new Error('boom');
      })),
    ).rejects.toThrow('boom');
    expect(await prisma.brand.findFirst({ where: { organizationId: org, name } })).toBeNull();
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: agg } })).toBeNull();
  });

  it('an outbox insert failure rolls back the business transaction', async () => {
    const org = randomUUID();
    const name = `OBX-F-${Date.now()}`;
    const dupId = randomUUID();
    // Pre-seed a row; a second insert with the same PK inside the tx will throw and abort everything.
    await prisma.outboxEvent.create({ data: { id: dupId, organizationId: org, eventType: 'InventoryReceived', aggregateType: 'x', aggregateId: randomUUID(), payload: {} } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.brand.create({ data: { organizationId: org, name } });
        await tx.outboxEvent.create({ data: { id: dupId, organizationId: org, eventType: 'InventoryReleased', aggregateType: 'x', aggregateId: randomUUID(), payload: {} } });
      }),
    ).rejects.toBeDefined();
    expect(await prisma.brand.findFirst({ where: { organizationId: org, name } })).toBeNull();
  });

  it('a replayed command with the same dedupeKey does not create a duplicate logical event', async () => {
    const org = randomUUID();
    const agg = randomUUID();
    const key = `dedupe-${randomUUID()}`;
    const enqueue = () => run(() => prisma.$transaction((tx) =>
      outbox.enqueue(tx, { organizationId: org, eventType: 'ReservationConfirmed', aggregateType: 'reservation', aggregateId: agg, payload: { n: 1 }, dedupeKey: key })));
    await enqueue();
    await enqueue(); // replay — must be a no-op, not a second row, and must not abort the tx
    expect(await prisma.outboxEvent.count({ where: { organizationId: org, dedupeKey: key } })).toBe(1);
  });

  it('outside a request context the event is SYSTEM-sourced with no correlation id', async () => {
    const org = randomUUID();
    const agg = randomUUID();
    await prisma.$transaction((tx) => outbox.enqueue(tx, { organizationId: org, eventType: 'LotExpired', aggregateType: 'lot', aggregateId: agg, payload: {} }));
    const ev = await prisma.outboxEvent.findFirst({ where: { aggregateId: agg } });
    expect(ev!.source).toBe('SYSTEM');
    expect(ev!.correlationId).toBeNull();
  });
});

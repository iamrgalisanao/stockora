process.env.OUTBOX_POLLER = 'off';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { ConsumerRegistry } from '../src/outbox/consumer-registry.service';

/**
 * 2D.1C — First domain integrations (ADR 0010). Expiry facts and cycle-count completion enqueue outbox
 * events IN THE SAME TRANSACTION as the domain fact; the relay delivers them to an idempotent internal
 * projection consumer; observable via /outbox with a permission-gated manual retry. No notification coupling.
 */
describe('Outbox domain integrations (e2e, 2D.1C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let relay: OutboxRelayService;
  let registry: ConsumerRegistry;
  let token: string;
  let auditorToken: string;
  let org: string;
  let unitId: string;
  let whId: string;
  const u = Date.now();
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const iso = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); };
  const drain = () => relay.processBatch({ organizationId: org });

  const newBatchProduct = async (prefix: string) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id as string;
  const seedLot = async (productId: string, qty: number, lotNumber: string, expiryDate: string) => {
    await http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 5, lotNumber, expiryDate }] }).expect(201);
    return (await prisma.inventoryLot.findFirst({ where: { organizationId: org, lotNumber }, select: { id: true } }))!.id;
  };
  const scan = (correlationId?: string) => {
    const r = http().post('/api/lots/expiry-scan').set(auth());
    if (correlationId) r.set('x-correlation-id', correlationId);
    return r.expect(201);
  };

  // Full cycle-count flow → returns the completed task id + its stock count id.
  const runCycleCount = async (prefix: string, seedQty: number, countedQty: number) => {
    const p = await newBatchProduct(prefix);
    const lotNumber = `CC-${seq}`;
    await seedLot(p, seedQty, lotNumber, iso(400));
    await http().put('/api/cycle-count/policy').set(auth()).send({ warehouseId: whId, enabled: true }).expect(200);
    await http().put('/api/cycle-count/classification').set(auth()).send({ warehouseId: whId, productId: p, abcClass: 'A' }).expect(200);
    const task = (await http().post('/api/cycle-count/generate').set(auth()).send({ warehouseId: whId }).expect(201)).body.find((t: any) => t.productId === p);
    const started = (await http().post(`/api/cycle-count/tasks/${task.id}/start`).set(auth()).expect(201)).body;
    const count = (await http().get(`/api/counts/${started.physicalCountId}`).set(auth()).expect(200)).body;
    return { taskId: task.id, countId: count.id, itemId: count.items[0].id, countedQty };
  };
  const finishCount = async (countId: string, itemId: string, countedQty: number) => {
    await http().post(`/api/counts/${countId}/entries`).set(auth()).send({ items: [{ itemId, countedQty }] }).expect(201);
    await http().post(`/api/counts/${countId}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${countId}/approve`).set(auth()).expect(201);
    await http().post(`/api/counts/${countId}/post`).set(auth()).expect(201);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    relay = app.get(OutboxRelayService);
    registry = app.get(ConsumerRegistry);
    token = (await http().post('/api/auth/register').send({ organizationName: `OBI ${u}`, adminEmail: `obi_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    org = (await http().get('/api/auth/me').set(auth()).expect(200)).body.organizationId;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
    await http().post('/api/users').set(auth()).send({ email: `aud_${u}@x.test`, name: 'Auditor', roleKey: 'auditor', password: 'password123' }).expect(201);
    auditorToken = (await http().post('/api/auth/login').send({ email: `aud_${u}@x.test`, password: 'password123' }).expect(200)).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('a new expiring-soon fact and its outbox event commit together; a repeat scan adds neither', async () => {
    const p = await newBatchProduct('SOON');
    const lotId = await seedLot(p, 10, `LSOON-${seq}`, iso(5));
    const cid = randomUUID();
    await scan(cid);
    const facts = await prisma.lotExpiryFact.findMany({ where: { organizationId: org, lotId, eventType: 'LOT_EXPIRING_SOON' } });
    expect(facts).toHaveLength(1);
    const evs = await prisma.outboxEvent.findMany({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpiringSoon' } });
    expect(evs).toHaveLength(1);
    expect(evs[0]!.dedupeKey).toBe(`lot-expiry-fact:${facts[0]!.id}`);
    expect(evs[0]!.correlationId).toBe(cid); // envelope carries the originating request's correlation id
    // Repeat scan: no duplicate fact, no duplicate event.
    await scan();
    expect(await prisma.lotExpiryFact.count({ where: { organizationId: org, lotId, eventType: 'LOT_EXPIRING_SOON' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpiringSoon' } })).toBe(1);
  });

  it('LotExpired is emitted once and delivered to the internal projection consumer', async () => {
    const p = await newBatchProduct('DEAD');
    const lotId = await seedLot(p, 8, `LDEAD-${seq}`, iso(-2));
    await scan();
    await scan(); // still once
    const evs = await prisma.outboxEvent.findMany({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpired' } });
    expect(evs).toHaveLength(1);
    await drain();
    const proj = await prisma.operationalFactProjection.findUnique({ where: { eventId: evs[0]!.id } });
    expect(proj).toBeTruthy();
    expect(proj!.entityType).toBe('lot');
    expect(proj!.summary).toContain('expired');
    // Idempotent projection: replay the delivery (clear receipt, re-dispatch) → still one projection row.
    await prisma.consumerReceipt.deleteMany({ where: { eventId: evs[0]!.id } });
    await prisma.outboxEvent.update({ where: { id: evs[0]!.id }, data: { status: 'PENDING', availableAt: new Date(), publishedAt: null } });
    await drain();
    expect(await prisma.operationalFactProjection.count({ where: { eventId: evs[0]!.id } })).toBe(1);
  });

  it('CycleCountCompleted is emitted only after the count POSTS, and not on a failed post', async () => {
    const cc = await runCycleCount('CCDONE', 40, 37);
    // Not yet posted → no event.
    expect(await prisma.outboxEvent.count({ where: { organizationId: org, aggregateId: cc.taskId, eventType: 'CycleCountCompleted' } })).toBe(0);
    // A premature post (count still COUNTING) fails → still no event.
    await http().post(`/api/counts/${cc.countId}/post`).set(auth()).expect(400);
    expect(await prisma.outboxEvent.count({ where: { organizationId: org, aggregateId: cc.taskId, eventType: 'CycleCountCompleted' } })).toBe(0);
    // Complete properly → exactly one event with the compact payload; delivered to the projection.
    await finishCount(cc.countId, cc.itemId, cc.countedQty);
    const evs = await prisma.outboxEvent.findMany({ where: { organizationId: org, aggregateId: cc.taskId, eventType: 'CycleCountCompleted' } });
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payload).toMatchObject({ varianceQuantity: '-3', stockCountId: cc.countId });
    await drain();
    const proj = await prisma.operationalFactProjection.findUnique({ where: { eventId: evs[0]!.id } });
    expect(proj!.summary).toContain('variance -3');
  });

  it('outbox health and recent events are org-scoped; another org sees nothing', async () => {
    await drain();
    const other = (await http().post('/api/auth/register').send({ organizationName: `OBI2 ${u}`, adminEmail: `obi2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    const h = (await http().get('/api/outbox/health').set(auth(other)).expect(200)).body;
    expect(h.published + h.pending + h.retrying + h.deadLetter + h.processing).toBe(0);
    expect((await http().get('/api/outbox/events').set(auth(other)).expect(200)).body).toHaveLength(0);
    // Our org has events.
    expect((await http().get('/api/outbox/events').set(auth()).expect(200)).body.length).toBeGreaterThan(0);
  });

  it('manual retry requires settings.manage and preserves lifetime attempt history', async () => {
    const dead = await prisma.outboxEvent.create({ data: { organizationId: org, eventType: 'LotExpired', aggregateType: 'lot', aggregateId: randomUUID(), payload: {}, status: 'DEAD_LETTER', attemptCount: 5, lastError: 'boom' } });
    // Auditor (audit.view but not settings.manage) can read health but not retry.
    await http().get('/api/outbox/health').set(auth(auditorToken)).expect(200);
    await http().post(`/api/outbox/${dead.id}/retry`).set(auth(auditorToken)).expect(403);
    // Admin retry → PENDING now, error cleared, attemptCount preserved.
    await http().post(`/api/outbox/${dead.id}/retry`).set(auth()).expect(201);
    const after = (await prisma.outboxEvent.findUnique({ where: { id: dead.id } }))!;
    expect(after.status).toBe('PENDING');
    expect(after.lastError).toBeNull();
    expect(after.attemptCount).toBe(5); // lifetime history preserved
  });

  it('a second consumer failing does not duplicate the already-successful projection', async () => {
    // Register an extra failing consumer for LotExpired (in addition to the projection consumer).
    registry.register({ consumerName: 'test-failer', eventType: 'LotExpired', handle: async () => { throw new Error('downstream boom'); } });
    const p = await newBatchProduct('MULTI');
    const lotId = await seedLot(p, 5, `LMULTI-${seq}`, iso(-1));
    await scan();
    const ev = (await prisma.outboxEvent.findFirst({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpired' } }))!;
    await drain(); // projection succeeds (+receipt); failer throws → event FAILED
    expect((await prisma.outboxEvent.findUnique({ where: { id: ev.id } }))!.status).toBe('FAILED');
    expect(await prisma.operationalFactProjection.count({ where: { eventId: ev.id } })).toBe(1);
    // Retry: projection consumer is skipped by its receipt; the failer re-runs. Projection not duplicated.
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { availableAt: new Date() } });
    await drain();
    expect(await prisma.operationalFactProjection.count({ where: { eventId: ev.id } })).toBe(1);
  });
});

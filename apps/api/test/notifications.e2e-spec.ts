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
 * 2D.2A — Notification core + in-app inbox (ADR 0011). Domain events → rule engine → scoped notifications
 * with per-user read/dismiss; idempotent; no external channels.
 */
describe('Notifications (e2e, 2D.2A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let relay: OutboxRelayService;
  let registry: ConsumerRegistry;
  let token: string;
  let org: string;
  let unitId: string;
  let whId: string;
  let otherWhId: string;
  const u = Date.now();
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const iso = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); };
  const drain = () => relay.processBatch({ organizationId: org });

  const member = async (roleKey: string, warehouseScope?: string[]) => {
    const email = `${roleKey}_${u}_${seq++}@x.test`;
    const body = (await http().post('/api/users').set(auth()).send({ email, name: roleKey, roleKey, password: 'password123', ...(warehouseScope ? { warehouseScope } : {}) }).expect(201)).body;
    const t = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken;
    return { userId: body.userId as string, email, token: t as string };
  };
  const seedExpiring = async (lotNumber: string, expiryDays: number, whid = whId) => {
    const p = (await http().post('/api/products').set(auth()).send({ sku: `NP-${u}-${seq++}`, name: 'NP', baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id;
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whid, lines: [{ productId: p, quantity: 5, unitCost: 5, lotNumber, expiryDate: iso(expiryDays) }] }).expect(201);
    return (await prisma.inventoryLot.findFirst({ where: { organizationId: org, lotNumber }, select: { id: true } }))!.id;
  };
  const scan = () => http().post('/api/lots/expiry-scan').set(auth()).expect(201);
  const recipientsOf = async (eventType: string, entityId: string) => {
    const n = await prisma.notification.findFirst({ where: { organizationId: org, type: eventType, entityId } });
    if (!n) return { notification: null as any, userIds: [] as string[] };
    const rs = await prisma.notificationRecipient.findMany({ where: { notificationId: n.id }, select: { userId: true } });
    return { notification: n, userIds: rs.map((r) => r.userId) };
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
    token = (await http().post('/api/auth/register').send({ organizationName: `NOTIF ${u}`, adminEmail: `notif_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    org = (await http().get('/api/auth/me').set(auth()).expect(200)).body.organizationId;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
    otherWhId = (await http().post('/api/warehouses').set(auth()).send({ code: `WO${u}`, name: 'WO' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('LotExpiringSoon → managers of the affected warehouse (WARNING), honoring role, warehouse & org scope', async () => {
    const wmAll = await member('warehouse_manager');
    const im = await member('inventory_manager');
    const wmOther = await member('warehouse_manager', [otherWhId]);
    const staff = await member('warehouse_staff');
    const lotId = await seedExpiring(`NSOON-${seq}`, 6);
    await scan();
    await drain();
    const { notification, userIds } = await recipientsOf('LotExpiringSoon', lotId);
    expect(notification.severity).toBe('WARNING');
    expect(notification.title).toBe('Lot expiring soon');
    expect(notification.message).toContain('expiring soon');
    const set = new Set(userIds);
    expect(set.has(wmAll.userId)).toBe(true);
    expect(set.has(im.userId)).toBe(true);
    expect(set.has(wmOther.userId)).toBe(false); // scoped to a different warehouse
    expect(set.has(staff.userId)).toBe(false); // not a recipient role
    // Admin (broad access, but not a manager role) is not auto-notified.
    const adminId = (await http().get('/api/auth/me').set(auth()).expect(200)).body.id;
    expect(set.has(adminId)).toBe(false);
  });

  it('LotExpired maps to CRITICAL and snapshots title/message + live entity id', async () => {
    await member('warehouse_manager');
    const lotId = await seedExpiring(`NDEAD-${seq}`, -2);
    await scan();
    await drain();
    const { notification } = await recipientsOf('LotExpired', lotId);
    expect(notification.severity).toBe('CRITICAL');
    expect(notification.message).toContain('has expired');
    expect(notification.entityType).toBe('lot');
    expect(notification.entityId).toBe(lotId); // stable id → opens current lot page
  });

  it('per-user read/dismiss is independent; unread count is accurate', async () => {
    const a = await member('warehouse_manager');
    const b = await member('inventory_manager');
    const lotId = await seedExpiring(`NRW-${seq}`, 6);
    await scan();
    await drain();
    const { notification } = await recipientsOf('LotExpiringSoon', lotId);
    // Both see it; both unread.
    expect((await http().get('/api/notifications').set(auth(a.token)).expect(200)).body.some((n: any) => n.id === notification.id)).toBe(true);
    expect((await http().get('/api/notifications/unread-count').set(auth(a.token)).expect(200)).body.unread).toBeGreaterThanOrEqual(1);
    const bUnreadBefore = (await http().get('/api/notifications/unread-count').set(auth(b.token)).expect(200)).body.unread;
    // A reads it → A's row read, B unaffected.
    await http().post(`/api/notifications/${notification.id}/read`).set(auth(a.token)).expect(201);
    const aRow = (await http().get('/api/notifications').set(auth(a.token)).expect(200)).body.find((n: any) => n.id === notification.id);
    expect(aRow.readAt).toBeTruthy();
    const bRow = (await http().get('/api/notifications').set(auth(b.token)).expect(200)).body.find((n: any) => n.id === notification.id);
    expect(bRow.readAt).toBeNull();
    expect((await http().get('/api/notifications/unread-count').set(auth(b.token)).expect(200)).body.unread).toBe(bUnreadBefore);
    // B dismisses → gone from B's list, still visible to A.
    await http().post(`/api/notifications/${notification.id}/dismiss`).set(auth(b.token)).expect(201);
    expect((await http().get('/api/notifications').set(auth(b.token)).expect(200)).body.some((n: any) => n.id === notification.id)).toBe(false);
    expect((await http().get('/api/notifications').set(auth(a.token)).expect(200)).body.some((n: any) => n.id === notification.id)).toBe(true);
  });

  it('CycleCountCompleted routes to the assignee + warehouse manager as INFO', async () => {
    const wm = await member('warehouse_manager');
    const counter = await member('warehouse_staff');
    // Cycle-count flow assigned to the counter.
    const p = (await http().post('/api/products').set(auth()).send({ sku: `NCC-${u}-${seq++}`, name: 'NCC', baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id;
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whId, lines: [{ productId: p, quantity: 20, unitCost: 5, lotNumber: `NCCL-${seq}` }] }).expect(201);
    await http().put('/api/cycle-count/policy').set(auth()).send({ warehouseId: whId, enabled: true }).expect(200);
    await http().put('/api/cycle-count/classification').set(auth()).send({ warehouseId: whId, productId: p, abcClass: 'A' }).expect(200);
    const task = (await http().post('/api/cycle-count/generate').set(auth()).send({ warehouseId: whId }).expect(201)).body.find((t: any) => t.productId === p);
    await http().post(`/api/cycle-count/tasks/${task.id}/assign`).set(auth()).send({ assignedToId: counter.userId }).expect(201);
    const started = (await http().post(`/api/cycle-count/tasks/${task.id}/start`).set(auth()).expect(201)).body;
    const count = (await http().get(`/api/counts/${started.physicalCountId}`).set(auth()).expect(200)).body;
    await http().post(`/api/counts/${count.id}/entries`).set(auth()).send({ items: [{ itemId: count.items[0].id, countedQty: 18 }] }).expect(201);
    await http().post(`/api/counts/${count.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.id}/post`).set(auth()).expect(201);
    await drain();
    const { notification, userIds } = await recipientsOf('CycleCountCompleted', task.id);
    expect(notification.severity).toBe('INFO');
    const set = new Set(userIds);
    expect(set.has(counter.userId)).toBe(true); // assignee
    expect(set.has(wm.userId)).toBe(true); // warehouse manager
  });

  it('outbox replay does not duplicate a notification (UNIQUE eventId+ruleKey)', async () => {
    await member('warehouse_manager');
    const lotId = await seedExpiring(`NDUP-${seq}`, 6);
    await scan();
    await drain();
    const ev = (await prisma.outboxEvent.findFirst({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpiringSoon' } }))!;
    // Force a re-delivery: clear the consumer receipt + requeue the event.
    await prisma.consumerReceipt.deleteMany({ where: { eventId: ev.id, consumerName: 'notification-projection' } });
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'PENDING', availableAt: new Date(), publishedAt: null } });
    await drain();
    expect(await prisma.notification.count({ where: { eventId: ev.id } })).toBe(1);
  });

  it('an inactive member is excluded from new notifications', async () => {
    const active = await member('warehouse_manager');
    const disabled = await member('inventory_manager');
    await http().patch(`/api/users/${disabled.userId}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    const lotId = await seedExpiring(`NINACT-${seq}`, 6);
    await scan();
    await drain();
    const { userIds } = await recipientsOf('LotExpiringSoon', lotId);
    const set = new Set(userIds);
    expect(set.has(active.userId)).toBe(true);
    expect(set.has(disabled.userId)).toBe(false); // disabled → not a recipient of new notifications
  });

  it('an event with no matching rule produces no notification; another org sees nothing', async () => {
    const before = await prisma.notification.count({ where: { organizationId: org } });
    const ev = await prisma.outboxEvent.create({ data: { organizationId: org, eventType: 'InventoryReceived', aggregateType: 'receipt', aggregateId: randomUUID(), payload: {} } });
    await drain();
    expect(await prisma.notification.count({ where: { eventId: ev.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: org } })).toBe(before);
    // Cross-org isolation: a fresh org's user has an empty inbox.
    const other = (await http().post('/api/auth/register').send({ organizationName: `NOTIF2 ${u}`, adminEmail: `notif2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    expect((await http().get('/api/notifications').set(auth(other)).expect(200)).body).toHaveLength(0);
  });

  it('a second consumer failing does not duplicate the already-created notification', async () => {
    registry.register({ consumerName: 'notif-test-failer', eventType: 'LotExpired', handle: async () => { throw new Error('boom'); } });
    await member('warehouse_manager');
    const lotId = await seedExpiring(`NMULTI-${seq}`, -3);
    await scan();
    const ev = (await prisma.outboxEvent.findFirst({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpired' } }))!;
    await drain(); // notification consumer succeeds (+receipt); failer throws → event FAILED
    expect((await prisma.outboxEvent.findUnique({ where: { id: ev.id } }))!.status).toBe('FAILED');
    expect(await prisma.notification.count({ where: { eventId: ev.id } })).toBe(1);
    // Retry: notification consumer skipped by receipt; still one notification.
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { availableAt: new Date() } });
    await drain();
    expect(await prisma.notification.count({ where: { eventId: ev.id } })).toBe(1);
  });
});

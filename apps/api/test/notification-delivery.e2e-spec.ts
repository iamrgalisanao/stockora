process.env.OUTBOX_POLLER = 'off';
process.env.NOTIF_DELIVERY_POLLER = 'off';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { NotificationDeliveryService } from '../src/notifications/delivery/notification-delivery.service';
import { ChannelAdapterRegistry, type OutboundMessage } from '../src/notifications/delivery/channel-adapter';
import { ConsoleEmailAdapter } from '../src/notifications/delivery/console-email.adapter';

class TestEmailAdapter {
  readonly channel = 'EMAIL';
  failFor = new Set<string>();
  sent: Array<Extract<OutboundMessage, { channel: 'EMAIL' }>> = [];
  async send(m: OutboundMessage) {
    if (m.channel !== 'EMAIL') throw new Error('not email');
    if (this.failFor.has(m.to)) throw new Error('smtp 500');
    this.sent.push(m);
    return { providerMessageId: `test:${randomUUID()}` };
  }
}

/**
 * 2D.2B — External delivery framework + email (ADR 0011). Strict opt-in; pluggable channel adapter;
 * retrying/dead-lettering dispatcher. Outbound never affects the in-app notification or the domain outbox.
 */
describe('Notification delivery — email (e2e, 2D.2B)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: OutboxRelayService;
  let delivery: NotificationDeliveryService;
  let registry: ChannelAdapterRegistry;
  let console_: ConsoleEmailAdapter;
  let token: string;
  let org: string;
  let unitId: string;
  let whId: string;
  const u = Date.now();
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const iso = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); };
  const drainOutbox = () => outbox.processBatch({ organizationId: org });
  const dispatch = () => delivery.dispatchPending({ organizationId: org });

  const member = async (roleKey: string) => {
    const email = `${roleKey}_${u}_${seq++}@x.test`;
    const b = (await http().post('/api/users').set(auth()).send({ email, name: roleKey, roleKey, password: 'password123' }).expect(201)).body;
    const t = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken;
    return { userId: b.userId as string, email, token: t as string };
  };
  const optIn = (t: string, notificationType: string, enabled = true) =>
    http().put('/api/notification-preferences').set(auth(t)).send({ notificationType, channel: 'EMAIL', enabled }).expect(200);
  const fireExpiry = async (lotNumber: string, days: number) => {
    const p = (await http().post('/api/products').set(auth()).send({ sku: `DP-${u}-${seq++}`, name: 'DP', baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id;
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whId, lines: [{ productId: p, quantity: 5, unitCost: 5, lotNumber, expiryDate: iso(days) }] }).expect(201);
    await http().post('/api/lots/expiry-scan').set(auth()).expect(201);
    await drainOutbox();
    return (await prisma.inventoryLot.findFirst({ where: { organizationId: org, lotNumber }, select: { id: true } }))!.id;
  };
  const deliveriesFor = (userId: string, type: string) =>
    prisma.notificationDelivery.findMany({ where: { recipient: { userId, notification: { organizationId: org, type } } } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    outbox = app.get(OutboxRelayService);
    delivery = app.get(NotificationDeliveryService);
    registry = app.get(ChannelAdapterRegistry);
    console_ = app.get(ConsoleEmailAdapter);
    token = (await http().post('/api/auth/register').send({ organizationName: `DLV ${u}`, adminEmail: `dlv_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    org = (await http().get('/api/auth/me').set(auth()).expect(200)).body.organizationId;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    registry.register(console_);
    delivery.config.jitterMs = 0; delivery.config.maxAttempts = 6; delivery.config.baseRetryMs = 1000;
    // Isolate delivery counts per test (deliveries have no org column — filter via the recipient relation).
    await prisma.notificationDelivery.deleteMany({ where: { recipient: { notification: { organizationId: org } } } });
  });

  it('no email preference → no delivery is queued (in-app notification still created)', async () => {
    const wm = await member('warehouse_manager');
    const lotId = await fireExpiry(`DNP-${seq}`, 6);
    expect(await deliveriesFor(wm.userId, 'LotExpiringSoon')).toHaveLength(0);
    // In-app notification exists regardless.
    const n = await prisma.notification.findFirst({ where: { organizationId: org, type: 'LotExpiringSoon', entityId: lotId } });
    expect(n).toBeTruthy();
  });

  it('explicit opt-in → delivery queued, dispatched, SENT; console adapter records the rendered message', async () => {
    const wm = await member('warehouse_manager');
    await optIn(wm.token, 'LotExpiringSoon');
    await fireExpiry(`DOPT-${seq}`, 6);
    const [d] = await deliveriesFor(wm.userId, 'LotExpiringSoon');
    expect(d!.status).toBe('PENDING');
    const before = console_.sent.length;
    const r = await dispatch();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const after = (await prisma.notificationDelivery.findUnique({ where: { id: d!.id } }))!;
    expect(after.status).toBe('SENT');
    expect(after.sentAt).toBeTruthy();
    expect(after.providerMessageId).toBeTruthy();
    expect(after.attemptCount).toBe(1);
    const msg = console_.sent.slice(before).find((m) => m.to === wm.email)!;
    expect(msg.subject).toBe('Lot expiring soon');
    expect(msg.textBody).toContain('expiring soon');
    expect(msg.textBody).toContain('/lots/'); // deep link
  });

  it('CRITICAL still requires opt-in; preference is scoped by type and per-user', async () => {
    const optedForSoon = await member('warehouse_manager');
    const optedNothing = await member('inventory_manager');
    await optIn(optedForSoon.token, 'LotExpiringSoon'); // opted in for a DIFFERENT type
    await fireExpiry(`DCRIT-${seq}`, -2); // LotExpired (CRITICAL)
    // No email delivery for either — neither opted in for LotExpired.
    expect(await deliveriesFor(optedForSoon.userId, 'LotExpired')).toHaveLength(0);
    expect(await deliveriesFor(optedNothing.userId, 'LotExpired')).toHaveLength(0);
    // But the CRITICAL in-app notification exists for both (cannot be suppressed by outbound prefs).
    const n = await prisma.notification.findFirst({ where: { organizationId: org, type: 'LotExpired' }, orderBy: { createdAt: 'desc' } });
    const recips = new Set((await prisma.notificationRecipient.findMany({ where: { notificationId: n!.id } })).map((r) => r.userId));
    expect(recips.has(optedForSoon.userId)).toBe(true);
    expect(recips.has(optedNothing.userId)).toBe(true);
  });

  it('only the opted-in user gets a delivery when two recipients differ in preference', async () => {
    const a = await member('warehouse_manager');
    const b = await member('inventory_manager');
    await optIn(a.token, 'LotExpiringSoon');
    await fireExpiry(`DTWO-${seq}`, 6);
    expect(await deliveriesFor(a.userId, 'LotExpiringSoon')).toHaveLength(1);
    expect(await deliveriesFor(b.userId, 'LotExpiringSoon')).toHaveLength(0);
  });

  it('a notification replay does not duplicate the delivery (unique recipient+channel)', async () => {
    const wm = await member('warehouse_manager');
    await optIn(wm.token, 'LotExpiringSoon');
    const lotId = await fireExpiry(`DREP-${seq}`, 6);
    const ev = (await prisma.outboxEvent.findFirst({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpiringSoon' } }))!;
    await prisma.consumerReceipt.deleteMany({ where: { eventId: ev.id, consumerName: 'notification-projection' } });
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'PENDING', availableAt: new Date(), publishedAt: null } });
    await drainOutbox();
    expect(await deliveriesFor(wm.userId, 'LotExpiringSoon')).toHaveLength(1);
  });

  it('transient failure retries with backoff, then reaches DEAD_LETTER; one bad email never blocks others', async () => {
    const test = new TestEmailAdapter();
    registry.register(test);
    delivery.config.maxAttempts = 3;
    const bad = await member('warehouse_manager');
    const good = await member('inventory_manager');
    await optIn(bad.token, 'LotExpiringSoon');
    await optIn(good.token, 'LotExpiringSoon');
    test.failFor.add(bad.email);
    await fireExpiry(`DFAIL-${seq}`, 6);
    const badId = (await deliveriesFor(bad.userId, 'LotExpiringSoon'))[0]!.id;
    const goodId = (await deliveriesFor(good.userId, 'LotExpiringSoon'))[0]!.id;

    await dispatch(); // attempt 1: bad → FAILED (future availableAt), good → SENT (not blocked)
    let badRow = (await prisma.notificationDelivery.findUnique({ where: { id: badId } }))!;
    expect(badRow.status).toBe('FAILED');
    expect(badRow.attemptCount).toBe(1);
    expect(new Date(badRow.availableAt).getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.notificationDelivery.findUnique({ where: { id: goodId } }))!.status).toBe('SENT');

    // Drive to DEAD_LETTER (reset availableAt each cycle).
    for (let i = 0; i < 2; i++) { await prisma.notificationDelivery.update({ where: { id: badId }, data: { availableAt: new Date() } }); await dispatch(); }
    badRow = (await prisma.notificationDelivery.findUnique({ where: { id: badId } }))!;
    expect(badRow.status).toBe('DEAD_LETTER');
    expect(badRow.attemptCount).toBe(3);
    expect(badRow.deadLetteredAt).toBeTruthy();
    // The in-app notification is untouched by the outbound failure.
    const recip = await prisma.notificationRecipient.findFirst({ where: { userId: bad.userId, notification: { type: 'LotExpiringSoon' } } });
    expect(recip).toBeTruthy();
  });

  it('a delivery whose recipient becomes disabled before send is SKIPPED, not sent', async () => {
    const test = new TestEmailAdapter();
    registry.register(test);
    const wm = await member('warehouse_manager');
    await optIn(wm.token, 'LotExpiringSoon');
    await fireExpiry(`DSKIP-${seq}`, 6);
    const id = (await deliveriesFor(wm.userId, 'LotExpiringSoon'))[0]!.id;
    await http().patch(`/api/users/${wm.userId}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    await dispatch();
    const row = (await prisma.notificationDelivery.findUnique({ where: { id } }))!;
    expect(row.status).toBe('SKIPPED');
    expect(test.sent.some((m) => m.to === wm.email)).toBe(false);
  });

  it('recovers an expired PROCESSING lease and concurrent dispatchers never double-send', async () => {
    const wm = await member('warehouse_manager');
    await optIn(wm.token, 'LotExpiringSoon');
    await fireExpiry(`DLEASE-${seq}`, 6);
    const id = (await deliveriesFor(wm.userId, 'LotExpiringSoon'))[0]!.id;
    // Simulate a crashed worker: PROCESSING with an expired lease.
    await prisma.notificationDelivery.update({ where: { id }, data: { status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() - 1000) } });
    await Promise.all([dispatch(), dispatch()]);
    const row = (await prisma.notificationDelivery.findUnique({ where: { id } }))!;
    expect(row.status).toBe('SENT');
    expect(row.attemptCount).toBe(1); // claimed by exactly one dispatcher — never double-sent
  });

  it('admin delivery diagnostics are org-scoped', async () => {
    const list = (await http().get('/api/notification-deliveries').set(auth()).expect(200)).body as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.every((d) => ['EMAIL'].includes(d.channel))).toBe(true);
    // Another org sees none.
    const other = (await http().post('/api/auth/register').send({ organizationName: `DLV2 ${u}`, adminEmail: `dlv2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    expect((await http().get('/api/notification-deliveries').set(auth(other)).expect(200)).body).toHaveLength(0);
  });
});

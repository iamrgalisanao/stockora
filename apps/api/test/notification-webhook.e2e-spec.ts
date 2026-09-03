process.env.OUTBOX_POLLER = 'off';
process.env.NOTIF_DELIVERY_POLLER = 'off';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { NotificationDeliveryService } from '../src/notifications/delivery/notification-delivery.service';
import { ChannelAdapterRegistry, type OutboundMessage } from '../src/notifications/delivery/channel-adapter';
import { ConsoleWebhookAdapter } from '../src/notifications/delivery/console-webhook.adapter';

class FailingWebhookAdapter {
  readonly channel = 'WEBHOOK';
  async send(_m: OutboundMessage): Promise<{ providerMessageId?: string }> { throw new Error('endpoint 503'); }
}

/**
 * 2D.2C — Org webhook integration (ADR 0011). Org-level config + subscriptions; signed, retryable delivery;
 * console/loopback transport (no egress). Outbound never affects the in-app notification or the outbox.
 */
describe('Notification webhook (e2e, 2D.2C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: OutboxRelayService;
  let delivery: NotificationDeliveryService;
  let registry: ChannelAdapterRegistry;
  let webhookAdapter: ConsoleWebhookAdapter;
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

  const configureWebhook = (body: Record<string, unknown>, t = token) => http().put('/api/notification-webhook').set(auth(t)).send(body);
  const subscribe = (notificationType: string, enabled: boolean) => http().put('/api/notification-webhook/subscriptions').set(auth()).send({ notificationType, enabled }).expect(200);
  const fireLotExpired = async (lotNumber: string) => {
    const p = (await http().post('/api/products').set(auth()).send({ sku: `WP-${u}-${seq++}`, name: 'WP', baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id;
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whId, lines: [{ productId: p, quantity: 5, unitCost: 5, lotNumber, expiryDate: iso(-2) }] }).expect(201);
    await http().post('/api/lots/expiry-scan').set(auth()).expect(201);
    await drainOutbox();
    const lot = (await prisma.inventoryLot.findFirst({ where: { organizationId: org, lotNumber }, select: { id: true } }))!;
    return lot.id;
  };
  const webhookDeliveries = () => prisma.notificationDelivery.findMany({ where: { organizationId: org, channel: 'WEBHOOK', notification: { type: 'LotExpired' } } });

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
    webhookAdapter = app.get(ConsoleWebhookAdapter);
    token = (await http().post('/api/auth/register').send({ organizationName: `WH ${u}`, adminEmail: `wh_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    org = (await http().get('/api/auth/me').set(auth()).expect(200)).body.organizationId;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
    // A manager so the LotExpired notification has an in-app recipient (webhook delivery is separate/org-level).
    await http().post('/api/users').set(auth()).send({ email: `wm_${u}@x.test`, name: 'WM', roleKey: 'warehouse_manager', password: 'password123' }).expect(201);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    registry.register(webhookAdapter);
    delivery.config.jitterMs = 0; delivery.config.maxAttempts = 6;
    await prisma.notificationDelivery.deleteMany({ where: { organizationId: org, channel: 'WEBHOOK' } });
  });

  it('config is org-scoped and never returns the signing secret', async () => {
    const res = (await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true, signingSecret: 'topsecret' }).expect(200)).body;
    expect(res.url).toBe('http://localhost:9999/hook');
    expect(res.enabled).toBe(true);
    expect(res.hasSigningSecret).toBe(true);
    expect('signingSecret' in res).toBe(false); // secret never leaves the server
    // Another org sees only its own (empty) config.
    const other = (await http().post('/api/auth/register').send({ organizationName: `WH2 ${u}`, adminEmail: `wh2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    const otherCfg = (await http().get('/api/notification-webhook').set(auth(other)).expect(200)).body;
    expect(otherCfg.url).toBeNull();
    expect(otherCfg.enabled).toBe(false);
  });

  it('no delivery when disabled or unsubscribed; exactly one when enabled + subscribed', async () => {
    // Enabled config but NOT subscribed → no webhook delivery.
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true }).expect(200);
    await fireLotExpired(`WNOSUB-${seq}`);
    expect(await webhookDeliveries()).toHaveLength(0);
    // Subscribe but DISABLE the config → still none.
    await subscribe('LotExpired', true);
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: false }).expect(200);
    await fireLotExpired(`WDIS-${seq}`);
    expect(await webhookDeliveries()).toHaveLength(0);
    // Enabled + subscribed → exactly one.
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true }).expect(200);
    const lotId = await fireLotExpired(`WON-${seq}`);
    const ds = (await webhookDeliveries()).filter((d) => true);
    const forThis = await prisma.notificationDelivery.findMany({ where: { organizationId: org, channel: 'WEBHOOK', notification: { entityId: lotId } } });
    expect(forThis).toHaveLength(1);
    expect(forThis[0]!.notificationRecipientId).toBeNull(); // org-level, no recipient
    expect(ds.length).toBeGreaterThanOrEqual(1);
  });

  it('dispatch sends a signed, versioned payload via the console adapter (no network) and reaches SENT', async () => {
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true, signingSecret: 'shh' }).expect(200);
    await subscribe('LotExpired', true);
    const lotId = await fireLotExpired(`WSEND-${seq}`);
    const d = (await prisma.notificationDelivery.findMany({ where: { organizationId: org, channel: 'WEBHOOK', notification: { entityId: lotId } } }))[0]!;
    const before = webhookAdapter.sent.length;
    await dispatch();
    const after = (await prisma.notificationDelivery.findUnique({ where: { id: d.id } }))!;
    expect(after.status).toBe('SENT');
    expect(after.providerMessageId).toContain('console-webhook:');
    const msg = webhookAdapter.sent.slice(before).find((m) => m.headers['x-inventory-delivery-id'] === d.id)!;
    expect(msg.url).toBe('http://localhost:9999/hook');
    const payload = JSON.parse(msg.body);
    expect(payload).toMatchObject({ schemaVersion: 1, deliveryId: d.id, id: expect.any(String), type: 'LotExpired', severity: 'CRITICAL' });
    expect(payload.entity).toEqual({ type: 'lot', id: lotId });
    expect(payload.eventId).toBeTruthy();
    // Deterministic HMAC over the exact serialized body.
    const expected = `sha256=${createHmac('sha256', 'shh').update(msg.body).digest('hex')}`;
    expect(msg.headers['x-inventory-signature']).toBe(expected);
  });

  it('a replay does not duplicate the webhook delivery', async () => {
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true }).expect(200);
    await subscribe('LotExpired', true);
    const lotId = await fireLotExpired(`WREP-${seq}`);
    const ev = (await prisma.outboxEvent.findFirst({ where: { organizationId: org, aggregateId: lotId, eventType: 'LotExpired' } }))!;
    await prisma.consumerReceipt.deleteMany({ where: { eventId: ev.id, consumerName: 'notification-projection' } });
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: 'PENDING', availableAt: new Date(), publishedAt: null } });
    await drainOutbox();
    expect(await prisma.notificationDelivery.count({ where: { organizationId: org, channel: 'WEBHOOK', notification: { entityId: lotId } } })).toBe(1);
  });

  it('webhook failure retries then dead-letters, without affecting the in-app notification', async () => {
    registry.register(new FailingWebhookAdapter());
    delivery.config.maxAttempts = 2;
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true }).expect(200);
    await subscribe('LotExpired', true);
    const lotId = await fireLotExpired(`WFAIL-${seq}`);
    const id = (await prisma.notificationDelivery.findMany({ where: { organizationId: org, channel: 'WEBHOOK', notification: { entityId: lotId } } }))[0]!.id;
    await dispatch(); // attempt 1 → FAILED
    expect((await prisma.notificationDelivery.findUnique({ where: { id } }))!.status).toBe('FAILED');
    await prisma.notificationDelivery.update({ where: { id }, data: { availableAt: new Date() } });
    await dispatch(); // attempt 2 → DEAD_LETTER
    const row = (await prisma.notificationDelivery.findUnique({ where: { id } }))!;
    expect(row.status).toBe('DEAD_LETTER');
    // The in-app notification + recipients are untouched by the outbound failure.
    const n = await prisma.notification.findFirst({ where: { organizationId: org, entityId: lotId, type: 'LotExpired' } });
    expect(n).toBeTruthy();
    expect(await prisma.notificationRecipient.count({ where: { notificationId: n!.id } })).toBeGreaterThanOrEqual(1);
  });

  it('admin delivery diagnostics include the WEBHOOK channel', async () => {
    await configureWebhook({ url: 'http://localhost:9999/hook', enabled: true }).expect(200);
    await subscribe('LotExpired', true);
    await fireLotExpired(`WADMIN-${seq}`);
    await dispatch();
    const list = (await http().get('/api/notification-deliveries').set(auth()).expect(200)).body as any[];
    expect(list.some((d) => d.channel === 'WEBHOOK')).toBe(true);
  });
});

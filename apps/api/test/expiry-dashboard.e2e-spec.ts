import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2C.2C — Expiry dashboard + alert facts (ADR 0008 §9-10). Visibility read model + idempotent
 * expiry-condition facts (never notifications). UI is browser-verified separately.
 */
describe('Expiry dashboard + facts (e2e, 2C.2C)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const iso = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); };

  const newProduct = async (prefix: string) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id as string;
  const seed = (productId: string, qty: number, lotNumber: string, expiryDate?: string) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 5, lotNumber, ...(expiryDate ? { expiryDate } : {}) }] }).expect(201);
  const dash = async (query = '', t = token) =>
    (await http().get(`/api/lots/expiry-dashboard${query}`).set(auth(t)).expect(200)).body as Array<Record<string, unknown>>;
  const scan = async () => (await http().post('/api/lots/expiry-scan').set(auth()).expect(201)).body;
  const facts = async (query = '') => (await http().get(`/api/lots/expiry-facts${query}`).set(auth()).expect(200)).body as Array<Record<string, unknown>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Dash ${u}`, adminEmail: `dash_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('dashboard shows derived state + days remaining and supports state/withinDays filters; org-isolated', async () => {
    const p = await newProduct('D-STATES');
    await seed(p, 5, 'HEALTHY', iso(200));
    await seed(p, 5, 'SOON', iso(10));
    await seed(p, 5, 'GONE', iso(-3));
    const rows = await dash(`?productId=${p}`);
    const byLot = (ln: string) => rows.find((r) => r.lotNumber === ln)!;
    expect(byLot('HEALTHY').expiryState).toBe('HEALTHY');
    expect(byLot('SOON').expiryState).toBe('EXPIRING_SOON');
    expect(byLot('SOON').daysRemaining).toBe(10); // business-date days
    expect(byLot('GONE').expiryState).toBe('EXPIRED');
    expect(Number(byLot('GONE').daysRemaining)).toBeLessThan(0);
    // Filters.
    expect((await dash(`?productId=${p}&expiryState=EXPIRED`)).length).toBe(1);
    expect((await dash(`?productId=${p}&withinDays=30`)).map((r) => r.lotNumber).sort()).toEqual(['GONE', 'SOON']);
    // Org isolation.
    const other = (await http().post('/api/auth/register').send({ organizationName: `DOther ${u}`, adminEmail: `dother_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    expect((await dash(`?productId=${p}`, other)).length).toBe(0);
  });

  it('expired physical stock stays visible on the dashboard', async () => {
    const p = await newProduct('D-EXPVIS');
    await seed(p, 12, 'DEAD', iso(-1));
    const rows = await dash(`?productId=${p}&hasStock=true`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.expiryState).toBe('EXPIRED');
    expect(rows[0]!.onHand).toBe('12'); // still physically on hand
  });

  it('emits an expiring-soon and an expired fact once, and does not duplicate on repeated scans', async () => {
    const p = await newProduct('D-FACTS');
    await seed(p, 5, 'SOONF', iso(7));
    await seed(p, 5, 'DEADF', iso(-2));
    await seed(p, 5, 'OKF', iso(300)); // healthy → no fact

    const first = await scan();
    expect(first.expiringSoon).toBeGreaterThanOrEqual(1);
    expect(first.expired).toBeGreaterThanOrEqual(1);
    const afterFirst = await facts();
    const mine = afterFirst.filter((f) => [/* our lots */].length >= 0 && (f as { productId: string }).productId === p);
    expect(mine.filter((f) => (f as { eventType: string }).eventType === 'LOT_EXPIRING_SOON').length).toBe(1);
    expect(mine.filter((f) => (f as { eventType: string }).eventType === 'LOT_EXPIRED').length).toBe(1);

    // Repeat scan → no duplicate facts.
    await scan();
    const afterSecond = (await facts()).filter((f) => (f as { productId: string }).productId === p);
    expect(afterSecond.length).toBe(2);
  });

  it('facts are queryable by event type and carry the expected payload', async () => {
    const expired = await facts('?eventType=LOT_EXPIRED');
    expect(expired.every((f) => (f as { eventType: string }).eventType === 'LOT_EXPIRED')).toBe(true);
    if (expired.length > 0) {
      const f = expired[0]! as Record<string, unknown>;
      for (const k of ['lotId', 'warehouseId', 'productId', 'daysRemaining', 'detectedAt']) expect(f[k]).toBeDefined();
    }
  });
});

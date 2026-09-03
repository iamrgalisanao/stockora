import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2C.2A — Expiry Policy + Eligibility (ADR 0008). Shelf-life policy, business-date expiry, receiving
 * validation, the expired/expiring read model, and blocking expired lots from release. FEFO is 2C.2B.
 */
describe('Lot expiry policy + eligibility (e2e, 2C.2A)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const iso = (daysFromNow: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + daysFromNow); return d.toISOString(); };

  const newProduct = async (prefix: string, batch = true) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: batch }).expect(201)).body.id as string;
  const setPolicy = (productId: string, body: Record<string, unknown>) =>
    http().put(`/api/products/${productId}/shelf-life-policy`).set(auth()).send(body).expect(200);
  const open = (line: Record<string, unknown>, expectCode = 201) =>
    http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whId, lines: [line] }).expect(expectCode);
  const lots = async (productId: string, query = '') =>
    (await http().get(`/api/lots?productId=${productId}${query}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const pickable = async (productId: string) =>
    (await http().get(`/api/lots/pickable?productId=${productId}&warehouseId=${whId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const balances = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Exp ${u}`, adminEmail: `exp_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('a batch lot may exist without expiry when policy does not require it', async () => {
    const p = await newProduct('E-OPTIONAL');
    await open({ productId: p, quantity: 10, unitCost: 5, lotNumber: 'NOEXP' }, 201);
    expect((await lots(p))[0]!.expiryState).toBe('NO_EXPIRY');
  });

  it('an expiry-required product rejects a receipt without an expiry date', async () => {
    const p = await newProduct('E-REQUIRED');
    await setPolicy(p, { expiryTrackingRequired: true });
    await open({ productId: p, quantity: 10, unitCost: 5, lotNumber: 'NOEXP2' }, 400); // no expiry → rejected
    await open({ productId: p, quantity: 10, unitCost: 5, lotNumber: 'HASEXP', expiryDate: iso(400) }, 201);
  });

  it('enforces minimum shelf life on receipt, with an audited override', async () => {
    const p = await newProduct('E-MINSHELF');
    await setPolicy(p, { expiryTrackingRequired: true, minimumShelfLifeOnReceiptDays: 90 });
    // 30 days left < 90 → rejected without override.
    await open({ productId: p, quantity: 10, unitCost: 5, lotNumber: 'SHORT', expiryDate: iso(30) }, 400);
    // With the override flag (admin has inventory.expiry_override) → accepted.
    await open({ productId: p, quantity: 10, unitCost: 5, lotNumber: 'SHORT', expiryDate: iso(30), allowShortShelfLife: true }, 201);
    // A lot with adequate shelf life posts normally.
    await open({ productId: p, quantity: 5, unitCost: 5, lotNumber: 'LONG', expiryDate: iso(200) }, 201);
  });

  it('derives EXPIRED / EXPIRING_SOON / HEALTHY and supports the expiryState filter', async () => {
    const p = await newProduct('E-STATES');
    await open({ productId: p, quantity: 5, unitCost: 5, lotNumber: 'HEALTHY', expiryDate: iso(200) }, 201);
    await open({ productId: p, quantity: 5, unitCost: 5, lotNumber: 'SOON', expiryDate: iso(10) }, 201);
    await open({ productId: p, quantity: 5, unitCost: 5, lotNumber: 'GONE', expiryDate: iso(-2) }, 201);
    const stateOf = async (ln: string) => (await lots(p)).find((l) => l.lotNumber === ln)!.expiryState;
    expect(await stateOf('HEALTHY')).toBe('HEALTHY');
    expect(await stateOf('SOON')).toBe('EXPIRING_SOON');
    expect(await stateOf('GONE')).toBe('EXPIRED');
    const expired = await lots(p, '&expiryState=EXPIRED');
    expect(expired.length).toBe(1);
    expect(expired[0]!.lotNumber).toBe('GONE');
  });

  it('an expired lot stays in on_hand but is excluded from release and from the picker', async () => {
    const p = await newProduct('E-BLOCK');
    await open({ productId: p, quantity: 40, unitCost: 5, lotNumber: 'FRESH', expiryDate: iso(200) }, 201);
    await open({ productId: p, quantity: 20, unitCost: 5, lotNumber: 'DEAD', expiryDate: iso(-1) }, 201);
    const dead = (await lots(p)).find((l) => l.lotNumber === 'DEAD')!;

    // Physically still on hand.
    expect((await balances(p)).find((b) => b.lotId === dead.id)!.onHand).toBe('20');
    // Excluded from the operational picker.
    expect((await pickable(p)).some((l) => l.lotNumber === 'DEAD')).toBe(false);
    expect((await pickable(p)).some((l) => l.lotNumber === 'FRESH')).toBe(true);

    // Release allocating the expired lot is rejected; the fresh lot releases fine.
    const relBad = (await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId: p, requestedQty: 5, allocations: [{ lotId: dead.id, quantity: 5 }] }] }).expect(201)).body;
    await http().post(`/api/releases/${relBad.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${relBad.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${relBad.id}/post`).set(auth()).expect(400); // expired → blocked
    // Expired stock untouched.
    expect((await balances(p)).find((b) => b.lotId === dead.id)!.onHand).toBe('20');
  });

  it('non-batch products are unaffected by expiry policy', async () => {
    const p = await newProduct('E-NONBATCH', false);
    await open({ productId: p, quantity: 30, unitCost: 2 }, 201);
    const rel = (await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId: p, requestedQty: 10 }] }).expect(201)).body;
    await http().post(`/api/releases/${rel.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.id}/post`).set(auth()).expect(201);
    expect((await balances(p))[0]!.onHand).toBe('20');
  });

  it('shelf-life policy get returns implicit defaults then the configured row', async () => {
    const p = await newProduct('E-POLICY');
    const before = (await http().get(`/api/products/${p}/shelf-life-policy`).set(auth()).expect(200)).body;
    expect(before.configured).toBe(false);
    expect(before.allocationStrategy).toBe('MANUAL');
    await setPolicy(p, { expiryTrackingRequired: true, expiringSoonDays: 14, allocationStrategy: 'FEFO' });
    const after = (await http().get(`/api/products/${p}/shelf-life-policy`).set(auth()).expect(200)).body;
    expect(after.configured).toBe(true);
    expect(after.expiryTrackingRequired).toBe(true);
    expect(after.expiringSoonDays).toBe(14);
    expect(after.allocationStrategy).toBe('FEFO');
  });
});

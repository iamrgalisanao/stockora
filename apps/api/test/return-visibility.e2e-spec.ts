import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2B.2C — Visibility surface. The quarantine drill-down reconciles to StockBalance.quarantined (like the
 * reserved drill-down), respects org/warehouse scope, list filters work, and history matches the
 * immutable disposition records. UI behaviour is browser-verified separately.
 */
describe('Return visibility (e2e, 2B.2C)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string) => {
    const s = sku(prefix);
    const id = (await http().post('/api/products').set(auth()).send({ sku: s, name: s, baseUomId: unitId }).expect(201)).body.id;
    return { id, sku: s };
  };
  const archiveProduct = (id: string) =>
    http().post(`/api/products/${id}/status`).set(auth()).send({ status: 'ARCHIVED' }).expect(201);
  const opening = (productId: string, quantity: number) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity, unitCost: 10 }] }).expect(201);
  const balance = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body
      .find((b: { warehouseId: string }) => b.warehouseId === whId);
  const quarantineOf = async (productId: string, t = token) =>
    (await http().get(`/api/returns/quarantine-breakdown?productId=${productId}&warehouseId=${whId}`).set(auth(t)).expect(200)).body;

  const received = async (productId: string, qty: number, extra: Record<string, unknown> = {}) => {
    const ret = (await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: whId, lines: [{ productId, quantity: qty }], ...extra }).expect(201)).body;
    return (await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201)).body;
  };
  const dispose = (id: string, lineId: string, type: string, quantity: number) =>
    http().post(`/api/returns/${id}/dispositions`).set(auth()).send({ lineId, type, quantity }).expect(201);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Vis ${u}`, adminEmail: `vis_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('quarantine drill-down sums to StockBalance.quarantined', async () => {
    const p = await newProduct('V-SUM');
    await opening(p.id, 100);
    await received(p.id, 12);
    await received(p.id, 8);
    const bal = await balance(p.id);
    expect(bal.quarantined).toBe('20');
    const rows = await quarantineOf(p.id);
    const sum = rows.reduce((a: number, r: { remaining: string }) => a + Number(r.remaining), 0);
    expect(sum).toBe(20);
    expect(rows.length).toBe(2);
  });

  it('drill-down reflects remaining after partial disposition and excludes completed returns', async () => {
    const p = await newProduct('V-PARTIAL');
    await opening(p.id, 100);
    const r1 = await received(p.id, 10);
    await dispose(r1.id, r1.lines[0].id, 'RESTOCK', 4); // 6 remain
    const done = await received(p.id, 5); // fully dispose this one
    await dispose(done.id, done.lines[0].id, 'DISPOSE', 5); // COMPLETED -> excluded

    const bal = await balance(p.id);
    expect(bal.quarantined).toBe('6');
    const rows = await quarantineOf(p.id);
    const sum = rows.reduce((a: number, r: { remaining: string }) => a + Number(r.remaining), 0);
    expect(sum).toBe(6);
    expect(rows.every((r: { status: string }) => r.status !== 'COMPLETED')).toBe(true);
  });

  it('quarantine drill-down is org-scoped (another org sees nothing)', async () => {
    const p = await newProduct('V-SCOPE');
    await opening(p.id, 30);
    await received(p.id, 7);
    const other = (await http().post('/api/auth/register')
      .send({ organizationName: `OtherV ${u}`, adminEmail: `otherv_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    const rows = await quarantineOf(p.id, other); // other org, our product+warehouse ids
    expect(rows).toEqual([]);
  });

  it('list filter hasQuarantine returns only returns still holding stock', async () => {
    const p = await newProduct('V-HASQ');
    await opening(p.id, 50);
    const held = await received(p.id, 6); // RECEIVED -> holds quarantine
    const completed = await received(p.id, 4);
    await dispose(completed.id, completed.lines[0].id, 'RESTOCK', 4); // COMPLETED -> no quarantine

    const rows = (await http().get('/api/returns?hasQuarantine=true').set(auth()).expect(200)).body;
    expect(rows.some((r: { id: string }) => r.id === held.id)).toBe(true);
    expect(rows.some((r: { id: string }) => r.id === completed.id)).toBe(false);
    expect(rows.every((r: { status: string }) => r.status === 'RECEIVED' || r.status === 'PARTIALLY_DISPOSED')).toBe(true);
  });

  it('list filters by type and source reference', async () => {
    const p = await newProduct('V-FILTER');
    await opening(p.id, 40);
    const ret = await received(p.id, 5, { type: 'SUPPLIER', sourceReference: `PO-${seq}-XYZ` });
    const srcRef = (await http().get(`/api/returns/${ret.id}`).set(auth()).expect(200)).body.sourceReference;

    const byType = (await http().get('/api/returns?type=SUPPLIER').set(auth()).expect(200)).body;
    expect(byType.every((r: { type: string }) => r.type === 'SUPPLIER')).toBe(true);
    expect(byType.some((r: { id: string }) => r.id === ret.id)).toBe(true);

    const bySrc = (await http().get(`/api/returns?sourceReference=${srcRef}`).set(auth()).expect(200)).body;
    expect(bySrc.some((r: { id: string }) => r.id === ret.id)).toBe(true);
  });

  it('history: disposition records are returned immutably and match what was posted', async () => {
    const p = await newProduct('V-HIST');
    await opening(p.id, 50);
    const ret = await received(p.id, 10);
    const line = ret.lines[0].id;
    await dispose(ret.id, line, 'RESTOCK', 6);
    await dispose(ret.id, line, 'DAMAGED', 2);

    const r = (await http().get(`/api/returns/${ret.id}`).set(auth()).expect(200)).body;
    const disps = r.lines[0].dispositions;
    expect(disps.length).toBe(2);
    expect(disps.map((d: { type: string }) => d.type)).toEqual(['RESTOCK', 'DAMAGED']); // ordered by performedAt
    expect(disps.every((d: { performedAt: string }) => !!d.performedAt)).toBe(true);
    expect(r.lines[0].remainingQuarantine).toBe('2');
  });

  it('a completed return remains readable after its product is archived', async () => {
    const p = await newProduct('V-ARCH');
    await opening(p.id, 20);
    const ret = await received(p.id, 5);
    await dispose(ret.id, ret.lines[0].id, 'DISPOSE', 5); // COMPLETED, on_hand back to 20 (25-5)
    // Drain remaining on_hand so the product can be archived.
    const rel = (await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId: p.id, requestedQty: 20 }] }).expect(201)).body;
    await http().post(`/api/releases/${rel.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.id}/post`).set(auth()).expect(201);
    await archiveProduct(p.id);

    const r = (await http().get(`/api/returns/${ret.id}`).set(auth()).expect(200)).body;
    expect(r.status).toBe('COMPLETED');
    expect(r.lines[0].productSku).toBe(p.sku);
  });
});

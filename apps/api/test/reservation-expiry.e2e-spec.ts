import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2B.1C — Expiry + operational read paths. Expiry is a STATE TRANSITION, not deletion: it releases only
 * the remaining reserved quantity, preserves consumedQuantity, and never touches on-hand history (ADR 0005).
 * The interval sweep is disabled under NODE_ENV=test; these drive expiry explicitly via POST /expire-due.
 */
describe('Reservation expiry + UX (e2e, 2B.1C)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const past = () => new Date(Date.now() - 3_600_000).toISOString();
  const future = () => new Date(Date.now() + 3_600_000).toISOString();

  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const newProduct = async (prefix: string) => {
    const s = sku(prefix);
    const id = (await http().post('/api/products').set(auth()).send({ sku: s, name: s, baseUomId: unitId }).expect(201)).body.id;
    return { id, sku: s };
  };
  const opening = (productId: string, quantity: number) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity, unitCost: 10 }] }).expect(201);
  const balance = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body
      .find((b: { warehouseId: string }) => b.warehouseId === whId);
  const reservation = async (id: string, t = token) =>
    (await http().get(`/api/reservations/${id}`).set(auth(t)).expect(200)).body;

  // Create a reservation and (optionally) confirm it so the reserved bucket is adjusted.
  const reserve = async (productId: string, qty: number, opts: { expiresAt?: string; confirm?: boolean } = {}) => {
    const body: Record<string, unknown> = { warehouseId: whId, lines: [{ productId, quantity: qty }] };
    if (opts.expiresAt) body.expiresAt = opts.expiresAt;
    const r = (await http().post('/api/reservations').set(auth()).send(body).expect(201)).body;
    if (opts.confirm !== false) await http().post(`/api/reservations/${r.id}/confirm`).set(auth()).expect(201);
    return { reservationId: r.id as string, lineId: r.lines[0].id as string, reservationNo: r.reservationNo as string };
  };

  // Create → submit → approve → post a release consuming `reservationLineId`.
  const consume = async (productId: string, qty: number, reservationLineId: string) => {
    const rel = (await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty, reservationLineId }] })
      .expect(201)).body;
    await http().post(`/api/releases/${rel.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.id}/approve`).set(auth()).send({}).expect(201);
    return rel.id as string;
  };
  const expireDue = async () => (await http().post('/api/reservations/expire-due').set(auth()).expect(201)).body as { expired: number };

  // Plain (unreserved) issue of the full quantity, posted — used to drain on-hand to zero.
  const issueAndPost = async (productId: string, qty: number) => {
    const rel = (await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] })
      .expect(201)).body;
    await http().post(`/api/releases/${rel.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.id}/post`).set(auth()).expect(201);
  };

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

  it('expires a full unconsumed reservation and releases the reserved quantity', async () => {
    const p = await newProduct('EXP-FULL');
    await opening(p.id, 100);
    const { reservationId } = await reserve(p.id, 40, { expiresAt: past() });
    expect((await balance(p.id)).reserved).toBe('40');

    const res = await expireDue();
    expect(res.expired).toBeGreaterThanOrEqual(1);

    const bal = await balance(p.id);
    expect(bal.reserved).toBe('0');
    expect(bal.onHand).toBe('100'); // physical history untouched
    expect(bal.available).toBe('100');
    const r = await reservation(reservationId);
    expect(r.status).toBe('EXPIRED');
    expect(r.completedAt).toBeTruthy();
  });

  it('expires only the remaining quantity of a partially consumed reservation', async () => {
    const p = await newProduct('EXP-PART');
    await opening(p.id, 100);
    const { reservationId, lineId } = await reserve(p.id, 10, { expiresAt: past() });
    const rel = await consume(p.id, 4, lineId);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(201);
    expect((await balance(p.id)).reserved).toBe('6'); // 10 - 4 consumed

    await expireDue();

    const bal = await balance(p.id);
    expect(bal.reserved).toBe('0'); // remaining 6 released
    expect(bal.onHand).toBe('96'); // only the 4 consumed left physically
    const r = await reservation(reservationId);
    expect(r.status).toBe('EXPIRED');
    expect(r.lines[0].consumedQuantity).toBe('4'); // consumption preserved, not reversed
    expect(r.lines[0].remaining).toBe('6'); // historical remaining at expiry
  });

  it('is idempotent — running expiry twice does not decrement reserved twice', async () => {
    const p = await newProduct('EXP-IDEM');
    await opening(p.id, 50);
    await reserve(p.id, 20, { expiresAt: past() });

    await expireDue();
    expect((await balance(p.id)).reserved).toBe('0');
    // A second sweep must not touch this already-expired reservation.
    await expireDue();
    const bal = await balance(p.id);
    expect(bal.reserved).toBe('0');
    expect(bal.onHand).toBe('50');
    expect(bal.available).toBe('50');
  });

  it('rejects consuming an expired reservation', async () => {
    const p = await newProduct('EXP-NOCONSUME');
    await opening(p.id, 100);
    const { lineId } = await reserve(p.id, 30, { expiresAt: past() });
    await expireDue();

    const rel = await consume(p.id, 10, lineId);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(400); // validateConsumable rejects EXPIRED
  });

  it('cancel/release before expiry prevents any expiry mutation', async () => {
    const p = await newProduct('EXP-RELEASED');
    await opening(p.id, 100);
    const { reservationId } = await reserve(p.id, 25, { expiresAt: past() });
    await http().post(`/api/reservations/${reservationId}/release`).set(auth()).expect(201);
    expect((await balance(p.id)).reserved).toBe('0'); // released returns reserved to available

    await expireDue(); // due by time, but no longer active — must be a no-op

    const bal = await balance(p.id);
    expect(bal.reserved).toBe('0'); // unchanged, not double-released
    const r = await reservation(reservationId);
    expect(r.status).toBe('RELEASED'); // NOT flipped to EXPIRED
  });

  it('does not expire a future reservation early', async () => {
    const p = await newProduct('EXP-FUTURE');
    await opening(p.id, 100);
    const { reservationId } = await reserve(p.id, 15, { expiresAt: future() });

    await expireDue();

    expect((await balance(p.id)).reserved).toBe('15'); // still committed
    expect((await reservation(reservationId)).status).toBe('RESERVED');
  });

  it('enforces org scope in list and detail', async () => {
    const p = await newProduct('EXP-SCOPE');
    await opening(p.id, 30);
    const { reservationId } = await reserve(p.id, 5, { expiresAt: future() });

    // A different org sees none of our reservations and cannot fetch ours by id.
    const otherToken = (await http().post('/api/auth/register')
      .send({ organizationName: `Other ${u}`, adminEmail: `other_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    const otherList = (await http().get('/api/reservations').set(auth(otherToken)).expect(200)).body;
    expect(otherList.find((r: { id: string }) => r.id === reservationId)).toBeUndefined();
    await http().get(`/api/reservations/${reservationId}`).set(auth(otherToken)).expect(404);
  });

  it('filters by status and searches by reservation number and SKU', async () => {
    const p = await newProduct('EXP-FILTER');
    await opening(p.id, 40);
    const { reservationId, reservationNo } = await reserve(p.id, 8, { expiresAt: future() });

    const byNo = (await http().get(`/api/reservations?q=${reservationNo}`).set(auth()).expect(200)).body;
    expect(byNo.some((r: { id: string }) => r.id === reservationId)).toBe(true);

    const bySku = (await http().get(`/api/reservations?q=${p.sku}`).set(auth()).expect(200)).body;
    expect(bySku.some((r: { id: string }) => r.id === reservationId)).toBe(true);

    const reservedOnly = (await http().get('/api/reservations?status=RESERVED').set(auth()).expect(200)).body;
    expect(reservedOnly.every((r: { status: string }) => r.status === 'RESERVED')).toBe(true);
    expect(reservedOnly.some((r: { id: string }) => r.id === reservationId)).toBe(true);

    const draftOnly = (await http().get('/api/reservations?status=DRAFT').set(auth()).expect(200)).body;
    expect(draftOnly.some((r: { id: string }) => r.id === reservationId)).toBe(false);
  });

  it('reserved drill-down sums to the balance reserved bucket', async () => {
    const p = await newProduct('EXP-DRILL');
    await opening(p.id, 100);
    await reserve(p.id, 12, { expiresAt: future() });
    await reserve(p.id, 8, { expiresAt: future() });

    const bal = await balance(p.id);
    expect(bal.reserved).toBe('20');
    const rows = (await http().get(`/api/reservations/reserved-breakdown?productId=${p.id}&warehouseId=${whId}`).set(auth()).expect(200)).body;
    const sum = rows.reduce((acc: number, r: { remaining: string }) => acc + Number(r.remaining), 0);
    expect(sum).toBe(20);
  });

  it('a historical expired reservation still resolves an archived product', async () => {
    const p = await newProduct('EXP-ARCHIVED');
    await opening(p.id, 20);
    const { reservationId } = await reserve(p.id, 6, { expiresAt: past() });
    await expireDue();
    await issueAndPost(p.id, 20); // drain on-hand so the product can be archived
    await http().post(`/api/products/${p.id}/status`).set(auth()).send({ status: 'ARCHIVED' }).expect(201);

    const r = await reservation(reservationId);
    expect(r.status).toBe('EXPIRED');
    expect(r.lines[0].productSku).toBe(p.sku); // archived product still resolves in history
    expect(r.warehouseCode).toBeTruthy();
  });

  it('records expiration under a single correlation id per sweep', async () => {
    const a = await newProduct('EXP-CORR-A');
    const b = await newProduct('EXP-CORR-B');
    await opening(a.id, 10);
    await opening(b.id, 10);
    const ra = await reserve(a.id, 3, { expiresAt: past() });
    const rb = await reserve(b.id, 4, { expiresAt: past() });

    await expireDue();

    const page = (await http().get('/api/audit?action=reservation.expired&limit=100').set(auth()).expect(200)).body;
    const mine = page.entries.filter((e: { entityId: string }) => e.entityId === ra.reservationId || e.entityId === rb.reservationId);
    expect(mine.length).toBe(2);
    expect(mine[0].correlationId).toBeTruthy();
    expect(new Set(mine.map((e: { correlationId: string }) => e.correlationId)).size).toBe(1); // one sweep, one correlation id
    expect(mine.every((e: { source: string }) => e.source === 'SYSTEM')).toBe(true);
  });
});

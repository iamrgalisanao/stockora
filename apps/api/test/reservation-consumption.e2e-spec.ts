import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Reservation consumption via releases (e2e, 2B.1B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let token: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const newProduct = async (sku: string) =>
    (await http().post('/api/products').set(auth()).send({ sku, name: sku, baseUomId: unitId }).expect(201)).body.id;
  const opening = (productId: string, quantity: number) =>
    http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whId, lines: [{ productId, quantity, unitCost: 10 }] }).expect(201);
  const balance = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body
      .find((b: { warehouseId: string }) => b.warehouseId === whId);

  // Reserve `qty` of a product and return { reservationId, lineId }.
  const reserve = async (productId: string, qty: number) => {
    const r = (await http().post('/api/reservations').set(auth()).send({ warehouseId: whId, lines: [{ productId, quantity: qty }] }).expect(201)).body;
    await http().post(`/api/reservations/${r.id}/confirm`).set(auth()).expect(201);
    return { reservationId: r.id, lineId: r.lines[0].id };
  };
  const reservation = async (id: string) => (await http().get(`/api/reservations/${id}`).set(auth()).expect(200)).body;

  // Create → submit → approve → post a release consuming `reservationLineId`.
  const releaseConsuming = async (productId: string, qty: number, reservationLineId?: string, extraItems: unknown[] = []) => {
    const items = [{ productId, requestedQty: qty, ...(reservationLineId ? { reservationLineId } : {}) }, ...extraItems];
    const rel = (await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items }).expect(201)).body;
    await http().post(`/api/releases/${rel.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.id}/approve`).set(auth()).send({}).expect(201);
    return rel.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Cons ${u}`, adminEmail: `cons_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('partial consumption decrements on_hand + reserved together and leaves availability unchanged', async () => {
    const p = await newProduct(`PART-${u}`);
    await opening(p, 100);
    const { reservationId, lineId } = await reserve(p, 50); // reserved 50, available 50
    const rel = await releaseConsuming(p, 20, lineId);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(201);

    const bal = await balance(p);
    expect(bal.onHand).toBe('80'); // physical shipped
    expect(bal.reserved).toBe('30'); // 50 - 20 consumed
    expect(bal.available).toBe('50'); // unchanged — consuming committed stock doesn't free availability
    const r = await reservation(reservationId);
    expect(r.status).toBe('PARTIALLY_CONSUMED');
    expect(r.lines[0].consumedQuantity).toBe('20');
    expect(r.lines[0].remaining).toBe('30');
  });

  it('reaches CONSUMED when the reservation is fully consumed', async () => {
    const p = await newProduct(`FULL-${u}`);
    await opening(p, 40);
    const { reservationId, lineId } = await reserve(p, 40);
    const rel = await releaseConsuming(p, 40, lineId);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(201);

    const bal = await balance(p);
    expect(bal.onHand).toBe('0');
    expect(bal.reserved).toBe('0');
    const r = await reservation(reservationId);
    expect(r.status).toBe('CONSUMED');
    expect(r.completedAt).toBeTruthy();
  });

  it('rejects consuming more than the remaining reservation', async () => {
    const p = await newProduct(`OVER-${u}`);
    await opening(p, 100);
    const { lineId } = await reserve(p, 10);
    const rel = await releaseConsuming(p, 25, lineId); // approved 25 > reserved 10
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(400);
    // Nothing consumed; reservation still fully reserved.
    const bal = await balance(p);
    expect(bal.reserved).toBe('10');
  });

  it('does not double-decrement on a replayed post', async () => {
    const p = await newProduct(`DBL-${u}`);
    await opening(p, 100);
    const { lineId } = await reserve(p, 30);
    const rel = await releaseConsuming(p, 30, lineId);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(201); // idempotent replay
    const bal = await balance(p);
    expect(bal.onHand).toBe('70'); // decremented once, not twice
    expect(bal.reserved).toBe('0');
  });

  it('handles a mixed release — one reserved line + one unreserved line', async () => {
    const reserved = await newProduct(`MIX-R-${u}`);
    const plain = await newProduct(`MIX-P-${u}`);
    await opening(reserved, 100);
    await opening(plain, 100);
    const { lineId } = await reserve(reserved, 40);
    const rel = await releaseConsuming(reserved, 40, lineId, [{ productId: plain, requestedQty: 15 }]);
    await http().post(`/api/releases/${rel}/post`).set(auth()).expect(201);

    const rb = await balance(reserved);
    expect(rb.onHand).toBe('60'); expect(rb.reserved).toBe('0'); // consumed the reservation
    const pb = await balance(plain);
    expect(pb.onHand).toBe('85'); expect(pb.reserved).toBe('0'); // plain issue, no reservation involved
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2B.2A — Return Intake (ADR 0006). Receiving a return lands stock in QUARANTINE via a RETURN_RECEIPT
 * movement: on_hand +q AND quarantined +q, so physical stock rises while sellable availability is
 * unchanged. Intake is idempotent; cancel is allowed only before receipt; received returns are immutable.
 */
describe('Return intake (e2e, 2B.2A)', () => {
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
  const getReturn = async (id: string, t = token) =>
    (await http().get(`/api/returns/${id}`).set(auth(t)).expect(200)).body;

  const draftReturn = async (productId: string, qty: number, type = 'CUSTOMER') =>
    (await http().post('/api/returns').set(auth())
      .send({ type, warehouseId: whId, sourceReference: `RMA-${seq}`, lines: [{ productId, quantity: qty }] })
      .expect(201)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Ret ${u}`, adminEmail: `ret_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('receives returned stock into quarantine without making it available', async () => {
    const p = await newProduct('RET-RECV');
    await opening(p.id, 100); // on_hand 100, available 100
    const ret = await draftReturn(p.id, 10);
    expect(ret.status).toBe('DRAFT');

    const received = (await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201)).body;
    expect(received.status).toBe('RECEIVED');
    expect(received.receivedAt).toBeTruthy();
    expect(received.lines[0].receivedQuantity).toBe('10');
    expect(received.lines[0].remainingQuarantine).toBe('10');

    const bal = await balance(p.id);
    expect(bal.onHand).toBe('110'); // physically present
    expect(bal.quarantined).toBe('10'); // held pending inspection
    expect(bal.available).toBe('100'); // NOT sellable — availability unchanged
  });

  it('receipt is idempotent — re-receiving does not double-raise quarantine', async () => {
    const p = await newProduct('RET-IDEM');
    await opening(p.id, 50);
    const ret = await draftReturn(p.id, 8);
    await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201);
    // Replay the same receive — must be a no-op on the ledger.
    const again = (await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201)).body;
    expect(again.status).toBe('RECEIVED');

    const bal = await balance(p.id);
    expect(bal.quarantined).toBe('8'); // raised once, not 16
    expect(bal.onHand).toBe('58');
    expect(bal.available).toBe('50');
  });

  it('honours a per-line received-quantity override', async () => {
    const p = await newProduct('RET-PARTIAL');
    await opening(p.id, 40);
    const ret = await draftReturn(p.id, 10);
    const received = (await http().post(`/api/returns/${ret.id}/receive`).set(auth())
      .send({ lines: [{ lineId: ret.lines[0].id, receivedQuantity: 6 }] }).expect(201)).body;
    expect(received.lines[0].receivedQuantity).toBe('6');
    expect((await balance(p.id)).quarantined).toBe('6');
  });

  it('cancels a draft return and never touches the ledger', async () => {
    const p = await newProduct('RET-CANCEL');
    await opening(p.id, 30);
    const ret = await draftReturn(p.id, 5);
    const cancelled = (await http().post(`/api/returns/${ret.id}/cancel`).set(auth()).expect(201)).body;
    expect(cancelled.status).toBe('CANCELLED');
    const bal = await balance(p.id);
    expect(bal.quarantined).toBe('0');
    expect(bal.available).toBe('30');
  });

  it('cannot cancel a return once received', async () => {
    const p = await newProduct('RET-NOCANCEL');
    await opening(p.id, 30);
    const ret = await draftReturn(p.id, 5);
    await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201);
    await http().post(`/api/returns/${ret.id}/cancel`).set(auth()).expect(409); // cancel only before receipt
    expect((await getReturn(ret.id)).status).toBe('RECEIVED');
  });

  it('cannot receive a cancelled return', async () => {
    const p = await newProduct('RET-CANCELLED-RECV');
    await opening(p.id, 30);
    const ret = await draftReturn(p.id, 5);
    await http().post(`/api/returns/${ret.id}/cancel`).set(auth()).expect(201);
    await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(409);
  });

  it('rejects creating a return for an archived product', async () => {
    const p = await newProduct('RET-ARCHIVED');
    await archiveProduct(p.id);
    await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: whId, lines: [{ productId: p.id, quantity: 5 }] })
      .expect(400);
  });

  it('rejects a return for an inactive warehouse', async () => {
    const p = await newProduct('RET-INACTIVE-WH');
    const wh2 = (await http().post('/api/warehouses').set(auth()).send({ code: `WX${u}`, name: 'WX' }).expect(201)).body.id;
    await http().post(`/api/warehouses/${wh2}/status`).set(auth()).send({ status: 'INACTIVE' }).expect(201);
    await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: wh2, lines: [{ productId: p.id, quantity: 5 }] })
      .expect(400);
  });

  it('enforces org scope in list and detail', async () => {
    const p = await newProduct('RET-SCOPE');
    await opening(p.id, 20);
    const ret = await draftReturn(p.id, 4);

    const otherToken = (await http().post('/api/auth/register')
      .send({ organizationName: `Other ${u}`, adminEmail: `other2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    const otherList = (await http().get('/api/returns').set(auth(otherToken)).expect(200)).body;
    expect(otherList.find((r: { id: string }) => r.id === ret.id)).toBeUndefined();
    await http().get(`/api/returns/${ret.id}`).set(auth(otherToken)).expect(404);
  });

  it('filters by status and searches by return number and SKU', async () => {
    const p = await newProduct('RET-FILTER');
    await opening(p.id, 40);
    const ret = await draftReturn(p.id, 7);

    const byNo = (await http().get(`/api/returns?q=${ret.returnNo}`).set(auth()).expect(200)).body;
    expect(byNo.some((r: { id: string }) => r.id === ret.id)).toBe(true);
    const bySku = (await http().get(`/api/returns?q=${p.sku}`).set(auth()).expect(200)).body;
    expect(bySku.some((r: { id: string }) => r.id === ret.id)).toBe(true);
    const drafts = (await http().get('/api/returns?status=DRAFT').set(auth()).expect(200)).body;
    expect(drafts.every((r: { status: string }) => r.status === 'DRAFT')).toBe(true);
    expect(drafts.some((r: { id: string }) => r.id === ret.id)).toBe(true);
  });

  it('a historical return still resolves an archived product in the read model', async () => {
    // A received return holds quarantine stock (so its product cannot yet be archived — draining that is
    // 2B.2B disposition). Invariant 11 here is proved with a terminal, stockless return: the read-model
    // join must still resolve the archived product's identity.
    const p = await newProduct('RET-HIST');
    const ret = await draftReturn(p.id, 5); // DRAFT posts nothing to the ledger
    await http().post(`/api/returns/${ret.id}/cancel`).set(auth()).expect(201);
    await archiveProduct(p.id); // no inventory → archive allowed

    const r = await getReturn(ret.id);
    expect(r.status).toBe('CANCELLED');
    expect(r.lines[0].productSku).toBe(p.sku); // archived product still resolves in history
    expect(r.warehouseCode).toBeTruthy();
  });
});

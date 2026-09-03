import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.5A — FIFO Core (ADR 0013). Cost layers are valuation state over the same quantity ledger; a FIFO
 * outbound consumes the oldest layers deterministically, while the WAC path is untouched.
 */
describe('FIFO costing (e2e, 2D.5A)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let viewerToken: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async () => (await http().post('/api/products').set(auth()).send({ sku: sku('FIFO'), name: sku('FN'), baseUomId: unitId }).expect(201)).body.id as string;
  const setFifo = (productId?: string, expect = 201) =>
    http().post('/api/inventory/costing-policy').set(auth()).send({ strategy: 'FIFO', ...(productId ? { productId } : {}) }).expect(expect);
  const receive = async (productId: string, qty: number, unitCost: number) => {
    const draft = await http().post('/api/receiving').set(auth()).send({ warehouseId: whId, items: [{ productId, expectedQty: qty, receivedQty: qty, unitCost }] }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };
  const release = async (productId: string, qty: number, expectPost = 201) => {
    const rel = await http().post('/api/releases').set(auth()).send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.body.id}/post`).set(auth()).send({}).expect(expectPost);
    return rel.body.id as string;
  };
  const layers = async (productId: string) =>
    (await http().get(`/api/inventory/cost-layers?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const releaseMovement = async (productId: string) => {
    const mv = (await http().get(`/api/inventory/movements?productId=${productId}&type=SALES_RELEASE&limit=100`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    return mv[0];
  };
  const valuation = async (productId: string) =>
    (await http().get(`/api/inventory/cost-valuation?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register').send({ organizationName: `FIFO ${u}`, adminEmail: `fifo_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'FW', name: 'W' }).expect(201)).body.id;
    const vEmail = `fifov_${u}@x.test`;
    await http().post('/api/users').set(auth()).send({ email: vEmail, name: 'Viewer', roleKey: 'viewer', password: 'password123' }).expect(201);
    viewerToken = (await http().post('/api/auth/login').send({ email: vEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('a receipt opens one cost layer; multiple receipts open independent layers', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 20, 100);
    let l = await layers(p);
    expect(l).toHaveLength(1);
    expect(l[0]!).toMatchObject({ receivedQuantity: '20', remainingQuantity: '20', unitCost: '100', status: 'OPEN' });

    await receive(p, 30, 110);
    l = await layers(p);
    expect(l).toHaveLength(2);
    expect(l.map((x) => x.unitCost)).toEqual(['100', '110']); // ordered oldest-first
  });

  it('FIFO consumes the oldest layer first, spans layers, and reconciles remaining to on-hand', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 10, 100);
    await receive(p, 20, 110);
    await release(p, 15); // 10@100 + 5@110 = 1550

    const l = await layers(p);
    const byCost = Object.fromEntries(l.map((x) => [x.unitCost, x]));
    expect(byCost['100']!.remainingQuantity).toBe('0');
    expect(byCost['100']!.status).toBe('DEPLETED');
    expect(byCost['110']!.remainingQuantity).toBe('15');

    // Movement cost = Σ layer consumptions = 1550.
    const mv = (await releaseMovement(p))!;
    expect(mv.totalCost).toBe('1550');
    const cons = (await http().get(`/api/inventory/movements/${mv.id}/cost-layers`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    expect(cons).toHaveLength(2);
    expect(cons.reduce((s, c) => s + Number(c.extendedCost), 0)).toBe(1550);

    // Σ remaining = on-hand (30 − 15 = 15).
    const remaining = l.reduce((s, x) => s + Number(x.remainingQuantity), 0);
    expect(remaining).toBe(15);
  });

  it('FIFO valuation equals Σ remaining layer value', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 10, 100);
    await receive(p, 20, 110);
    await release(p, 15); // leaves 15 @ 110
    const val = (await valuation(p))[0]!;
    expect(val.strategy).toBe('FIFO');
    expect(val.fifoLayerQuantity).toBe('15');
    expect(val.fifoValue).toBe('1650'); // 15 × 110
    expect(val.onHand).toBe('15');
  });

  it('a replayed release does not duplicate cost consumption; over-release fails safely', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 10, 100);
    const relId = await release(p, 4);
    const before = await layers(p);
    // Replay the post — idempotent, no extra consumption.
    await http().post(`/api/releases/${relId}/post`).set(auth()).send({}).expect(201);
    const after = await layers(p);
    expect(after[0]!.remainingQuantity).toBe(before[0]!.remainingQuantity); // still 6
    const mv = (await releaseMovement(p))!;
    const cons = (await http().get(`/api/inventory/movements/${mv.id}/cost-layers`).set(auth()).expect(200)).body as unknown[];
    expect(cons).toHaveLength(1); // not duplicated

    // Releasing beyond on-hand fails safely (negative-stock guard) and leaves the layers untouched.
    await release(p, 100, 403);
    expect((await layers(p))[0]!.remainingQuantity).toBe('6');
  });

  it('leaves the WAC path unchanged for WAC products (no cost layers)', async () => {
    const p = await newProduct(); // default WAC — no FIFO policy
    await receive(p, 10, 100);
    await receive(p, 10, 120); // WAC blends to 110
    await release(p, 5);
    expect(await layers(p)).toHaveLength(0); // FIFO never touched
    const mv = (await releaseMovement(p))!;
    expect(mv.unitCost).toBe('110'); // WAC average, unchanged
  });

  it('blocks a strategy switch while stock exists, and gates cost figures by permission', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 5, 50);
    // Switching back to WAC with stock on hand is rejected (ADR 0013 §3).
    await http().post('/api/inventory/costing-policy').set(auth()).send({ strategy: 'WAC', productId: p }).expect(400);

    // Viewer (no cost.view / valuation.view) is blocked from cost figures.
    await http().get(`/api/inventory/cost-layers?productId=${p}`).set(auth(viewerToken)).expect(403);
    await http().get(`/api/inventory/cost-valuation?productId=${p}`).set(auth(viewerToken)).expect(403);
  });
});

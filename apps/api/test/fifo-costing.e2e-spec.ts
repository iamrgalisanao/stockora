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
  let westWhId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (opts: { isSerialized?: boolean } = {}) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku('FIFO'), name: sku('FN'), baseUomId: unitId, ...opts }).expect(201)).body.id as string;
  const setFifo = (productId?: string, expect = 201) =>
    http().post('/api/inventory/costing-policy').set(auth()).send({ strategy: 'FIFO', ...(productId ? { productId } : {}) }).expect(expect);
  const receive = async (productId: string, qty: number, unitCost: number, serialNumbers?: string[]) => {
    const draft = await http().post('/api/receiving').set(auth()).send({
      warehouseId: whId,
      items: [{ productId, expectedQty: qty, receivedQty: qty, unitCost, ...(serialNumbers ? { serialNumbers } : {}) }],
    }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };
  const release = async (productId: string, qty: number, expectPost = 201, serialNumbers?: string[]) => {
    const rel = await http().post('/api/releases').set(auth()).send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    const body = serialNumbers ? { serials: [{ itemId: rel.body.items[0].id, serialNumbers }] } : {};
    await http().post(`/api/releases/${rel.body.id}/post`).set(auth()).send(body).expect(expectPost);
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
  const movements = async (productId: string, type: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&type=${type}&limit=100`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const consumptions = async (movementId: string) =>
    (await http().get(`/api/inventory/movements/${movementId}/cost-layers`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const movementCostDetail = async (movementId: string) =>
    (await http().get(`/api/inventory/movements/${movementId}/cost-detail`).set(auth()).expect(200)).body as Record<string, any>;
  const postAdjustment = async (productId: string, direction: 'IN' | 'OUT', quantity: number, unitCost?: number) => {
    const adj = await http().post('/api/adjustments').set(auth()).send({
      warehouseId: whId,
      items: [{ productId, direction, quantity, ...(unitCost !== undefined ? { unitCost } : {}) }],
    }).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/post`).set(auth()).expect(201);
    return adj.body.id as string;
  };
  const postCount = async (productId: string, countedQty: number) => {
    const count = await http().post('/api/counts').set(auth()).send({ warehouseId: whId, productIds: [productId] }).expect(201);
    const itemId = count.body.items[0].id as string;
    await http().post(`/api/counts/${count.body.id}/entries`).set(auth()).send({ items: [{ itemId, countedQty }] }).expect(201);
    await http().post(`/api/counts/${count.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.body.id}/post`).set(auth()).expect(201);
    return count.body.id as string;
  };
  const transfer = async (productId: string, qty: number) => {
    const tr = await http().post('/api/transfers').set(auth()).send({
      sourceWarehouseId: whId,
      destWarehouseId: westWhId,
      items: [{ productId, quantity: qty }],
    }).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).expect(201); // replay: no double-consume
    await http().post(`/api/transfers/${tr.body.id}/receive`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/receive`).set(auth()).expect(201); // replay: no duplicate layers
    return tr.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register').send({ organizationName: `FIFO ${u}`, adminEmail: `fifo_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'FW', name: 'W' }).expect(201)).body.id;
    westWhId = (await http().post('/api/warehouses').set(auth()).send({ code: 'WEST', name: 'West' }).expect(201)).body.id;
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
    const trace = (await http().get(`/api/inventory/cost-layers/${l[0]!.id}/trace`).set(auth()).expect(200)).body;
    expect(trace.sourceDocument.type).toBe('goods_receipt');
    expect(trace.layer.remainingValue).toBe('2000');

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

  it('transfer preserves exact multi-layer FIFO basis and replays idempotently', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 10, 100);
    await receive(p, 10, 120);
    await release(p, 5); // leaves MAIN with 5 @ 100, 10 @ 120

    const transferId = await transfer(p, 8); // consumes 5 @ 100 + 3 @ 120 from MAIN

    const mainLayers = (await layers(p)).filter((l) => l.warehouseId === whId);
    const westLayers = (await layers(p)).filter((l) => l.warehouseId === westWhId);
    expect(mainLayers.map((l) => [l.unitCost, l.remainingQuantity])).toEqual([
      ['100', '0'],
      ['120', '7'],
    ]);
    expect(westLayers.map((l) => [l.unitCost, l.receivedQuantity, l.remainingQuantity])).toEqual([
      ['100', '5', '5'],
      ['120', '3', '3'],
    ]);

    const transferOut = (await http().get(`/api/inventory/movements?productId=${p}&type=TRANSFER_OUT&limit=100`).set(auth()).expect(200)).body
      .find((m: Record<string, string>) => m.referenceId === transferId);
    const cons = (await http().get(`/api/inventory/movements/${transferOut.id}/cost-layers`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    expect(cons.map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([
      ['5', '100', '500'],
      ['3', '120', '360'],
    ]);
    const transferTrace = (await http().get(`/api/inventory/transfers/${transferId}/cost-trace`).set(auth()).expect(200)).body;
    expect(transferTrace.lines[0].sourceConsumptions.map((c: Record<string, string>) => [c.quantity, c.unitCost])).toEqual([['5', '100'], ['3', '120']]);
    expect(transferTrace.lines[0].destinationLayers.map((l: Record<string, string>) => [l.receivedQuantity, l.unitCost])).toEqual([['5', '100'], ['3', '120']]);

    const val = await valuation(p);
    expect(val.reduce((s, r) => s + Number(r.fifoValue), 0)).toBe(1700); // MAIN 7@120 + WEST 5@100 + 3@120
  });

  it('serialized return restores original FIFO basis; quarantine/restock do not duplicate basis', async () => {
    const p = await newProduct({ isSerialized: true });
    await setFifo(p);
    await receive(p, 1, 100, ['SR-1']);
    await release(p, 1, 201, ['SR-1']);

    const ret = await http().post('/api/returns').set(auth()).send({
      type: 'CUSTOMER',
      warehouseId: whId,
      lines: [{ productId: p, quantity: 1, serialNumbers: ['SR-1'] }],
    }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/receive`).set(auth()).expect(201);

    let open = (await layers(p)).filter((l) => l.status === 'OPEN');
    expect(open.map((l) => [l.unitCost, l.receivedQuantity, l.remainingQuantity])).toEqual([['100', '1', '1']]);
    const returnTrace = (await http().get(`/api/inventory/returns/${ret.body.id}/cost-trace`).set(auth()).expect(200)).body;
    expect(returnTrace.lines[0].originalIssueMovements[0].serialNumber).toBe('SR-1');
    expect(returnTrace.lines[0].originalIssueMovements[0].movement.totalCost).toBe('100');
    expect(returnTrace.lines[0].restoredLayers.map((l: Record<string, string>) => [l.receivedQuantity, l.unitCost])).toEqual([['1', '100']]);

    const lineId = (await http().get(`/api/returns/${ret.body.id}`).set(auth()).expect(200)).body.lines[0].id as string;
    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({
      lineId,
      type: 'RESTOCK',
      quantity: 1,
      serialNumbers: ['SR-1'],
    }).expect(201);

    open = (await layers(p)).filter((l) => l.status === 'OPEN');
    expect(open.map((l) => [l.unitCost, l.receivedQuantity, l.remainingQuantity])).toEqual([['100', '1', '1']]);
  });

  it('positive adjustment without explicit valuation is rejected', async () => {
    const p = await newProduct();
    await setFifo(p);
    await http().post('/api/adjustments').set(auth()).send({
      warehouseId: whId,
      items: [{ productId: p, direction: 'IN', quantity: 1 }],
    }).expect(400);
  });

  it('negative adjustment consumes oldest FIFO layers and records exact COGS', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 10, 100);
    await receive(p, 10, 120);

    const adjId = await postAdjustment(p, 'OUT', 12);
    const adjOut = (await movements(p, 'STOCK_ADJUSTMENT_OUT')).find((m) => m.referenceId === adjId)!;
    expect(adjOut).toBeDefined();
    expect(adjOut.totalCost).toBe('1240');
    const detail = await movementCostDetail(adjOut!.id!);
    expect(detail.movement.totalCost).toBe('1240');
    expect(detail.consumptions.map((c: Record<string, string>) => [c.quantity, c.unitCost])).toEqual([['10', '100'], ['2', '120']]);
    expect((await consumptions(adjOut!.id!)).map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([
      ['10', '100', '1000'],
      ['2', '120', '240'],
    ]);
    expect((await layers(p)).map((l) => [l.unitCost, l.remainingQuantity, l.status])).toEqual([
      ['100', '0', 'DEPLETED'],
      ['120', '8', 'OPEN'],
    ]);
  });

  it('count loss consumes FIFO basis', async () => {
    const p = await newProduct();
    await setFifo(p);
    await receive(p, 10, 50);
    await receive(p, 10, 70);

    const countId = await postCount(p, 14);
    const loss = (await movements(p, 'STOCK_ADJUSTMENT_OUT')).find((m) => m.referenceId === countId)!;
    expect(loss).toBeDefined();
    expect(loss.totalCost).toBe('300');
    expect((await consumptions(loss!.id!)).map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([
      ['6', '50', '300'],
    ]);
    expect((await layers(p)).map((l) => [l.unitCost, l.remainingQuantity])).toEqual([
      ['50', '4'],
      ['70', '10'],
    ]);
    const cogs = (await http().get(`/api/inventory/fifo-cogs?productId=${p}`).set(auth()).expect(200)).body;
    expect(Number(cogs.totalCogs)).toBe(300);
    expect(cogs.rows.some((r: Record<string, string>) => r.movementId === loss!.id)).toBe(true);
  });

  it('damage and disposal consume restored FIFO value once without replacement layers', async () => {
    const p = await newProduct({ isSerialized: true });
    await setFifo(p);
    await receive(p, 2, 80, ['DD-1', 'DD-2']);
    await release(p, 2, 201, ['DD-1', 'DD-2']);
    const ret = await http().post('/api/returns').set(auth()).send({
      type: 'CUSTOMER',
      warehouseId: whId,
      lines: [{ productId: p, quantity: 2, serialNumbers: ['DD-1', 'DD-2'] }],
    }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/receive`).set(auth()).expect(201);
    const lineId = (await http().get(`/api/returns/${ret.body.id}`).set(auth()).expect(200)).body.lines[0].id as string;

    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({
      lineId, type: 'DAMAGED', quantity: 1, serialNumbers: ['DD-1'],
    }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({
      lineId, type: 'DISPOSE', quantity: 1, serialNumbers: ['DD-2'],
    }).expect(201);

    const damage = (await movements(p, 'DAMAGE')).find((m) => m.referenceId === ret.body.id)!;
    const dispose = (await movements(p, 'RETURN_DISPOSE')).find((m) => m.referenceId === ret.body.id)!;
    expect(damage).toBeDefined();
    expect(dispose).toBeDefined();
    expect(damage.totalCost).toBe('80');
    expect(dispose.totalCost).toBe('80');
    expect((await consumptions(damage!.id!)).map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([['1', '80', '80']]);
    expect((await consumptions(dispose!.id!)).map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([['1', '80', '80']]);
    expect((await layers(p)).filter((l) => l.status === 'OPEN')).toHaveLength(0);
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
    await http().get('/api/inventory/fifo-cogs').set(auth(viewerToken)).expect(403);
  });
});

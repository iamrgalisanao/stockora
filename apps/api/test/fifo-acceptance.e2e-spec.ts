import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.5 — FIFO cross-module acceptance (ADR 0013).
 *
 * A single scenario-style test that proves FIFO cost-basis CONTINUITY across every workflow that touches
 * value, in sequence, over two warehouses — the property unit tests cannot fully establish. Value is never
 * invented, silently discarded, or double-consumed as stock flows through receipt → release → transfer →
 * return → restock → damage → count loss.
 *
 * The product is serialized so returns auto-trace their original issued basis (ADR 0013 §7) and the serial
 * registry reconciles alongside the cost ledger. Cost basis (which layer) and serial identity (which unit)
 * are deliberately decoupled: FIFO always consumes the oldest layer regardless of which serial physically
 * moves (ADR 0013 §6).
 *
 * Scenario (MAIN = FW, WEST):
 *   1. Receive MAIN 10 @100   → layer L1 100×10
 *   2. Receive MAIN 10 @120   → layer L2 120×10
 *   3. Release 5              → consumes 5@100 (L1)                     COGS 500
 *   4. Transfer 8 MAIN→WEST   → consumes 5@100 (L1) + 3@120 (L2)       basis 860, recreated at WEST
 *   5. Return 2 (from step 3) → restores 2@100 into a MAIN quarantine layer (RL)
 *   6. Restock 2             → quarantine → on-hand, NO new layer/consumption
 *   7. Damage 1              → consumes oldest OPEN layer = 1@120 (L2)  value 120
 *   8. Count loss 1          → consumes oldest OPEN layer = 1@120 (L2)  value 120
 *
 * End state — MAIN: L1 100×10 DEPLETED, L2 120 rem 5 (=600), RL 100 rem 2 (=200) → 800, on-hand 7.
 *             WEST: 100×5 + 120×3 → 860, on-hand 8.  Total FIFO valuation 1660.
 */
describe('FIFO cross-module acceptance (e2e, 2D.5)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string; // MAIN (FW)
  let westWhId: string; // WEST

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const sn = (n: number) => `ACC-${String(n).padStart(2, '0')}`;
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => sn(from + i));

  const newSerializedFifoProduct = async () => {
    const p = (await http().post('/api/products').set(auth())
      .send({ sku: sku('ACCEPT'), name: sku('Acceptance'), baseUomId: unitId, isSerialized: true }).expect(201)).body.id as string;
    await http().post('/api/inventory/costing-policy').set(auth()).send({ strategy: 'FIFO', productId: p }).expect(201);
    return p;
  };

  const receive = async (productId: string, qty: number, unitCost: number, serialNumbers: string[]) => {
    const draft = await http().post('/api/receiving').set(auth()).send({
      warehouseId: whId,
      items: [{ productId, expectedQty: qty, receivedQty: qty, unitCost, serialNumbers }],
    }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };

  const release = async (productId: string, qty: number, serialNumbers: string[]) => {
    const rel = await http().post('/api/releases').set(auth())
      .send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.body.id}/post`).set(auth())
      .send({ serials: [{ itemId: rel.body.items[0].id, serialNumbers }] }).expect(201);
    return rel.body.id as string;
  };

  const transfer = async (productId: string, serialNumbers: string[]) => {
    const tr = await http().post('/api/transfers').set(auth()).send({
      sourceWarehouseId: whId, destWarehouseId: westWhId,
      items: [{ productId, quantity: serialNumbers.length }],
    }).expect(201);
    const itemId = tr.body.items[0].id as string;
    await http().post(`/api/transfers/${tr.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).send({ serials: [{ itemId, serialNumbers }] }).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).send({ serials: [{ itemId, serialNumbers }] }).expect(201); // replay: no double-consume
    await http().post(`/api/transfers/${tr.body.id}/receive`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/receive`).set(auth()).expect(201); // replay: no duplicate layers
    return tr.body.id as string;
  };

  const returnAndRestock = async (productId: string, serialNumbers: string[]) => {
    const ret = await http().post('/api/returns').set(auth()).send({
      type: 'CUSTOMER', warehouseId: whId,
      lines: [{ productId, quantity: serialNumbers.length, serialNumbers }],
    }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/receive`).set(auth()).expect(201);
    const lineId = (await http().get(`/api/returns/${ret.body.id}`).set(auth()).expect(200)).body.lines[0].id as string;
    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth())
      .send({ lineId, type: 'RESTOCK', quantity: serialNumbers.length, serialNumbers }).expect(201);
    return ret.body.id as string;
  };

  const damage = async (productId: string, serialNumbers: string[]) => {
    const adj = await http().post('/api/adjustments').set(auth()).send({
      warehouseId: whId,
      items: [{ productId, direction: 'OUT', quantity: serialNumbers.length, serialNumbers, serialDisposition: 'DAMAGED' }],
    }).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/post`).set(auth()).expect(201);
    return adj.body.id as string;
  };

  const countLoss = async (productId: string, observedSerials: string[]) => {
    const count = await http().post('/api/counts').set(auth()).send({ warehouseId: whId, productIds: [productId] }).expect(201);
    const itemId = count.body.items[0].id as string;
    await http().post(`/api/counts/${count.body.id}/entries`).set(auth()).send({ items: [{ itemId, observedSerials }] }).expect(201);
    await http().post(`/api/counts/${count.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.body.id}/post`).set(auth()).expect(201);
    return count.body.id as string;
  };

  // ---- read helpers ----
  const layers = async (productId: string) =>
    (await http().get(`/api/inventory/cost-layers?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const valuation = async (productId: string) =>
    (await http().get(`/api/inventory/cost-valuation?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const movements = async (productId: string, type: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&type=${type}&limit=100`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const consumptions = async (movementId: string) =>
    (await http().get(`/api/inventory/movements/${movementId}/cost-layers`).set(auth()).expect(200)).body as Array<Record<string, string>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register').send({ organizationName: `FIFOACC ${u}`, adminEmail: `fifoacc_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'FW', name: 'Main' }).expect(201)).body.id;
    westWhId = (await http().post('/api/warehouses').set(auth()).send({ code: 'WEST', name: 'West' }).expect(201)).body.id;
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('preserves FIFO cost-basis continuity across receipt, release, transfer, return/restock, damage and count loss', async () => {
    const p = await newSerializedFifoProduct();

    // 1–2. Two receipts open two independent layers.
    await receive(p, 10, 100, range(1, 10));
    await receive(p, 10, 120, range(11, 20));

    // 3. Release 5 — FIFO consumes the oldest layer (5@100).
    const relId = await release(p, 5, range(1, 5));

    // 4. Transfer 8 MAIN→WEST — consumes 5@100 (rest of L1) + 3@120 (L2); recreated exactly at WEST.
    const transferId = await transfer(p, range(6, 13));

    // 5–6. Return 2 of the released units and restock them — restores 2@100, no duplicate basis on restock.
    const returnId = await returnAndRestock(p, range(1, 2));

    // 7. Damage 1 in-stock unit — consumes the oldest OPEN layer (1@120).
    await damage(p, [sn(14)]);

    // 8. Count loss 1 — MAIN holds 8 IN_STOCK serials; observe 7 (omit ACC-15) → 1 loss consumes 1@120.
    const mainInStock = [sn(1), sn(2), ...range(15, 20)]; // ACC-14 already damaged out
    const countId = await countLoss(p, [sn(1), sn(2), ...range(16, 20)]); // omit ACC-15
    expect(mainInStock).toHaveLength(8);

    // ---- assert final layer state ----
    const all = await layers(p);
    const main = all.filter((l) => l.warehouseId === whId);
    const west = all.filter((l) => l.warehouseId === westWhId);

    // MAIN: L1 depleted, L2 5 remaining, plus two restored return layers (1@100 each — a serialized return
    // restores each returned serial's own issued basis as its own layer). (ordered oldest-first)
    expect(main.map((l) => [l.unitCost, l.receivedQuantity, l.remainingQuantity, l.status])).toEqual([
      ['100', '10', '0', 'DEPLETED'],
      ['120', '10', '5', 'OPEN'],
      ['100', '1', '1', 'OPEN'],
      ['100', '1', '1', 'OPEN'],
    ]);
    // WEST: exactly the two transferred layers, no duplicates from the receive replay.
    expect(west.map((l) => [l.unitCost, l.receivedQuantity, l.remainingQuantity, l.status])).toEqual([
      ['100', '5', '5', 'OPEN'],
      ['120', '3', '3', 'OPEN'],
    ]);

    // ---- valuation = Σ remaining layer value, per warehouse and overall ----
    const val = await valuation(p);
    const mainVal = val.find((r) => r.warehouseId === whId)!;
    const westVal = val.find((r) => r.warehouseId === westWhId)!;
    expect([mainVal.onHand, mainVal.fifoLayerQuantity, mainVal.fifoValue]).toEqual(['7', '7', '800']); // 5×120 + 2×100
    expect([westVal.onHand, westVal.fifoLayerQuantity, westVal.fifoValue]).toEqual(['8', '8', '860']); // 5×100 + 3×120
    expect(val.reduce((s, r) => s + Number(r.fifoValue), 0)).toBe(1660);
    // FIFO layer reconciliation: Σ remaining layer value == reported fifoValue, and layer qty == on-hand.
    const mainLayerValue = main.reduce((s, l) => s + Number(l.remainingQuantity) * Number(l.unitCost), 0);
    const westLayerValue = west.reduce((s, l) => s + Number(l.remainingQuantity) * Number(l.unitCost), 0);
    expect(mainLayerValue).toBe(Number(mainVal.fifoValue));
    expect(westLayerValue).toBe(Number(westVal.fifoValue));

    // ---- every outbound movement's consumptions are exact ----
    const releaseMv = (await movements(p, 'SALES_RELEASE')).find((m) => m.referenceId === relId)!;
    expect(releaseMv.totalCost).toBe('500');
    expect((await consumptions(releaseMv.id!)).map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([['5', '100', '500']]);

    const transferOut = (await movements(p, 'TRANSFER_OUT')).find((m) => m.referenceId === transferId)!;
    expect(transferOut.totalCost).toBe('860');
    const transferCons = (await consumptions(transferOut.id!)).map((c) => [c.quantity, c.unitCost, c.extendedCost]);
    expect(transferCons).toEqual([['5', '100', '500'], ['3', '120', '360']]);

    const damageMv = (await movements(p, 'DAMAGE')).find((m) => m.referenceId)!;
    expect(damageMv.totalCost).toBe('120');
    const damageCons = await consumptions(damageMv.id!);
    expect(damageCons.map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([['1', '120', '120']]); // consumed once
    expect(damageCons).toHaveLength(1);

    const countLossMv = (await movements(p, 'STOCK_ADJUSTMENT_OUT')).find((m) => m.referenceId === countId)!;
    expect(countLossMv.totalCost).toBe('120');
    const countCons = await consumptions(countLossMv.id!);
    expect(countCons.map((c) => [c.quantity, c.unitCost, c.extendedCost])).toEqual([['1', '120', '120']]); // consumed once
    expect(countCons).toHaveLength(1);

    // ---- transfer: Σ dispatched basis == Σ destination layers created ----
    const transferTrace = (await http().get(`/api/inventory/transfers/${transferId}/cost-trace`).set(auth()).expect(200)).body;
    const dispatched = transferTrace.lines[0].sourceConsumptions.reduce((s: number, c: Record<string, string>) => s + Number(c.quantity) * Number(c.unitCost), 0);
    const destCreated = transferTrace.lines[0].destinationLayers.reduce((s: number, l: Record<string, string>) => s + Number(l.receivedQuantity) * Number(l.unitCost), 0);
    expect(dispatched).toBe(860);
    expect(destCreated).toBe(860);

    // ---- return: restored basis == original issued basis (both 100/unit, from the release consumption) ----
    const returnTrace = (await http().get(`/api/inventory/returns/${returnId}/cost-trace`).set(auth()).expect(200)).body;
    const restored = returnTrace.lines[0].restoredLayers.map((l: Record<string, string>) => [l.receivedQuantity, l.unitCost]);
    expect(restored).toEqual([['1', '100'], ['1', '100']]); // per-serial restoration, both at the issued 100
    const restoredValue = returnTrace.lines[0].restoredLayers.reduce((s: number, l: Record<string, string>) => s + Number(l.receivedQuantity) * Number(l.unitCost), 0);
    expect(restoredValue).toBe(200); // 2 units × the 100 they were issued at

    // ---- no duplicate replacement layers anywhere ----
    expect(main).toHaveLength(4); // L1 + L2 + two per-serial restored layers, nothing extra from restock/replays
    expect(west).toHaveLength(2); // exactly the two transferred layers

    // ---- broad accounting invariants ----
    const invReconcile = (await http().post('/api/inventory/reconcile').set(auth()).expect(201)).body;
    expect(invReconcile.ok).toBe(true);
    expect(invReconcile.drift).toHaveLength(0);

    const serialReconcile = (await http().get(`/api/serials/reconcile?productId=${p}`).set(auth()).expect(200)).body;
    expect(serialReconcile.ok).toBe(true);
    expect(serialReconcile.drift).toHaveLength(0);
  }, 60000);
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.3B — Serial Propagation (ADR 0012 §9). One immutable serial identity moves through release, transfer,
 * return, disposition, adjustment, and count — each transition riding its ledger movement — with the
 * registry always reconciling to the balance buckets.
 */
describe('Serial propagation (e2e, 2D.3B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let wh1: string;
  let wh2: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string, opts: { serialized?: boolean; batch?: boolean; issueMode?: boolean } = {}) => {
    const s = sku(prefix);
    const id = (
      await http().post('/api/products').set(auth())
        .send({ sku: s, name: s, baseUomId: unitId, isSerialized: opts.serialized ?? false, isBatchTracked: opts.batch ?? false })
        .expect(201)
    ).body.id;
    if (opts.issueMode) {
      await http().put(`/api/serials/policies/${id}`).set(auth()).send({ captureMode: 'ISSUE' }).expect(200);
    }
    return { id, sku: s };
  };

  const receive = async (productId: string, warehouseId: string, items: Record<string, unknown>[]) => {
    const draft = await http().post('/api/receiving').set(auth()).send({ warehouseId, items }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    return draft.body.id as string;
  };

  const serials = async (productId: string) =>
    (await http().get(`/api/serials?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;
  const serial = async (productId: string, sn: string) => (await serials(productId)).find((r) => r.serialNumber === sn);
  const reconcile = async (productId: string) =>
    (await http().get(`/api/serials/reconcile?productId=${productId}`).set(auth()).expect(200)).body as { ok: boolean; drift: unknown[]; serialsChecked: number };
  const onHandAt = async (productId: string, warehouseId: string) => {
    const b = (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    return b.filter((x) => x.warehouseId === warehouseId).reduce((s, x) => s + Number(x.onHand), 0);
  };

  // Create → submit → approve → post a release with per-line serials.
  const releaseSerials = async (
    warehouseId: string,
    productId: string,
    qty: number,
    serialNumbers: string[],
    expectPost = 201,
    allocations?: Array<{ lotId: string; quantity: number }>,
  ) => {
    const rel = await http().post('/api/releases').set(auth())
      .send({ warehouseId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty, ...(allocations ? { allocations } : {}) }] })
      .expect(201);
    const itemId = rel.body.items[0].id as string;
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.body.id}/post`).set(auth()).send({ serials: [{ itemId, serialNumbers }] }).expect(expectPost);
    return rel.body.id as string;
  };

  const lotsOf = async (productId: string) =>
    (await http().get(`/api/lots?productId=${productId}`).set(auth()).expect(200)).body as Array<{ id: string; lotNumber: string }>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Prop ${u}`, adminEmail: `prop_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    wh1 = (await http().post('/api/warehouses').set(auth()).send({ code: 'PW1', name: 'W1' }).expect(201)).body.id;
    wh2 = (await http().post('/api/warehouses').set(auth()).send({ code: 'PW2', name: 'W2' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  // ---- Release ----

  it('release (RECEIPT mode) requires existing IN_STOCK serials and issues them', async () => {
    const p = await newProduct('REL', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 10, serialNumbers: ['R-1', 'R-2'] }]);

    // Unknown serial → rejected before stock changes.
    await releaseSerials(wh1, p.id, 1, ['NOPE'], 400);
    expect(await onHandAt(p.id, wh1)).toBe(2);

    // Existing IN_STOCK serial → issued.
    await releaseSerials(wh1, p.id, 1, ['R-1']);
    expect((await serial(p.id, 'R-1'))!.status).toBe('ISSUED');
    expect(await onHandAt(p.id, wh1)).toBe(1);
    expect((await reconcile(p.id)).ok).toBe(true);
  });

  it('release cannot issue the same serial twice', async () => {
    const p = await newProduct('REL2', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 10, serialNumbers: ['ONCE'] }]);
    await releaseSerials(wh1, p.id, 1, ['ONCE']);
    // Second release of the now-ISSUED serial is rejected.
    await releaseSerials(wh1, p.id, 1, ['ONCE'], 400);
    expect((await serial(p.id, 'ONCE'))!.status).toBe('ISSUED');
  });

  it('capture-at-issue (ISSUE mode) creates exactly release-qty serials', async () => {
    const p = await newProduct('ISS', { serialized: true, issueMode: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 3, receivedQty: 3, unitCost: 5 }]); // no serials at receipt
    expect(await serials(p.id)).toHaveLength(0);

    await releaseSerials(wh1, p.id, 2, ['I-1', 'I-2']);
    const rows = await serials(p.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'ISSUED')).toBe(true);
    expect(await onHandAt(p.id, wh1)).toBe(1);
  });

  it('capture-at-issue duplicate serial rolls back the release', async () => {
    const p = await newProduct('ISSD', { serialized: true, issueMode: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 5 }]);
    await releaseSerials(wh1, p.id, 2, ['D-1', 'D-1'], 400); // duplicate within the set
    expect(await serials(p.id)).toHaveLength(0);
    expect(await onHandAt(p.id, wh1)).toBe(2); // untouched
  });

  it('batch+serial release enforces lot match', async () => {
    const p = await newProduct('BS', { serialized: true, batch: true });
    await receive(p.id, wh1, [
      { productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 10, batchNumber: 'LOT-1', serialNumbers: ['BS-1', 'BS-2'] },
      { productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 10, batchNumber: 'LOT-2', serialNumbers: ['BS-3'] },
    ]);
    const lots = await lotsOf(p.id);
    const lot1 = lots.find((l) => l.lotNumber === 'LOT-1')!.id;
    const lot2 = lots.find((l) => l.lotNumber === 'LOT-2')!.id;

    // A serial whose lot differs from the allocation is rejected.
    await releaseSerials(wh1, p.id, 1, ['BS-3'], 400, [{ lotId: lot1, quantity: 1 }]);
    // Matching serial+lot succeeds.
    await releaseSerials(wh1, p.id, 1, ['BS-1'], 201, [{ lotId: lot1, quantity: 1 }]);
    expect((await serial(p.id, 'BS-1'))!.status).toBe('ISSUED');
    expect((await reconcile(p.id)).ok).toBe(true);
    expect(lot2).toBeTruthy();
  });

  // ---- Transfer ----

  it('transfer dispatch moves exact serials to IN_TRANSIT and receive restores them at the destination', async () => {
    const p = await newProduct('TR', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 10, serialNumbers: ['T-1', 'T-2'] }]);

    const tr = await http().post('/api/transfers').set(auth())
      .send({ sourceWarehouseId: wh1, destWarehouseId: wh2, items: [{ productId: p.id, quantity: 1 }] })
      .expect(201);
    const itemId = tr.body.items[0].id as string;
    await http().post(`/api/transfers/${tr.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/approve`).set(auth()).expect(201);

    // Cannot dispatch a serial that is not IN_STOCK at the source.
    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).send({ serials: [{ itemId, serialNumbers: ['UNKNOWN'] }] }).expect(400);

    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).send({ serials: [{ itemId, serialNumbers: ['T-1'] }] }).expect(201);
    expect((await serial(p.id, 'T-1'))!.status).toBe('IN_TRANSIT');

    await http().post(`/api/transfers/${tr.body.id}/receive`).set(auth()).expect(201);
    const t1 = (await serial(p.id, 'T-1'))!;
    expect(t1.status).toBe('IN_STOCK');
    expect(t1.currentWarehouseId).toBe(wh2); // same serial arrived at the destination — no substitution
    expect(await onHandAt(p.id, wh2)).toBe(1);
    expect((await reconcile(p.id)).ok).toBe(true);
  });

  // ---- Return + disposition ----

  it('return accepts a previously ISSUED serial into QUARANTINE and rejects unknown/in-stock serials', async () => {
    const p = await newProduct('RTN', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 10, serialNumbers: ['Q-1', 'Q-2'] }]);
    await releaseSerials(wh1, p.id, 1, ['Q-1']); // Q-1 now ISSUED

    // Unknown serial → rejected at create.
    await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: wh1, lines: [{ productId: p.id, quantity: 1, serialNumbers: ['GHOST'] }] })
      .expect(400);
    // In-stock (never issued) serial → rejected.
    await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: wh1, lines: [{ productId: p.id, quantity: 1, serialNumbers: ['Q-2'] }] })
      .expect(400);

    // Previously ISSUED serial → accepted, then received into quarantine.
    const ret = await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: wh1, lines: [{ productId: p.id, quantity: 1, serialNumbers: ['Q-1'] }] })
      .expect(201);
    await http().post(`/api/returns/${ret.body.id}/receive`).set(auth()).expect(201);
    expect((await serial(p.id, 'Q-1'))!.status).toBe('QUARANTINED');
    expect((await reconcile(p.id)).ok).toBe(true);
  });

  it('disposition routes serials to IN_STOCK (restock), DAMAGED, or DISPOSED and reconciles', async () => {
    const p = await newProduct('DISP', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 3, receivedQty: 3, unitCost: 10, serialNumbers: ['D1', 'D2', 'D3'] }]);
    await releaseSerials(wh1, p.id, 3, ['D1', 'D2', 'D3']);
    const ret = await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: wh1, lines: [{ productId: p.id, quantity: 3, serialNumbers: ['D1', 'D2', 'D3'] }] })
      .expect(201);
    await http().post(`/api/returns/${ret.body.id}/receive`).set(auth()).expect(201);
    const lineId = (await http().get(`/api/returns/${ret.body.id}`).set(auth()).expect(200)).body.lines[0].id as string;

    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({ lineId, type: 'RESTOCK', quantity: 1, serialNumbers: ['D1'] }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({ lineId, type: 'DAMAGED', quantity: 1, serialNumbers: ['D2'] }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({ lineId, type: 'DISPOSE', quantity: 1, serialNumbers: ['D3'] }).expect(201);

    expect((await serial(p.id, 'D1'))!.status).toBe('IN_STOCK');
    expect((await serial(p.id, 'D2'))!.status).toBe('DAMAGED');
    expect((await serial(p.id, 'D3'))!.status).toBe('DISPOSED');
    expect((await reconcile(p.id)).ok).toBe(true);
  });

  // ---- Adjustments ----

  it('serialized adjustment: OUT removes explicit serials, IN registers new ones', async () => {
    const p = await newProduct('ADJ', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 10, serialNumbers: ['A1', 'A2'] }]);

    const post = async (items: Record<string, unknown>[], expectStatus = 201) => {
      const adj = await http().post('/api/adjustments').set(auth()).send({ warehouseId: wh1, items }).expect(201);
      await http().post(`/api/adjustments/${adj.body.id}/submit`).set(auth()).expect(201);
      await http().post(`/api/adjustments/${adj.body.id}/approve`).set(auth()).expect(201);
      await http().post(`/api/adjustments/${adj.body.id}/post`).set(auth()).expect(expectStatus);
      return adj.body.id as string;
    };

    // A serialized OUT with no serials is rejected (no anonymous −N).
    await post([{ productId: p.id, direction: 'OUT', quantity: 1 }], 400);

    // OUT one serial as DAMAGED, register one new serial IN.
    await post([
      { productId: p.id, direction: 'OUT', quantity: 1, serialNumbers: ['A1'], serialDisposition: 'DAMAGED' },
      { productId: p.id, direction: 'IN', quantity: 1, unitCost: 10, serialNumbers: ['A3'] },
    ]);
    expect((await serial(p.id, 'A1'))!.status).toBe('DAMAGED');
    expect((await serial(p.id, 'A3'))!.status).toBe('IN_STOCK');
    expect((await reconcile(p.id)).ok).toBe(true);
  });

  // ---- Counts ----

  it('physical count reconciles observed vs expected serial sets', async () => {
    const p = await newProduct('CNT', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 3, receivedQty: 3, unitCost: 10, serialNumbers: ['C1', 'C2', 'C3'] }]);

    const cnt = await http().post('/api/counts').set(auth()).send({ warehouseId: wh1, productIds: [p.id] }).expect(201);
    const itemId = cnt.body.items[0].id as string;
    // Observed set: C1, C2 present; C3 missing; C4 found.
    await http().post(`/api/counts/${cnt.body.id}/entries`).set(auth()).send({ items: [{ itemId, observedSerials: ['C1', 'C2', 'C4'] }] }).expect(201);
    await http().post(`/api/counts/${cnt.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${cnt.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/counts/${cnt.body.id}/post`).set(auth()).expect(201);

    expect((await serial(p.id, 'C3'))!.status).toBe('DISPOSED'); // counted as lost
    expect((await serial(p.id, 'C4'))!.status).toBe('IN_STOCK'); // counted as found
    expect(await onHandAt(p.id, wh1)).toBe(3); // 3 − 1 lost + 1 found
    expect((await reconcile(p.id)).ok).toBe(true);
  });

  // ---- Non-serialized regression + cross-org + history ----

  it('non-serialized workflows are unchanged', async () => {
    const p = await newProduct('PLAIN', {});
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 5, receivedQty: 5, unitCost: 4 }]);
    await releaseSerials(wh1, p.id, 2, []); // no serials for a non-serialized product
    expect(await onHandAt(p.id, wh1)).toBe(3);
    expect(await serials(p.id)).toHaveLength(0);
  });

  it('a serial stays readable after issue/disposal and is org-scoped', async () => {
    const p = await newProduct('HIST', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 10, serialNumbers: ['H-1'] }]);
    await releaseSerials(wh1, p.id, 1, ['H-1']);
    const id = (await serial(p.id, 'H-1'))!.id!;
    const row = (await http().get(`/api/serials/${id}`).set(auth()).expect(200)).body;
    expect(row.status).toBe('ISSUED');

    const token2 = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Prop2 ${u}`, adminEmail: `prop2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    await http().get(`/api/serials/${id}`).set(auth(token2)).expect(404);
  });

  // ---- Integration scenario (ADR 0012 §9) ----

  it('integration: one identity through receive → release → transfer → return → restock → damage', async () => {
    const p = await newProduct('SCN', { serialized: true });
    await receive(p.id, wh1, [{ productId: p.id, expectedQty: 3, receivedQty: 3, unitCost: 100, serialNumbers: ['SN-001', 'SN-002', 'SN-003'] }]);

    // Release SN-001.
    await releaseSerials(wh1, p.id, 1, ['SN-001']);

    // Transfer SN-002 to wh2 and receive it.
    const tr = await http().post('/api/transfers').set(auth())
      .send({ sourceWarehouseId: wh1, destWarehouseId: wh2, items: [{ productId: p.id, quantity: 1 }] }).expect(201);
    const trItem = tr.body.items[0].id as string;
    await http().post(`/api/transfers/${tr.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/dispatch`).set(auth()).send({ serials: [{ itemId: trItem, serialNumbers: ['SN-002'] }] }).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/receive`).set(auth()).expect(201);

    // Return SN-001 then restock it.
    const ret = await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: wh1, lines: [{ productId: p.id, quantity: 1, serialNumbers: ['SN-001'] }] }).expect(201);
    await http().post(`/api/returns/${ret.body.id}/receive`).set(auth()).expect(201);
    const retLine = (await http().get(`/api/returns/${ret.body.id}`).set(auth()).expect(200)).body.lines[0].id as string;
    await http().post(`/api/returns/${ret.body.id}/dispositions`).set(auth()).send({ lineId: retLine, type: 'RESTOCK', quantity: 1, serialNumbers: ['SN-001'] }).expect(201);

    // Damage SN-003 (in-stock → damaged) via a serialized adjustment.
    const adj = await http().post('/api/adjustments').set(auth())
      .send({ warehouseId: wh1, items: [{ productId: p.id, direction: 'OUT', quantity: 1, serialNumbers: ['SN-003'], serialDisposition: 'DAMAGED' }] }).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/adjustments/${adj.body.id}/post`).set(auth()).expect(201);

    // Every serial has exactly one current state/location, none duplicated or lost.
    const rows = await serials(p.id);
    expect(rows).toHaveLength(3);
    const byNum = new Map(rows.map((r) => [r.serialNumber, r]));
    expect(byNum.get('SN-001')).toMatchObject({ status: 'IN_STOCK', currentWarehouseId: wh1 });
    expect(byNum.get('SN-002')).toMatchObject({ status: 'IN_STOCK', currentWarehouseId: wh2 });
    expect(byNum.get('SN-003')).toMatchObject({ status: 'DAMAGED', currentWarehouseId: wh1 });
    expect(rows.every((r) => !!r.lastMovementId)).toBe(true); // movement history preserved per identity

    // Balances reconcile to the mapped serial states across both warehouses.
    const rec = await reconcile(p.id);
    expect(rec.ok).toBe(true);
    expect(rec.drift).toHaveLength(0);
  });
});

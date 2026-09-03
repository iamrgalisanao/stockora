import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2C.1B — Lot Propagation (ADR 0007). Lot identity threads through releases (allocations), transfers,
 * adjustments, counts, and returns. Every test reconciles per-lot balances to the ledger; non-batch
 * paths are covered by the pre-existing suites.
 */
describe('Lot propagation (e2e, 2C.1B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whA: string;
  let whB: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string, batch = true) => {
    const s = sku(prefix);
    return (await http().post('/api/products').set(auth()).send({ sku: s, name: s, baseUomId: unitId, isBatchTracked: batch }).expect(201)).body.id as string;
  };
  // Seed a lot's stock into a warehouse via opening inventory; return the lotId.
  const seedLot = async (productId: string, wh: string, qty: number, lotNumber: string) => {
    await http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: wh, lines: [{ productId, quantity: qty, unitCost: 10, lotNumber }] }).expect(201);
    const lots = (await http().get(`/api/lots?productId=${productId}`).set(auth()).expect(200)).body;
    return lots.find((l: { lotNumber: string }) => l.lotNumber === lotNumber).id as string;
  };
  const balances = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;
  const balAt = async (productId: string, wh: string, lotId: string | null) =>
    (await balances(productId)).find((b) => b.warehouseId === wh && b.lotId === lotId);
  const movements = async (productId: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&limit=1000`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;

  // Per-lot ledger reconciliation across a warehouse-agnostic view: for each (warehouse,lot) balance row,
  // its physical buckets equal the running sum of that lot's movement deltas in that warehouse.
  const reconcile = async (productId: string) => {
    const ms = await movements(productId);
    const bs = await balances(productId);
    for (const b of bs) {
      const rows = ms.filter((m) => (m.lotId ?? null) === b.lotId && m.warehouseId === b.warehouseId);
      const sum = (k: string) => rows.reduce((a, m) => a + Number(m[k]), 0);
      expect(Number(b.onHand)).toBeCloseTo(sum('onHandDelta'), 4);
      expect(Number(b.quarantined)).toBeCloseTo(sum('quarantinedDelta'), 4);
      expect(Number(b.damaged)).toBeCloseTo(sum('damagedDelta'), 4);
      expect(Number(b.inTransit)).toBeCloseTo(sum('inTransitDelta'), 4);
    }
  };

  // Release helpers.
  const release = async (wh: string, items: unknown[]) =>
    (await http().post('/api/releases').set(auth()).send({ warehouseId: wh, destinationType: 'INTERNAL_CONSUMPTION', items }).expect(201)).body;
  const drive = async (id: string) => {
    await http().post(`/api/releases/${id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${id}/approve`).set(auth()).send({}).expect(201);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Prop ${u}`, adminEmail: `prop_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whA = (await http().post('/api/warehouses').set(auth()).send({ code: `WA${u}`, name: 'A' }).expect(201)).body.id;
    whB = (await http().post('/api/warehouses').set(auth()).send({ code: `WB${u}`, name: 'B' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  // ---- releases ----

  it('a batch release requires allocations that sum to the line quantity', async () => {
    const p = await newProduct('P-ALLOC');
    const lot = await seedLot(p, whA, 50, 'LOT-A');
    const noAlloc = await release(whA, [{ productId: p, requestedQty: 10 }]);
    await drive(noAlloc.id);
    await http().post(`/api/releases/${noAlloc.id}/post`).set(auth()).expect(400); // batch line needs allocations

    const badSum = await release(whA, [{ productId: p, requestedQty: 10, allocations: [{ lotId: lot, quantity: 7 }] }]);
    await drive(badSum.id);
    await http().post(`/api/releases/${badSum.id}/post`).set(auth()).expect(400); // 7 != 10

    const ok = await release(whA, [{ productId: p, requestedQty: 10, allocations: [{ lotId: lot, quantity: 10 }] }]);
    await drive(ok.id);
    await http().post(`/api/releases/${ok.id}/post`).set(auth()).expect(201);
    expect((await balAt(p, whA, lot))!.onHand).toBe('40');
    await reconcile(p);
  });

  it('a non-batch release rejects lot allocations', async () => {
    const p = await newProduct('P-NONBATCH', false);
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whA, lines: [{ productId: p, quantity: 20, unitCost: 5 }] }).expect(201);
    const lot = '11111111-1111-4111-8111-111111111111';
    const r = await release(whA, [{ productId: p, requestedQty: 5, allocations: [{ lotId: lot, quantity: 5 }] }]);
    await drive(r.id);
    await http().post(`/api/releases/${r.id}/post`).set(auth()).expect(400); // non-batch cannot allocate lots
  });

  it('validates availability per lot, not just the product total', async () => {
    const p = await newProduct('P-PERLOT');
    const a = await seedLot(p, whA, 3, 'LOT-A');
    await seedLot(p, whA, 17, 'LOT-B'); // product total 20, but LOT-A only has 3
    const r = await release(whA, [{ productId: p, requestedQty: 10, allocations: [{ lotId: a, quantity: 10 }] }]);
    await drive(r.id);
    await http().post(`/api/releases/${r.id}/post`).set(auth()).expect(403); // LOT-A has only 3 → negative-stock guard
  });

  it('a multi-lot release posts correct independent lot balances and is idempotent', async () => {
    const p = await newProduct('P-MULTI');
    const a = await seedLot(p, whA, 30, 'LOT-A');
    const b = await seedLot(p, whA, 30, 'LOT-B');
    const r = await release(whA, [{ productId: p, requestedQty: 25, allocations: [{ lotId: a, quantity: 10 }, { lotId: b, quantity: 15 }] }]);
    await drive(r.id);
    await http().post(`/api/releases/${r.id}/post`).set(auth()).expect(201);
    expect((await balAt(p, whA, a))!.onHand).toBe('20');
    expect((await balAt(p, whA, b))!.onHand).toBe('15');
    // Replay: idempotent, no duplicate lot movements.
    await http().post(`/api/releases/${r.id}/post`).set(auth()).expect(201);
    expect((await balAt(p, whA, a))!.onHand).toBe('20');
    expect((await balAt(p, whA, b))!.onHand).toBe('15');
    await reconcile(p);
  });

  it('reserved consumption with lot allocation reconciles (reserved on NIL, on_hand on the lot)', async () => {
    const p = await newProduct('P-RESV');
    const a = await seedLot(p, whA, 100, 'LOT-A');
    // Reserve 30 at product level (availability aggregates across lots).
    const resv = (await http().post('/api/reservations').set(auth()).send({ warehouseId: whA, lines: [{ productId: p, quantity: 30 }] }).expect(201)).body;
    await http().post(`/api/reservations/${resv.id}/confirm`).set(auth()).expect(201);
    expect((await balAt(p, whA, null))!.reserved).toBe('30'); // reserved on the NIL row
    const lineId = resv.lines[0].id;

    const r = await release(whA, [{ productId: p, requestedQty: 30, reservationLineId: lineId, allocations: [{ lotId: a, quantity: 30 }] }]);
    await drive(r.id);
    await http().post(`/api/releases/${r.id}/post`).set(auth()).expect(201);

    expect((await balAt(p, whA, a))!.onHand).toBe('70'); // physical came off the lot
    expect((await balAt(p, whA, null))!.reserved).toBe('0'); // commitment released on NIL
    const consumed = (await http().get(`/api/reservations/${resv.id}`).set(auth()).expect(200)).body;
    expect(consumed.status).toBe('CONSUMED');
    await reconcile(p);
  });

  // ---- transfers ----

  it('a transfer preserves the same lot identity through dispatch and receive', async () => {
    const p = await newProduct('P-XFER');
    const a = await seedLot(p, whA, 40, 'LOT-A');
    const t = (await http().post('/api/transfers').set(auth())
      .send({ sourceWarehouseId: whA, destWarehouseId: whB, items: [{ productId: p, quantity: 15, lotId: a }] }).expect(201)).body;
    await http().post(`/api/transfers/${t.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${t.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/transfers/${t.id}/dispatch`).set(auth()).expect(201);
    expect((await balAt(p, whA, a))!.inTransit).toBe('15'); // held at source in transit, same lot
    await http().post(`/api/transfers/${t.id}/receive`).set(auth()).expect(201);
    expect((await balAt(p, whA, a))!.onHand).toBe('25'); // 40 - 15
    expect((await balAt(p, whB, a))!.onHand).toBe('15'); // same lotId at destination
    expect((await balAt(p, whA, a))!.inTransit).toBe('0');
    await reconcile(p);
  });

  // ---- adjustments ----

  it('adjustments require an existing lot for batch products and cannot create or hit the wrong lot', async () => {
    const p = await newProduct('P-ADJ');
    const a = await seedLot(p, whA, 20, 'LOT-A');
    const mkAdj = async (item: Record<string, unknown>) => {
      const adj = (await http().post('/api/adjustments').set(auth()).send({ warehouseId: whA, items: [item] }).expect(201)).body;
      await http().post(`/api/adjustments/${adj.id}/submit`).set(auth()).expect(201);
      await http().post(`/api/adjustments/${adj.id}/approve`).set(auth()).send({}).expect(201);
      return adj.id;
    };
    // No lot on a batch adjustment → rejected at post.
    const noLot = await mkAdj({ productId: p, direction: 'OUT', quantity: 5 });
    await http().post(`/api/adjustments/${noLot}/post`).set(auth()).expect(400);
    // Positive adjustment with a non-existent lot → rejected (never silently creates a lot).
    const fakeLot = await mkAdj({ productId: p, direction: 'IN', quantity: 5, lotId: '22222222-2222-4222-8222-222222222222' });
    await http().post(`/api/adjustments/${fakeLot}/post`).set(auth()).expect(400);
    // OUT against a lot that has no stock is caught by the negative-stock guard (403), not silently applied.
    const b = await seedLot(p, whA, 4, 'LOT-B');
    const wrongLot = await mkAdj({ productId: p, direction: 'OUT', quantity: 10, lotId: b }); // LOT-B only has 4
    await http().post(`/api/adjustments/${wrongLot}/post`).set(auth()).expect(403);
    // OUT against the correct lot posts and reconciles.
    const good = await mkAdj({ productId: p, direction: 'OUT', quantity: 5, lotId: a });
    await http().post(`/api/adjustments/${good}/post`).set(auth()).expect(201);
    expect((await balAt(p, whA, a))!.onHand).toBe('15');
    await reconcile(p);
  });

  // ---- counts ----

  it('a physical count snapshots per lot and detects redistribution with zero product-level variance', async () => {
    const p = await newProduct('P-COUNT');
    const a = await seedLot(p, whA, 40, 'LOT-A');
    const b = await seedLot(p, whA, 60, 'LOT-B');
    const count = (await http().post('/api/counts').set(auth()).send({ warehouseId: whA, productIds: [p] }).expect(201)).body;
    const full = (await http().get(`/api/counts/${count.id}`).set(auth()).expect(200)).body;
    const itemA = full.items.find((i: { lotId: string }) => i.lotId === a);
    const itemB = full.items.find((i: { lotId: string }) => i.lotId === b);
    expect(itemA && itemB).toBeTruthy(); // one item per lot
    // Physical: LOT-A 70, LOT-B 30 — product total 100 unchanged, but lots redistributed.
    await http().post(`/api/counts/${count.id}/entries`).set(auth())
      .send({ items: [{ itemId: itemA.id, countedQty: 70 }, { itemId: itemB.id, countedQty: 30 }] }).expect(201);
    await http().post(`/api/counts/${count.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/counts/${count.id}/post`).set(auth()).expect(201);
    expect((await balAt(p, whA, a))!.onHand).toBe('70'); // +30 variance posted to LOT-A
    expect((await balAt(p, whA, b))!.onHand).toBe('30'); // -30 variance posted to LOT-B
    await reconcile(p);
  });

  // ---- returns ----

  it('a batch return requires a recognized lot and every disposition preserves it', async () => {
    const p = await newProduct('P-RET');
    const a = await seedLot(p, whA, 50, 'LOT-A');
    // Intake without a lot → rejected.
    await http().post('/api/returns').set(auth()).send({ type: 'CUSTOMER', warehouseId: whA, lines: [{ productId: p, quantity: 6 }] }).expect(400);
    // With the recognized lot → quarantine lands on that lot.
    const ret = (await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: whA, lines: [{ productId: p, quantity: 6, lotId: a }] }).expect(201)).body;
    await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201);
    expect((await balAt(p, whA, a))!.quarantined).toBe('6');
    expect((await balAt(p, whA, a))!.onHand).toBe('56'); // 50 + 6 received into quarantine

    const lineId = (await http().get(`/api/returns/${ret.id}`).set(auth()).expect(200)).body.lines[0].id;
    await http().post(`/api/returns/${ret.id}/dispositions`).set(auth()).send({ lineId, type: 'RESTOCK', quantity: 3 }).expect(201);
    await http().post(`/api/returns/${ret.id}/dispositions`).set(auth()).send({ lineId, type: 'DAMAGED', quantity: 2 }).expect(201);
    const bal = (await balAt(p, whA, a))!;
    expect(bal.quarantined).toBe('1'); // 6 - 3 - 2
    expect(bal.damaged).toBe('2');
    expect(bal.onHand).toBe('54'); // 56 - 2 damaged out of the pool
    await reconcile(p); // quarantine + damaged reconcile per lot
  });

  // ---- cross-module integration ----

  it('integration: one lot flows through receive→reserve→release→transfer→return→disposition→count, fully reconciled', async () => {
    const p = await newProduct('P-INTEG');
    const a = await seedLot(p, whA, 100, 'LOT-A');

    // Reserve 30, release 20 from LOT-A against it.
    const resv = (await http().post('/api/reservations').set(auth()).send({ warehouseId: whA, lines: [{ productId: p, quantity: 30 }] }).expect(201)).body;
    await http().post(`/api/reservations/${resv.id}/confirm`).set(auth()).expect(201);
    const rel = await release(whA, [{ productId: p, requestedQty: 20, reservationLineId: resv.lines[0].id, allocations: [{ lotId: a, quantity: 20 }] }]);
    await drive(rel.id);
    await http().post(`/api/releases/${rel.id}/post`).set(auth()).expect(201);

    // Transfer 25 of LOT-A A→B.
    const t = (await http().post('/api/transfers').set(auth())
      .send({ sourceWarehouseId: whA, destWarehouseId: whB, items: [{ productId: p, quantity: 25, lotId: a }] }).expect(201)).body;
    await http().post(`/api/transfers/${t.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${t.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/transfers/${t.id}/dispatch`).set(auth()).expect(201);
    await http().post(`/api/transfers/${t.id}/receive`).set(auth()).expect(201);

    // Return 5 of LOT-A into quarantine at A, restock 3, damage 2.
    const ret = (await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: whA, lines: [{ productId: p, quantity: 5, lotId: a }] }).expect(201)).body;
    await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201);
    const lineId = (await http().get(`/api/returns/${ret.id}`).set(auth()).expect(200)).body.lines[0].id;
    await http().post(`/api/returns/${ret.id}/dispositions`).set(auth()).send({ lineId, type: 'RESTOCK', quantity: 3 }).expect(201);
    await http().post(`/api/returns/${ret.id}/dispositions`).set(auth()).send({ lineId, type: 'DAMAGED', quantity: 2 }).expect(201);

    // Count both warehouses (no physical variance).
    for (const wh of [whA, whB]) {
      const c = (await http().post('/api/counts').set(auth()).send({ warehouseId: wh, productIds: [p] }).expect(201)).body;
      const items = (await http().get(`/api/counts/${c.id}`).set(auth()).expect(200)).body.items;
      await http().post(`/api/counts/${c.id}/entries`).set(auth())
        .send({ items: items.map((i: { id: string; systemQty: string }) => ({ itemId: i.id, countedQty: Number(i.systemQty) })) }).expect(201);
      await http().post(`/api/counts/${c.id}/submit`).set(auth()).expect(201);
      await http().post(`/api/counts/${c.id}/approve`).set(auth()).send({}).expect(201);
      await http().post(`/api/counts/${c.id}/post`).set(auth()).expect(201);
    }

    // Final position of LOT-A: A on_hand 100-20-25+5-2 = 58, quar 0, dmg 2; B on_hand 25.
    const atA = (await balAt(p, whA, a))!;
    expect(atA.onHand).toBe('58');
    expect(atA.quarantined).toBe('0');
    expect(atA.damaged).toBe('2');
    expect((await balAt(p, whA, null))!.reserved).toBe('10'); // 30 reserved − 20 consumed, held on the NIL row
    const atB = (await balAt(p, whB, a))!;
    expect(atB.onHand).toBe('25');

    // Aggregate product total across lots/warehouses = Σ ledger on-hand deltas.
    const bs = await balances(p);
    const totalOnHand = bs.reduce((acc, b) => acc + Number(b.onHand), 0);
    const ledgerOnHand = (await movements(p)).reduce((acc, m) => acc + Number(m.onHandDelta), 0);
    expect(totalOnHand).toBeCloseTo(ledgerOnHand, 4); // 83
    await reconcile(p); // every (warehouse,lot) bucket ties to the ledger
  });
});

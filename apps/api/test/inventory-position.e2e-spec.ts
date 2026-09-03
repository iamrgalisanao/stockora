import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2C.4 — Inventory-position read model (no new semantics; pure projection over balances). available =
 * onHand - reserved - quarantined; damaged sits OUTSIDE onHand (never double-subtracted); in-transit is
 * inbound context, never promiseable. Every bucket drills back to its composing operational records.
 */
describe('Inventory position + availability lens (e2e, 2C.4)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let staffToken: string;
  let unitId: string;
  let whMain: string;
  let whDest: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string, batch = false) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: batch }).expect(201)).body.id as string;
  const opening = (productId: string, qty: number, whId: string, lotNumber?: string, expiryDate?: string) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 10, ...(lotNumber ? { lotNumber } : {}), ...(expiryDate ? { expiryDate } : {}) }] }).expect(201);
  const positions = async (qs = '', t = token) =>
    (await http().get(`/api/inventory/positions${qs}`).set(auth(t)).expect(200)).body as Array<Record<string, any>>;
  const iso = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `POS ${u}`, adminEmail: `pos_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whMain = (await http().post('/api/warehouses').set(auth()).send({ code: `MAIN${u}`, name: 'Main' }).expect(201)).body.id;
    whDest = (await http().post('/api/warehouses').set(auth()).send({ code: `DEST${u}`, name: 'Dest' }).expect(201)).body.id;
    await http().post('/api/users').set(auth()).send({ email: `posstaff_${u}@x.test`, name: 'Staff', roleKey: 'warehouse_staff', password: 'password123' }).expect(201);
    staffToken = (await http().post('/api/auth/login').send({ email: `posstaff_${u}@x.test`, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('acceptance: every bucket is explained and drill-downs reconcile to the same numbers', async () => {
    const p = await newProduct('SCENARIO');
    await opening(p, 100, whMain);

    // Reserve 20.
    const resv = (await http().post('/api/reservations').set(auth()).send({ warehouseId: whMain, lines: [{ productId: p, quantity: 20 }] }).expect(201)).body;
    await http().post(`/api/reservations/${resv.id}/confirm`).set(auth()).expect(201);

    // Transfer 15 out (dispatch → in transit at source).
    const xfer = (await http().post('/api/transfers').set(auth()).send({ sourceWarehouseId: whMain, destWarehouseId: whDest, items: [{ productId: p, quantity: 15 }] }).expect(201)).body;
    await http().post(`/api/transfers/${xfer.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${xfer.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/transfers/${xfer.id}/dispatch`).set(auth()).expect(201);

    // Return 8 into quarantine, then RESTOCK 3 and DAMAGED 2.
    const ret = (await http().post('/api/returns').set(auth()).send({ type: 'CUSTOMER', warehouseId: whMain, sourceReference: `RMA-${u}`, lines: [{ productId: p, quantity: 8 }] }).expect(201)).body;
    await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201);
    const lineId = ret.lines[0].id;
    await http().post(`/api/returns/${ret.id}/dispositions`).set(auth()).send({ lineId, type: 'RESTOCK', quantity: 3 }).expect(201);
    await http().post(`/api/returns/${ret.id}/dispositions`).set(auth()).send({ lineId, type: 'DAMAGED', quantity: 2 }).expect(201);

    // Release 10.
    const rel = (await http().post('/api/releases').set(auth()).send({ warehouseId: whMain, destinationType: 'CUSTOMER', items: [{ productId: p, requestedQty: 10 }] }).expect(201)).body;
    await http().post(`/api/releases/${rel.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.id}/post`).set(auth()).expect(201);

    const row = (await positions(`?warehouseId=${whMain}&productId=${p}`))[0]!;
    expect(row.onHand).toBe('81');
    expect(row.reserved).toBe('20');
    expect(row.quarantined).toBe('3');
    expect(row.damaged).toBe('2');
    expect(row.inTransit).toBe('15');
    expect(row.available).toBe('58'); // 81 - 20 - 3
    // Damaged is NOT subtracted again (would be 56 if it were).
    expect(Number(row.available)).toBe(Number(row.onHand) - Number(row.reserved) - Number(row.quarantined));
    expect(row.lotId).toBeNull(); // non-batch → no fake lot

    // Drill-downs reconcile to the same bucket numbers.
    const rb = (await http().get(`/api/reservations/reserved-breakdown?productId=${p}&warehouseId=${whMain}`).set(auth()).expect(200)).body as Array<any>;
    expect(rb.reduce((s, r) => s + Number(r.remaining), 0)).toBe(20);
    const qb = (await http().get(`/api/returns/quarantine-breakdown?productId=${p}&warehouseId=${whMain}`).set(auth()).expect(200)).body as Array<any>;
    expect(qb.reduce((s, r) => s + Number(r.remaining), 0)).toBe(3);

    // Full reconciliation holds: ledger-backed buckets vs movement deltas, and `reserved` vs active
    // reservations (ADR 0005 — reserved is reconciled against its own source, not the ledger).
    const rec = (await http().post('/api/inventory/reconcile').set(auth()).expect(201)).body;
    expect(rec.ok).toBe(true);
  });

  it('reconcile checks reserved against active reservations, not the ledger (ADR 0005)', async () => {
    const p = await newProduct('RECON');
    await opening(p, 50, whMain);
    // A confirmed reservation must reconcile (reserved bucket = Σ active reservation remaining).
    const r = (await http().post('/api/reservations').set(auth()).send({ warehouseId: whMain, lines: [{ productId: p, quantity: 12 }] }).expect(201)).body;
    await http().post(`/api/reservations/${r.id}/confirm`).set(auth()).expect(201);
    let rec = (await http().post('/api/inventory/reconcile').set(auth()).expect(201)).body;
    expect(rec.drift.filter((d: any) => d.productId === p)).toEqual([]);
    // Releasing the reservation returns reserved to 0 and still reconciles.
    await http().post(`/api/reservations/${r.id}/release`).set(auth()).expect(201);
    rec = (await http().post('/api/inventory/reconcile').set(auth()).expect(201)).body;
    expect(rec.drift.filter((d: any) => d.productId === p)).toEqual([]);
    const row = (await positions(`?warehouseId=${whMain}&productId=${p}`))[0]!;
    expect(row.reserved).toBe('0');
  });

  it('lot-aware positions stay distinct and roll up; non-batch has no lot dimension', async () => {
    const bp = await newProduct('ROLLUP', true);
    await opening(bp, 40, whMain, 'LOT-A');
    await opening(bp, 10, whMain, 'LOT-B');
    await opening(bp, 5, whDest, 'LOT-A');
    const rows = await positions(`?productId=${bp}`);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.lotId && r.lotNumber && r.isBatchTracked)).toBe(true);
    // Product roll-up = Σ rows; warehouse roll-up = Σ its lot rows.
    expect(rows.reduce((s, r) => s + Number(r.onHand), 0)).toBe(55);
    expect(rows.filter((r) => r.warehouseId === whMain).reduce((s, r) => s + Number(r.onHand), 0)).toBe(50);
    const distinct = new Set(rows.map((r) => `${r.warehouseId}:${r.lotId}`));
    expect(distinct.size).toBe(3);
  });

  it('an expired lot stays physically visible and is flagged (not silently outbound-eligible)', async () => {
    const ep = await newProduct('EXP', true);
    await opening(ep, 12, whMain, 'DEAD', iso(-2));
    const rows = await positions(`?productId=${ep}`);
    expect(rows[0]!.expiryState).toBe('EXPIRED');
    expect(rows[0]!.onHand).toBe('12'); // still physically present
    // Surfaced by the availability lens's expired-lot filter.
    expect((await positions(`?productId=${ep}&filter=EXPIRED_LOT`)).length).toBe(1);
  });

  it('availability filters and search are deterministic', async () => {
    const p = await newProduct('FILT');
    await opening(p, 30, whMain);
    // Available.
    expect((await positions(`?productId=${p}&filter=AVAILABLE`)).length).toBe(1);
    // Quarantined filter excludes a clean row.
    expect((await positions(`?productId=${p}&filter=QUARANTINED`)).length).toBe(0);
    // Search by SKU.
    const bySku = await positions(`?warehouseId=${whMain}&q=FILT`);
    expect(bySku.some((r) => r.productId === p)).toBe(true);
  });

  it('org isolation, warehouse-scoped, and cost fields gated by cost.view', async () => {
    const p = await newProduct('GATED');
    await opening(p, 7, whMain);
    // Admin (cost.view + valuation.view) sees cost/value.
    const adminRow = (await positions(`?productId=${p}`))[0]!;
    expect(adminRow.avgCost).toBeDefined();
    expect(adminRow.value).toBeDefined();
    // Staff (no cost.view) does not.
    const staffRow = (await positions(`?productId=${p}`, staffToken))[0]!;
    expect(staffRow.avgCost).toBeUndefined();
    expect(staffRow.value).toBeUndefined();
    // Another org sees nothing.
    const other = (await http().post('/api/auth/register').send({ organizationName: `POS2 ${u}`, adminEmail: `pos2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    expect((await positions(`?productId=${p}`, other)).length).toBe(0);
  });
});

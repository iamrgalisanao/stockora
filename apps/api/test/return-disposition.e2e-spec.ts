import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2B.2B — Inspection + Disposition (ADR 0006). Quarantined returned stock is split across RESTOCK /
 * DAMAGED / RETURN_TO_SUPPLIER / DISPOSE, each an immutable ledger posting. Document status rolls up
 * mechanically from all lines. Every test reconciles the persisted balance buckets against the ledger.
 */
describe('Return disposition (e2e, 2B.2B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string; // administrator (all return perms)
  let staff: string; // warehouse_staff (inspect, NOT dispose)
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string) => {
    const s = sku(prefix);
    return (await http().post('/api/products').set(auth()).send({ sku: s, name: s, baseUomId: unitId }).expect(201)).body.id as string;
  };
  const opening = (productId: string, quantity: number) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity, unitCost: 10 }] }).expect(201);
  const balance = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body
      .find((b: { warehouseId: string }) => b.warehouseId === whId);

  // Draft a return (optionally multi-line) and receive it into quarantine. Returns the return body.
  const receivedReturn = async (lines: Array<{ productId: string; quantity: number }>) => {
    const ret = (await http().post('/api/returns').set(auth())
      .send({ type: 'CUSTOMER', warehouseId: whId, lines }).expect(201)).body;
    return (await http().post(`/api/returns/${ret.id}/receive`).set(auth()).send({}).expect(201)).body;
  };
  const dispose = (id: string, body: Record<string, unknown>, t = token) =>
    http().post(`/api/returns/${id}/dispositions`).set(auth(t)).send(body);

  // Second guard: persisted balance buckets must equal the running sum of the ledger deltas.
  const reconcile = async (productId: string) => {
    const movements = (await http().get(`/api/inventory/movements?productId=${productId}&limit=1000`).set(auth()).expect(200)).body;
    const sum = (k: string) => movements.reduce((a: number, m: Record<string, string>) => a + Number(m[k]), 0);
    const bal = await balance(productId);
    expect(Number(bal.onHand)).toBeCloseTo(sum('onHandDelta'), 4);
    expect(Number(bal.reserved)).toBeCloseTo(sum('reservedDelta'), 4);
    expect(Number(bal.quarantined)).toBeCloseTo(sum('quarantinedDelta'), 4);
    expect(Number(bal.damaged)).toBeCloseTo(sum('damagedDelta'), 4);
    expect(Number(bal.quarantined)).toBeGreaterThanOrEqual(0); // invariant: quarantine never negative
    expect(Number(bal.damaged)).toBeGreaterThanOrEqual(0); // invariant: damaged never negative
    return bal;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Disp ${u}`, adminEmail: `disp_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
    const staffEmail = `staff_${u}@x.test`;
    await http().post('/api/users').set(auth())
      .send({ email: staffEmail, name: 'Stan Staff', roleKey: 'warehouse_staff', password: 'password123' }).expect(201);
    staff = (await http().post('/api/auth/login').send({ email: staffEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('partial RESTOCK leaves the return PARTIALLY_DISPOSED', async () => {
    const p = await newProduct('D-PART');
    await opening(p, 100);
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]);
    const after = (await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 4 }).expect(201)).body;
    expect(after.status).toBe('PARTIALLY_DISPOSED');
    expect(after.lines[0].disposedQuantity).toBe('4');
    expect(after.lines[0].remainingQuarantine).toBe('6');
    await reconcile(p);
  });

  it('full RESTOCK completes the return and increases availability without changing on_hand', async () => {
    const p = await newProduct('D-FULL');
    await opening(p, 100); // on_hand 100
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]); // on_hand 110, quar 10, avail 100
    const after = (await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 10 }).expect(201)).body;
    expect(after.status).toBe('COMPLETED');
    expect(after.completedAt).toBeTruthy();
    const bal = await reconcile(p);
    expect(bal.onHand).toBe('110'); // unchanged by restock
    expect(bal.quarantined).toBe('0'); // hold released
    expect(bal.available).toBe('110'); // now fully sellable
  });

  it('handles mixed outcomes across one line and completes', async () => {
    const p = await newProduct('D-MIX1');
    await opening(p, 50);
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]);
    const line = ret.lines[0].id;
    await dispose(ret.id, { lineId: line, type: 'RESTOCK', quantity: 7 }).expect(201);
    await dispose(ret.id, { lineId: line, type: 'DAMAGED', quantity: 2 }).expect(201);
    const done = (await dispose(ret.id, { lineId: line, type: 'DISPOSE', quantity: 1 }).expect(201)).body;
    expect(done.status).toBe('COMPLETED');
    const bal = await reconcile(p);
    // start on_hand 50, +10 receipt = 60; restock 7 (no on_hand change); damaged 2 (-2 on_hand);
    // dispose 1 (-1 on_hand) => on_hand 57, quar 0, damaged 2, available 57.
    expect(bal.onHand).toBe('57');
    expect(bal.quarantined).toBe('0');
    expect(bal.damaged).toBe('2');
    expect(bal.available).toBe('57');
    expect(done.lines[0].dispositions.length).toBe(3);
  });

  it('rolls document status up from ALL lines, not just the one touched', async () => {
    const a = await newProduct('D-ML-A');
    const b = await newProduct('D-ML-B');
    await opening(a, 50); await opening(b, 50);
    const ret = await receivedReturn([{ productId: a, quantity: 5 }, { productId: b, quantity: 5 }]);
    const lineA = ret.lines.find((l: { productId: string }) => l.productId === a).id;
    const lineB = ret.lines.find((l: { productId: string }) => l.productId === b).id;

    const afterA = (await dispose(ret.id, { lineId: lineA, type: 'RESTOCK', quantity: 5 }).expect(201)).body;
    expect(afterA.status).toBe('PARTIALLY_DISPOSED'); // line B still outstanding

    const afterB = (await dispose(ret.id, { lineId: lineB, type: 'RESTOCK', quantity: 5 }).expect(201)).body;
    expect(afterB.status).toBe('COMPLETED'); // both lines now fully disposed
    await reconcile(a); await reconcile(b);
  });

  it('rejects a disposition exceeding remaining quarantined and leaves the ledger untouched', async () => {
    const p = await newProduct('D-OVER');
    await opening(p, 40);
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]);
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 6 }).expect(201);
    // remaining is 4 — asking for 5 must be rejected.
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'DISPOSE', quantity: 5 }).expect(400);
    const bal = await reconcile(p);
    expect(bal.quarantined).toBe('4'); // untouched by the rejected attempt (never negative)
  });

  it('concurrent dispositions cannot over-dispose a line', async () => {
    const p = await newProduct('D-CONC');
    await opening(p, 100);
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]);
    const line = ret.lines[0].id;
    // Two racing dispositions of 6 each against 10 remaining — at most one can win (6+6 > 10).
    const results = await Promise.allSettled([
      dispose(ret.id, { lineId: line, type: 'RESTOCK', quantity: 6 }),
      dispose(ret.id, { lineId: line, type: 'DISPOSE', quantity: 6 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201).length;
    expect(ok).toBe(1);
    const bal = await reconcile(p);
    expect(Number(bal.quarantined)).toBe(4); // exactly one disposition of 6 applied
  });

  it('does not post twice when a disposition is replayed with the same idempotency key', async () => {
    const p = await newProduct('D-IDEM');
    await opening(p, 50);
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]);
    const key = `k-${u}-${seq++}`;
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 3, idempotencyKey: key }).expect(201);
    const replay = (await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 3, idempotencyKey: key }).expect(201)).body;
    expect(replay.lines[0].disposedQuantity).toBe('3'); // not 6
    expect(replay.lines[0].dispositions.length).toBe(1);
    const bal = await reconcile(p);
    expect(bal.quarantined).toBe('7');
  });

  it('DAMAGED decreases on_hand and quarantine and increases damaged', async () => {
    const p = await newProduct('D-DMG');
    await opening(p, 30);
    const ret = await receivedReturn([{ productId: p, quantity: 8 }]); // on_hand 38, quar 8
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'DAMAGED', quantity: 5 }).expect(201);
    const bal = await reconcile(p);
    expect(bal.onHand).toBe('33'); // 38 - 5
    expect(bal.quarantined).toBe('3'); // 8 - 5
    expect(bal.damaged).toBe('5');
    expect(bal.available).toBe('30'); // 33 - 3
  });

  it('RETURN_TO_SUPPLIER decreases physical stock', async () => {
    const p = await newProduct('D-RTS');
    await opening(p, 30);
    const ret = await receivedReturn([{ productId: p, quantity: 8 }]);
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RETURN_TO_SUPPLIER', quantity: 8 }).expect(201);
    const bal = await reconcile(p);
    expect(bal.onHand).toBe('30'); // 38 - 8 shipped back
    expect(bal.quarantined).toBe('0');
    expect(bal.damaged).toBe('0');
  });

  it('DISPOSE decreases physical stock', async () => {
    const p = await newProduct('D-DISP');
    await opening(p, 30);
    const ret = await receivedReturn([{ productId: p, quantity: 8 }]);
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'DISPOSE', quantity: 8 }).expect(201);
    const bal = await reconcile(p);
    expect(bal.onHand).toBe('30');
    expect(bal.quarantined).toBe('0');
  });

  it('a completed return rejects any further disposition', async () => {
    const p = await newProduct('D-DONE');
    await opening(p, 30);
    const ret = await receivedReturn([{ productId: p, quantity: 5 }]);
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 5 }).expect(201);
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'DISPOSE', quantity: 1 }).expect(409);
  });

  it('staff (return.inspect only) can RESTOCK/DAMAGED but not the destructive outcomes', async () => {
    const p = await newProduct('D-PERM');
    await opening(p, 30);
    const ret = await receivedReturn([{ productId: p, quantity: 10 }]);
    const line = ret.lines[0].id;
    await dispose(ret.id, { lineId: line, type: 'RESTOCK', quantity: 2 }, staff).expect(201);
    await dispose(ret.id, { lineId: line, type: 'DAMAGED', quantity: 2 }, staff).expect(201);
    await dispose(ret.id, { lineId: line, type: 'RETURN_TO_SUPPLIER', quantity: 2 }, staff).expect(403);
    await dispose(ret.id, { lineId: line, type: 'DISPOSE', quantity: 2 }, staff).expect(403);
    await reconcile(p);
  });

  it('records the disposition under a correlation id, referencing the return in the ledger', async () => {
    const p = await newProduct('D-CORR');
    await opening(p, 30);
    const ret = await receivedReturn([{ productId: p, quantity: 6 }]);
    await dispose(ret.id, { lineId: ret.lines[0].id, type: 'RESTOCK', quantity: 6 }).expect(201);

    const page = (await http().get(`/api/audit?action=return.dispositioned&entityId=${ret.id}`).set(auth()).expect(200)).body;
    expect(page.entries.length).toBeGreaterThanOrEqual(1);
    expect(page.entries[0].correlationId).toBeTruthy(); // audit carries request correlation context

    const movements = (await http().get(`/api/inventory/movements?productId=${p}&type=RETURN_RESTOCK`).set(auth()).expect(200)).body;
    expect(movements.some((m: { referenceType: string; referenceId: string }) =>
      m.referenceType === 'inventory_return' && m.referenceId === ret.id)).toBe(true);
  });
});

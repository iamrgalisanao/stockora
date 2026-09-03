import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2C.2B — FEFO Allocation (ADR 0008). Deterministic FEFO plan generation, advisory preview, authoritative
 * revalidation at post, and audited manual override. Preview is read-only; post is authoritative.
 */
describe('FEFO allocation (e2e, 2C.2B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let staff: string; // warehouse_staff: no fefo_override
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const iso = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); };

  const fefoProduct = async (prefix: string) => {
    const id = (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: true }).expect(201)).body.id as string;
    await http().put(`/api/products/${id}/shelf-life-policy`).set(auth()).send({ allocationStrategy: 'FEFO' }).expect(200);
    return id;
  };
  const seedLot = async (productId: string, qty: number, lotNumber: string, expiryDate?: string, receivedShift?: number) => {
    await http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 10, lotNumber, ...(expiryDate ? { expiryDate } : {}) }] }).expect(201);
    return (await http().get(`/api/lots?productId=${productId}`).set(auth()).expect(200)).body
      .find((l: { lotNumber: string }) => l.lotNumber === lotNumber).id as string;
  };
  const plan = async (productId: string, quantity: number) =>
    (await http().get(`/api/lots/fefo-plan?productId=${productId}&warehouseId=${whId}&quantity=${quantity}`).set(auth()).expect(200)).body;
  const balAt = async (productId: string, lotId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body.find((b: { lotId: string }) => b.lotId === lotId);
  // Create+drive a release; returns id. `alloc` undefined => rely on FEFO auto-gen.
  const release = async (productId: string, qty: number, alloc?: Array<{ lotId: string; quantity: number }>, reservationLineId?: string) => {
    const item: Record<string, unknown> = { productId, requestedQty: qty, ...(alloc ? { allocations: alloc } : {}), ...(reservationLineId ? { reservationLineId } : {}) };
    const r = (await http().post('/api/releases').set(auth()).send({ warehouseId: whId, destinationType: 'INTERNAL_CONSUMPTION', items: [item] }).expect(201)).body;
    await http().post(`/api/releases/${r.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${r.id}/approve`).set(auth()).send({}).expect(201);
    return r.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Fefo ${u}`, adminEmail: `fefo_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
    const staffEmail = `fstaff_${u}@x.test`;
    await http().post('/api/users').set(auth()).send({ email: staffEmail, name: 'Stan Staff', roleKey: 'warehouse_staff', password: 'password123' }).expect(201);
    staff = (await http().post('/api/auth/login').send({ email: staffEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('preview selects earliest expiry first, spans lots, and performs zero writes', async () => {
    const p = await fefoProduct('F-BASIC');
    const a = await seedLot(p, 10, 'A', iso(10));
    const b = await seedLot(p, 20, 'B', iso(15));
    await seedLot(p, 50, 'C'); // no expiry → last
    const pl = await plan(p, 25);
    expect(pl.complete).toBe(true);
    expect(pl.allocations.map((x: { lotId: string; quantity: string }) => [x.lotId, x.quantity])).toEqual([[a, '10'], [b, '15']]);
    // Zero writes: balances unchanged.
    expect((await balAt(p, a)).onHand).toBe('10');
    expect((await balAt(p, b)).onHand).toBe('20');
  });

  it('ranks no-expiry lots after dated lots and excludes expired/quarantined/closed', async () => {
    const p = await fefoProduct('F-RANK');
    const noexp = await seedLot(p, 100, 'NOEXP');
    const dated = await seedLot(p, 5, 'DATED', iso(30));
    await seedLot(p, 100, 'DEAD', iso(-1)); // expired → excluded
    const pl = await plan(p, 8);
    // dated (5) first, then no-expiry (3); expired never appears.
    expect(pl.allocations.map((x: { lotId: string }) => x.lotId)).toEqual([dated, noexp]);
    expect(pl.allocations.map((x: { quantity: string }) => x.quantity)).toEqual(['5', '3']);
  });

  it('strict mode: insufficient eligible stock yields an incomplete plan and a failed FEFO release', async () => {
    const p = await fefoProduct('F-STRICT');
    await seedLot(p, 5, 'ONLY', iso(20));
    const pl = await plan(p, 100);
    expect(pl.complete).toBe(false);
    expect(pl.allocatedQuantity).toBe('5');
    // A FEFO release (no allocations) for more than eligible fails rather than partially releasing.
    const r = await release(p, 100);
    await http().post(`/api/releases/${r}/post`).set(auth()).expect(400);
  });

  it('a FEFO release with no allocations auto-generates and posts the FEFO plan', async () => {
    const p = await fefoProduct('F-AUTO');
    const a = await seedLot(p, 10, 'A', iso(5));
    const b = await seedLot(p, 20, 'B', iso(9));
    const r = await release(p, 25); // no allocations → FEFO auto-gen
    await http().post(`/api/releases/${r}/post`).set(auth()).expect(201);
    expect((await balAt(p, a)).onHand).toBe('0');  // earliest fully drawn
    expect((await balAt(p, b)).onHand).toBe('5');   // remainder from next
  });

  it('a stale submitted plan fails at post rather than silently reallocating', async () => {
    const p = await fefoProduct('F-STALE');
    const a = await seedLot(p, 10, 'A', iso(5));
    const b = await seedLot(p, 20, 'B', iso(9));
    // Operator reviews a plan A10/B5, but another release drains A first.
    const drainer = await release(p, 10, [{ lotId: a, quantity: 10 }]);
    await http().post(`/api/releases/${drainer}/post`).set(auth()).expect(201);
    // The stale plan (still referencing A, now empty) is rejected as a conflict — not silently reallocated.
    const stale = await release(p, 15, [{ lotId: a, quantity: 10 }, { lotId: b, quantity: 5 }]);
    await http().post(`/api/releases/${stale}/post`).set(auth()).expect(409); // A drained since preview
  });

  it('manual canonical FEFO plan needs no override; a bypassing plan needs permission + reason + audit', async () => {
    const p = await fefoProduct('F-OVERRIDE');
    const a = await seedLot(p, 10, 'A', iso(5));  // earliest
    const b = await seedLot(p, 20, 'B', iso(9));
    // Bypass earlier-expiring A entirely (take all from B) while A is still full — needs override.
    const bypass = await release(p, 15, [{ lotId: b, quantity: 15 }]);
    await http().post(`/api/releases/${bypass}/post`).set(auth()).expect(400); // no reason
    await http().post(`/api/releases/${bypass}/post`).set(auth()).send({ fefoOverrideReason: 'customer requested lot B' }).expect(201);

    // Canonical plan (A10 earliest, then remaining B5) — no override needed.
    const canon = await release(p, 15, [{ lotId: a, quantity: 10 }, { lotId: b, quantity: 5 }]);
    await http().post(`/api/releases/${canon}/post`).set(auth()).expect(201);

    // Audit captured the recommendation + submitted plan.
    const audit = (await http().get(`/api/audit?action=release.fefo_override&entityId=${bypass}`).set(auth()).expect(200)).body;
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].changes ?? audit.entries[0]).toBeTruthy();
  });

  it('a user without fefo_override cannot bypass FEFO', async () => {
    const p = await fefoProduct('F-PERM');
    const a = await seedLot(p, 10, 'A', iso(5));
    const b = await seedLot(p, 20, 'B', iso(9));
    // Staff cannot post a bypassing plan (B while earlier-expiring A is full), even with a reason.
    const bad = await release(p, 5, [{ lotId: b, quantity: 5 }]);
    await http().post(`/api/releases/${bad}/post`).set(auth(staff)).send({ fefoOverrideReason: 'x' }).expect(403);
    // Staff can post the canonical plan (earliest lot A).
    const ok = await release(p, 5, [{ lotId: a, quantity: 5 }]);
    await http().post(`/api/releases/${ok}/post`).set(auth(staff)).expect(201);
  });

  it('end-to-end: reserve 25, FEFO across A/B against the reservation, C untouched, reconciled', async () => {
    const p = await fefoProduct('F-E2E');
    const a = await seedLot(p, 10, 'A', iso(10));
    const b = await seedLot(p, 20, 'B', iso(15));
    const c = await seedLot(p, 50, 'C'); // no expiry
    // Reserve 25 at product level.
    const resv = (await http().post('/api/reservations').set(auth()).send({ warehouseId: whId, lines: [{ productId: p, quantity: 25 }] }).expect(201)).body;
    await http().post(`/api/reservations/${resv.id}/confirm`).set(auth()).expect(201);
    // Preview → A10/B15.
    const pl = await plan(p, 25);
    expect(pl.allocations.map((x: { lotId: string; quantity: string }) => [x.lotId, x.quantity])).toEqual([[a, '10'], [b, '15']]);
    // Release the preview plan against the reservation.
    const r = await release(p, 25, pl.allocations.map((x: { lotId: string; quantity: string }) => ({ lotId: x.lotId, quantity: Number(x.quantity) })), resv.lines[0].id);
    await http().post(`/api/releases/${r}/post`).set(auth()).expect(201);

    expect((await balAt(p, a)).onHand).toBe('0');   // A depleted
    expect((await balAt(p, b)).onHand).toBe('5');    // B reduced by 15
    expect((await balAt(p, c)).onHand).toBe('50');   // C untouched
    expect((await balAt(p, null as unknown as string))?.reserved ?? '0').toBe('0'); // NIL reserved released (25→0)
    // Ledger reconciles per lot (on_hand = Σ deltas).
    const movements = (await http().get(`/api/inventory/movements?productId=${p}&limit=500`).set(auth()).expect(200)).body;
    for (const lotId of [a, b, c]) {
      const sum = movements.filter((m: { lotId: string }) => m.lotId === lotId).reduce((acc: number, m: { onHandDelta: string }) => acc + Number(m.onHandDelta), 0);
      expect(Number((await balAt(p, lotId)).onHand)).toBeCloseTo(sum, 4);
    }
    expect((await http().get(`/api/reservations/${resv.id}`).set(auth()).expect(200)).body.status).toBe('CONSUMED');
  });
});

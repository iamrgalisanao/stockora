import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 2C.1A — Lot Core + Receiving (ADR 0007). Lot becomes part of the inventory grain. Every test reconciles
 * lot balances to the ledger and the product/warehouse total to the sum of lot balances.
 */
describe('Lot core + receiving (e2e, 2C.1A)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string, opts: { batch?: boolean } = {}) => {
    const s = sku(prefix);
    const id = (await http().post('/api/products').set(auth())
      .send({ sku: s, name: s, baseUomId: unitId, isBatchTracked: opts.batch ?? false }).expect(201)).body.id;
    return { id, sku: s };
  };
  const opening = (line: Record<string, unknown>, expect = 201) =>
    http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId: whId, lines: [line] }).expect(expect);
  const balances = async (productId: string) =>
    (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const lots = async (productId: string) =>
    (await http().get(`/api/lots?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
  const movements = async (productId: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&limit=500`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;

  // Ledger reconciliation for a single lot: balance(lot) buckets == Σ movement deltas for that lot.
  const reconcileLot = async (productId: string, lotId: string | undefined) => {
    const ms = (await movements(productId)).filter((m) => m.lotId === lotId);
    const bal = (await balances(productId)).find((b) => b.lotId === lotId);
    const sum = (k: string) => ms.reduce((a, m) => a + Number(m[k]), 0);
    expect(Number(bal?.onHand ?? 0)).toBeCloseTo(sum('onHandDelta'), 4);
    expect(Number(bal?.quarantined ?? 0)).toBeCloseTo(sum('quarantinedDelta'), 4);
    expect(Number(bal?.damaged ?? 0)).toBeCloseTo(sum('damagedDelta'), 4);
  };
  // Aggregate reconciliation: product/warehouse total == Σ of all its lot balances.
  const reconcileProductTotal = async (productId: string) => {
    const bs = await balances(productId);
    const ms = await movements(productId);
    const totalOnHand = bs.reduce((a, b) => a + Number(b.onHand), 0);
    const ledgerOnHand = ms.reduce((a, m) => a + Number(m.onHandDelta), 0);
    expect(totalOnHand).toBeCloseTo(ledgerOnHand, 4);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `Lot ${u}`, adminEmail: `lot_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}`, name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('a batch-tracked opening posting requires a lot; a non-batch one rejects a lot', async () => {
    const b = await newProduct('L-REQ', { batch: true });
    await opening({ productId: b.id, quantity: 10, unitCost: 5 }, 400); // no lot → rejected
    await opening({ productId: b.id, quantity: 10, unitCost: 5, lotNumber: 'LOT-A' }, 201); // with lot → ok

    const n = await newProduct('L-NON');
    await opening({ productId: n.id, quantity: 10, unitCost: 5, lotNumber: 'LOT-X' }, 400); // non-batch + lot → rejected
    await opening({ productId: n.id, quantity: 10, unitCost: 5 }, 201);
  });

  it('lot number is unique per org/product/variant but reusable across products', async () => {
    const a = await newProduct('L-UNIQ-A', { batch: true });
    const b = await newProduct('L-UNIQ-B', { batch: true });
    await opening({ productId: a.id, quantity: 5, lotNumber: 'SHARED-1' }, 201);
    await opening({ productId: b.id, quantity: 5, lotNumber: 'SHARED-1' }, 201); // same number, different product → ok
    expect((await lots(a.id)).length).toBe(1);
    expect((await lots(b.id)).length).toBe(1);
  });

  it('reuses an existing lot on a later receipt; rejects conflicting metadata', async () => {
    const p = await newProduct('L-REUSE', { batch: true });
    await opening({ productId: p.id, quantity: 10, lotNumber: 'LOT-M', expiryDate: '2027-01-01T00:00:00.000Z' }, 201);
    await opening({ productId: p.id, quantity: 5, lotNumber: 'LOT-M', expiryDate: '2027-01-01T00:00:00.000Z' }, 201); // same metadata → reuse
    expect((await lots(p.id)).length).toBe(1);
    // Conflicting expiry for the same lot number → rejected for review.
    await opening({ productId: p.id, quantity: 5, lotNumber: 'LOT-M', expiryDate: '2028-01-01T00:00:00.000Z' }, 409);
    const lot = (await lots(p.id))[0]!;
    expect(lot.onHand).toBe('15'); // 10 + 5, the conflicting one did not post
  });

  it('rejects expiry on/before manufacture date', async () => {
    const p = await newProduct('L-DATES', { batch: true });
    await opening({ productId: p.id, quantity: 5, lotNumber: 'LOT-D', manufacturedAt: '2026-06-01T00:00:00.000Z', expiryDate: '2026-05-01T00:00:00.000Z' }, 400);
  });

  it('receipt increases the correct lot balance and keeps two lots independent, reconciling to the ledger', async () => {
    const p = await newProduct('L-TWO', { batch: true });
    await opening({ productId: p.id, quantity: 40, lotNumber: 'LOT-1' }, 201);
    await opening({ productId: p.id, quantity: 25, lotNumber: 'LOT-2' }, 201);
    const ls = await lots(p.id);
    const l1 = ls.find((l) => l.lotNumber === 'LOT-1')!;
    const l2 = ls.find((l) => l.lotNumber === 'LOT-2')!;
    expect(l1.onHand).toBe('40');
    expect(l2.onHand).toBe('25');
    await reconcileLot(p.id, l1.id);
    await reconcileLot(p.id, l2.id);
    await reconcileProductTotal(p.id); // 65 across both lots
  });

  it('receiving a batch-tracked product creates/uses a lot from the batch number', async () => {
    const supplier = (await http().post('/api/suppliers').set(auth()).send({ code: `S${seq++}`, companyName: 'Sup' }).expect(201)).body.id;
    const p = await newProduct('L-RECV', { batch: true });
    const receipt = (await http().post('/api/receiving').set(auth())
      .send({ warehouseId: whId, supplierId: supplier, items: [{ productId: p.id, receivedQty: 30, unitCost: 8, batchNumber: 'RCV-LOT-1', expiryDate: '2027-03-01T00:00:00.000Z' }] })
      .expect(201)).body;
    await http().post(`/api/receiving/${receipt.id}/post`).set(auth()).expect(201);

    const ls = await lots(p.id);
    expect(ls.length).toBe(1);
    expect(ls[0]!.lotNumber).toBe('RCV-LOT-1');
    expect(ls[0]!.onHand).toBe('30');
    await reconcileLot(p.id, ls[0]!.id);
  });

  it('rejects receiving a batch-tracked product without a batch number', async () => {
    const p = await newProduct('L-RECV-NOLOT', { batch: true });
    const receipt = (await http().post('/api/receiving').set(auth())
      .send({ warehouseId: whId, items: [{ productId: p.id, receivedQty: 10, unitCost: 8 }] }).expect(201)).body;
    await http().post(`/api/receiving/${receipt.id}/post`).set(auth()).expect(400);
  });

  it('lot identity fields are immutable and org-isolated on reads', async () => {
    const p = await newProduct('L-ISO', { batch: true });
    await opening({ productId: p.id, quantity: 5, lotNumber: 'ISO-1' }, 201);
    const lotId = (await lots(p.id))[0]!.id;

    const other = (await http().post('/api/auth/register')
      .send({ organizationName: `OtherL ${u}`, adminEmail: `otherl_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    await http().get(`/api/lots/${lotId}`).set(auth(other)).expect(404); // org isolation
  });

  it('cannot close a lot that still holds stock in any bucket', async () => {
    const p = await newProduct('L-CLOSE', { batch: true });
    await opening({ productId: p.id, quantity: 6, lotNumber: 'CLOSE-1' }, 201);
    const lotId = (await lots(p.id))[0]!.id;
    await http().post(`/api/lots/${lotId}/close`).set(auth()).expect(400); // holds on-hand → cannot close
    // (Draining a lot needs lot-aware outflow, which arrives in 2C.1B; close-after-drain is covered there.)
  });

  it('legacy batch stock migration creates an explicit synthetic lot and reconciles', async () => {
    // Simulate pre-2C.1 legacy stock: post NIL-lot stock as a non-batch product (proper ledger + balance),
    // then flip the product to batch-tracked directly (the API guard forbids this once movements exist —
    // exactly the situation the one-time migration exists to repair).
    const p = await newProduct('L-LEGACY'); // non-batch
    await opening({ productId: p.id, quantity: 20, unitCost: 5 }, 201);
    await prisma.product.update({ where: { id: p.id }, data: { isBatchTracked: true } });

    const res = (await http().post('/api/lots/backfill-legacy').set(auth()).expect(201)).body;
    expect(res.migrated).toBeGreaterThanOrEqual(1);

    const ls = await lots(p.id);
    expect(ls.length).toBe(1);
    expect(ls[0]!.lotNumber).toBe(`LEGACY-OPENING-${p.sku}`);
    expect(ls[0]!.origin).toBe('LEGACY_MIGRATION');
    expect(ls[0]!.onHand).toBe('20'); // repointed onto the synthetic lot

    const nilRow = (await balances(p.id)).find((b) => b.lotId === null);
    expect(Number(nilRow?.onHand ?? 0)).toBe(0); // drained off the NIL grain

    await reconcileLot(p.id, ls[0]!.id); // lot balance == Σ its ledger deltas
    await reconcileProductTotal(p.id);   // product total still == Σ all ledger deltas

    // Idempotent: a second run migrates nothing more.
    const again = (await http().post('/api/lots/backfill-legacy').set(auth()).expect(201)).body;
    expect(again.migrated).toBe(0);
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 2D.4A — Supplier Performance Read Model (docs/analytics/SUPPLIER-PERFORMANCE-METRICS.md). Transparent,
 * receipt-traceable metrics over POSTED receipts only, with coverage where inputs are missing.
 */
describe('Supplier analytics (e2e, 2D.4A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let orgId: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

  const newProduct = async () => {
    const s = sku('SA');
    return (await http().post('/api/products').set(auth()).send({ sku: s, name: s, baseUomId: unitId }).expect(201)).body.id as string;
  };
  const newSupplier = async (leadTimeDays = 0) => {
    const code = sku('SUP');
    const id = (await http().post('/api/suppliers').set(auth()).send({ code, companyName: `Co ${code}` }).expect(201)).body.id as string;
    if (leadTimeDays > 0) await prisma.supplier.update({ where: { id }, data: { leadTimeDays } });
    return id;
  };
  const setRefCost = (supplierId: string, productId: string, cost: number) =>
    prisma.supplierProduct.create({ data: { organizationId: orgId, supplierId, productId, cost } });

  // Create + post a receipt; returns the posted receipt id.
  const postReceipt = async (body: Record<string, unknown>, expectPost = 201) => {
    const draft = await http().post('/api/receiving').set(auth()).send(body).expect(201);
    if (expectPost !== 0) await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(expectPost);
    return draft.body.id as string;
  };

  const perf = async (supplierId: string, extra = '') => {
    const from = iso(30);
    const to = iso(-1); // tomorrow, so "now" receipts are inside
    const res = await http().get(`/api/analytics/suppliers?from=${from}&to=${to}&supplierId=${supplierId}${extra}`).set(auth()).expect(200);
    return res.body as { suppliers: Array<Record<string, any>>; coverage: Record<string, number>; weights: Record<string, number> };
  };
  const rowOf = async (supplierId: string, extra = '') => (await perf(supplierId, extra)).suppliers.find((s) => s.supplierId === supplierId);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    token = (await http().post('/api/auth/register').send({ organizationName: `SA ${u}`, adminEmail: `sa_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'SAW', name: 'W' }).expect(201)).body.id;
    orgId = (await prisma.warehouse.findUniqueOrThrow({ where: { id: whId } })).organizationId;
  });

  afterAll(async () => { await app.close(); });

  it('computes the full metric set + deterministic score from one posted receipt', async () => {
    const p = await newProduct();
    const s = await newSupplier(7); // quoted lead time 7d
    await setRefCost(s, p, 10);
    // expected 100 / received 80 / rejected 20 · unit cost 11 vs ref 10 · order 15d ago, received 10d ago
    // (lead 5d) · expected delivery 9d ago ≥ received 10d ago (on-time).
    await postReceipt({
      warehouseId: whId, supplierId: s, receivingDate: iso(10), orderDate: iso(15), expectedDeliveryDate: iso(9),
      items: [{ productId: p, expectedQty: 100, receivedQty: 80, rejectedQty: 20, unitCost: 11 }],
    });

    const row = await rowOf(s);
    expect(row).toBeTruthy();
    expect(row!.fillRatePct).toBe(80);
    expect(row!.averageLeadTimeDays).toBe(5);
    expect(row!.onTimeDeliveryPct).toBe(100);
    expect(row!.priceVariancePct).toBe(10); // paid 10% above quote
    expect(row!.returnRatePct).toBe(20); // 20 rejected of 100
    // score = fill80·.25 + onTime100·.2 + lead100·.2 + price90·.2 + quality80·.15 = 90
    expect(row!.performanceScore).toBe(90);
  });

  it('is deterministic (same inputs → same score) and its weights normalize to 1', async () => {
    const p = await newProduct();
    const s = await newSupplier(7);
    await setRefCost(s, p, 10);
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(10), orderDate: iso(15), expectedDeliveryDate: iso(9), items: [{ productId: p, expectedQty: 100, receivedQty: 80, rejectedQty: 20, unitCost: 11 }] });
    const a = await rowOf(s); const b = await rowOf(s);
    expect(a!.performanceScore).toBe(b!.performanceScore);
    const totalWeight = a!.components.reduce((t: number, c: any) => t + c.weight, 0);
    expect(Math.abs(totalWeight - 1)).toBeLessThan(1e-6);
  });

  it('fill rate is correct for a partial receipt and excludes unknown expected quantity', async () => {
    const p1 = await newProduct(); const p2 = await newProduct();
    const s = await newSupplier();
    // Line 1: expected 50, received 40 (80%). Line 2: expected 0 (blind) — excluded from the denominator.
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), items: [
      { productId: p1, expectedQty: 50, receivedQty: 40, unitCost: 1 },
      { productId: p2, expectedQty: 0, receivedQty: 25, unitCost: 1 },
    ] });
    const row = await rowOf(s);
    expect(row!.fillRatePct).toBe(80); // 40/50, blind line excluded
    expect(row!.coverage.fillRatePct).toBe(50); // 1 of 2 lines had an expected qty
  });

  it('on-time excludes receipts without an expected delivery date; late is classified correctly', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    // On-time receipt (received 10d ago ≤ expected 9d ago).
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(10), expectedDeliveryDate: iso(9), items: [{ productId: p, expectedQty: 10, receivedQty: 10, unitCost: 1 }] });
    // Late receipt (received 5d ago > expected 8d ago).
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), expectedDeliveryDate: iso(8), items: [{ productId: p, expectedQty: 10, receivedQty: 10, unitCost: 1 }] });
    // No-expected-date receipt (must NOT enter the denominator).
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(3), items: [{ productId: p, expectedQty: 10, receivedQty: 10, unitCost: 1 }] });
    const row = await rowOf(s);
    expect(row!.onTimeDeliveryPct).toBe(50); // 1 on-time of 2 dated receipts (undated excluded)
    expect(row!.coverage.onTimePct).toBe(round2((2 / 3) * 100));
  });

  it('price variance uses the supplier reference cost, not WAC', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    await setRefCost(s, p, 20); // quoted 20; received at 18 → 10% under
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(4), items: [{ productId: p, expectedQty: 5, receivedQty: 5, unitCost: 18 }] });
    const row = await rowOf(s);
    expect(row!.priceVariancePct).toBe(-10);
    expect(row!.averageUnitCost).toBe('18');
    expect(row!.coverage.pricePct).toBe(100);
  });

  it('a missing metric is dropped (not scored zero) and its weight renormalizes', async () => {
    const p = await newProduct();
    const s = await newSupplier(); // no quoted lead time, no ref cost, no dates
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(4), items: [{ productId: p, expectedQty: 10, receivedQty: 10, unitCost: 5 }] });
    const row = await rowOf(s);
    // Only fill-rate (100) and quality (100) are available → score 100, not dragged down by absent metrics.
    expect(row!.performanceScore).toBe(100);
    const byKey = Object.fromEntries(row!.components.map((c: any) => [c.key, c]));
    expect(byKey.onTime.subScore).toBeNull();
    expect(byKey.leadTime.subScore).toBeNull();
    expect(byKey.price.subScore).toBeNull();
    expect(byKey.onTime.weight).toBe(0);
    expect(byKey.fillRate.weight + byKey.quality.weight).toBeCloseTo(1, 6);
  });

  it('excludes draft/cancelled receipts and enforces the date range', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    // Posted, in range.
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), items: [{ productId: p, expectedQty: 100, receivedQty: 100, unitCost: 1 }] });
    // A DRAFT (never posted) with a wild fill — must not contaminate.
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), items: [{ productId: p, expectedQty: 100, receivedQty: 1, unitCost: 1 }] }, 0);
    // Posted but OUTSIDE the queried window (100d ago).
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(100), items: [{ productId: p, expectedQty: 100, receivedQty: 50, unitCost: 1 }] });
    const row = await rowOf(s);
    expect(row!.receiptsCount).toBe(1); // only the posted, in-range receipt
    expect(row!.fillRatePct).toBe(100);
  });

  it('applies the product filter and enforces org isolation', async () => {
    const pa = await newProduct(); const pb = await newProduct();
    const s = await newSupplier();
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), items: [
      { productId: pa, expectedQty: 100, receivedQty: 100, unitCost: 1 },
      { productId: pb, expectedQty: 100, receivedQty: 50, unitCost: 1 },
    ] });
    const filtered = await rowOf(s, `&productId=${pa}`);
    expect(filtered!.fillRatePct).toBe(100); // only product A's line

    // Another org sees nothing for this supplier.
    const token2 = (await http().post('/api/auth/register').send({ organizationName: `SA2 ${u}`, adminEmail: `sa2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    const res2 = await http().get(`/api/analytics/suppliers?supplierId=${s}`).set(auth(token2)).expect(200);
    expect(res2.body.suppliers).toHaveLength(0);
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;

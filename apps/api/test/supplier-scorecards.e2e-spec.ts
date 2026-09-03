import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * 2D.4B — Scorecards + Trends. Org-configurable weights, period-over-period trends, product breakdown, and
 * an advisory preferred-vs-observed comparison off the authoritative InventoryPolicy.preferredSupplierId.
 */
describe('Supplier scorecards + trends (e2e, 2D.4B)', () => {
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

  const newProduct = async () => (await http().post('/api/products').set(auth()).send({ sku: sku('SB'), name: sku('SBN'), baseUomId: unitId }).expect(201)).body.id as string;
  const newSupplier = async (leadTimeDays = 0) => {
    const id = (await http().post('/api/suppliers').set(auth()).send({ code: sku('SUP'), companyName: `Co ${sku('c')}` }).expect(201)).body.id as string;
    if (leadTimeDays > 0) await prisma.supplier.update({ where: { id }, data: { leadTimeDays } });
    return id;
  };
  const setRefCost = (supplierId: string, productId: string, cost: number) =>
    prisma.supplierProduct.create({ data: { organizationId: orgId, supplierId, productId, cost } });
  const postReceipt = async (body: Record<string, unknown>) => {
    const draft = await http().post('/api/receiving').set(auth()).send(body).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };
  const line = (productId: string, expectedQty: number, receivedQty: number, unitCost = 1, rejectedQty = 0) => ({ productId, expectedQty, receivedQty, unitCost, rejectedQty });

  const compare = async (supplierId: string) =>
    (await http().get(`/api/analytics/suppliers?from=${iso(30)}&to=${iso(-1)}&supplierId=${supplierId}`).set(auth()).expect(200)).body.suppliers[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    token = (await http().post('/api/auth/register').send({ organizationName: `SB ${u}`, adminEmail: `sb_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'SBW', name: 'W' }).expect(201)).body.id;
    orgId = (await prisma.warehouse.findUniqueOrThrow({ where: { id: whId } })).organizationId;
  });

  afterAll(async () => { await app.close(); });

  it('applies org custom weights (need not sum to 1) and renormalizes over available metrics', async () => {
    const p = await newProduct();
    const s = await newSupplier(); // no lead-time benchmark, no ref cost, no dates → only fill + quality
    // Weights need not sum to 1; only fill + quality are available for this supplier.
    await http().put('/api/analytics/suppliers/policy').set(auth()).send({ fillRate: 30, onTime: 25, leadTime: 20, price: 15, quality: 10 }).expect(200);
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), items: [line(p, 100, 80, 1, 0)] });
    const row = await compare(s);
    // fill sub 80 (weight 30), quality sub 100 (weight 10) → 80·(30/40) + 100·(10/40) = 85
    expect(row.performanceScore).toBe(85);
    const byKey = Object.fromEntries(row.components.map((c: any) => [c.key, c]));
    expect(byKey.fillRate.configuredWeight).toBe(30);
    expect(byKey.fillRate.appliedWeight).toBeCloseTo(0.75, 4);
    expect(byKey.quality.appliedWeight).toBeCloseTo(0.25, 4);
    expect(byKey.onTime.appliedWeight).toBe(0); // dropped, not zero-scored
    expect(byKey.fillRate.rawMetric).toBe(80);
    // Reset to defaults for later tests.
    await http().put('/api/analytics/suppliers/policy').set(auth()).send({ fillRate: 0.25, onTime: 0.2, leadTime: 0.2, price: 0.2, quality: 0.15 }).expect(200);
  });

  it('rejects an all-zero weight config and isolates the policy per organization', async () => {
    await http().put('/api/analytics/suppliers/policy').set(auth()).send({ fillRate: 0, onTime: 0, leadTime: 0, price: 0, quality: 0 }).expect(400);
    // Another org keeps its own defaults, unaffected by this org's policy.
    const token2 = (await http().post('/api/auth/register').send({ organizationName: `SB2 ${u}`, adminEmail: `sb2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    const pol2 = (await http().get('/api/analytics/suppliers/policy').set(auth(token2)).expect(200)).body;
    expect(pol2).toMatchObject({ fillRate: 0.25, quality: 0.15, configured: false });
  });

  it('scorecard trends use equal-length prior windows with correct deltas and direction metadata', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    // Previous window (≈40d ago): fill 60. Current window (≈10d ago): fill 90.
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(40), items: [line(p, 100, 60)] });
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(10), items: [line(p, 100, 90)] });

    const sc = (await http().get(`/api/analytics/suppliers/${s}/scorecard?from=${iso(30)}&to=${iso(0)}`).set(auth()).expect(200)).body;
    const lengthCurr = new Date(sc.period.end).getTime() - new Date(sc.period.start).getTime();
    const lengthPrev = new Date(sc.previousPeriod.end).getTime() - new Date(sc.previousPeriod.start).getTime();
    expect(Math.abs(lengthCurr - lengthPrev)).toBeLessThan(1000); // equal length (±1s)
    expect(new Date(sc.previousPeriod.end).getTime()).toBeLessThanOrEqual(new Date(sc.period.start).getTime());

    const trends = Object.fromEntries(sc.trends.map((t: any) => [t.key, t]));
    expect(trends.fillRate.current).toBe(90);
    expect(trends.fillRate.previous).toBe(60);
    expect(trends.fillRate.delta).toBe(30);
    expect(trends.fillRate.higherIsBetter).toBe(true);
    // Lower-is-better metrics are tagged as such.
    expect(trends.leadTime.higherIsBetter).toBe(false);
    expect(trends.price.higherIsBetter).toBe(false);
    expect(trends.quality.higherIsBetter).toBe(false);
    // Coverage travels alongside the value, separately.
    expect(trends.onTime).toHaveProperty('currentCoveragePct');
    expect(trends.onTime).toHaveProperty('previousCoveragePct');
  });

  it('product breakdown reconciles to the supplier aggregate and keeps the metric definitions', async () => {
    const p1 = await newProduct(); const p2 = await newProduct();
    const s = await newSupplier();
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(8), items: [line(p1, 100, 100), line(p2, 100, 50)] });

    const sc = (await http().get(`/api/analytics/suppliers/${s}/scorecard?from=${iso(30)}&to=${iso(0)}`).set(auth()).expect(200)).body;
    const totalReceived = sc.products.reduce((t: number, r: any) => t + Number(r.receivedQuantity), 0);
    expect(totalReceived).toBe(Number(sc.supplier.receivedQuantity)); // reconciles
    const byProduct = Object.fromEntries(sc.products.map((r: any) => [r.productId, r]));
    expect(byProduct[p1].fillRatePct).toBe(100);
    expect(byProduct[p2].fillRatePct).toBe(50); // same fill-rate definition, per product
    expect(sc.supplier.receiptsCount).toBe(1);
    expect(sc.supplier.linesCount).toBe(2);
    expect(sc.supplier.sampleLabel).toBe('LOW_SAMPLE');
  });

  it('preferred comparison uses the authoritative preferredSupplierId, ignores Supplier.isPreferred, and never rewrites it', async () => {
    const p = await newProduct();
    const preferred = await newSupplier(); // will be the InventoryPolicy preference, but the WEAKER performer
    const rival = await newSupplier();
    const decoy = await newSupplier();
    // Descriptive flag on a supplier that is NOT the operational preference — must not drive the comparison.
    await prisma.supplier.update({ where: { id: decoy }, data: { isPreferred: true } });
    // Authoritative operational preference.
    await prisma.inventoryPolicy.create({ data: { organizationId: orgId, warehouseId: whId, productId: p, variantId: NIL, preferredSupplierId: preferred } });

    await postReceipt({ warehouseId: whId, supplierId: preferred, receivingDate: iso(6), items: [line(p, 100, 70)] }); // fill 70
    await postReceipt({ warehouseId: whId, supplierId: rival, receivingDate: iso(6), items: [line(p, 100, 98)] }); // fill 98 (better)

    const res = (await http().get(`/api/analytics/suppliers/preferred-comparison?from=${iso(30)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    const row = res.rows.find((r: any) => r.productId === p);
    expect(row).toBeTruthy();
    expect(row.preferredSupplierId).toBe(preferred); // authoritative, not the isPreferred decoy
    expect(row.bestSupplierId).toBe(rival); // best observed from comparable scoped data
    expect(row.difference).toBeGreaterThan(0); // an alternative is outperforming
    expect(row.bestSupplierId).not.toBe(decoy);

    // Advisory only — the stored preference is untouched.
    const pol = await prisma.inventoryPolicy.findFirstOrThrow({ where: { organizationId: orgId, productId: p, warehouseId: whId } });
    expect(pol.preferredSupplierId).toBe(preferred);
  });
});

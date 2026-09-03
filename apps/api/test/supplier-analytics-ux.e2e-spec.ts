import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 2D.4C — Supplier Analytics UX (presentation + drill-down). Time-series trends and metric evidence over the
 * frozen 2D.4A/B engine — no new scoring. Every bucket and drill-down uses the exact same metric definitions.
 */
describe('Supplier analytics UX (e2e, 2D.4C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let viewerToken: string;
  let orgId: string;
  let unitId: string;
  let whId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

  const newProduct = async () => (await http().post('/api/products').set(auth()).send({ sku: sku('UX'), name: sku('UXN'), baseUomId: unitId }).expect(201)).body.id as string;
  const newSupplier = async () => (await http().post('/api/suppliers').set(auth()).send({ code: sku('SUP'), companyName: `Co ${sku('c')}` }).expect(201)).body.id as string;
  const setRefCost = (supplierId: string, productId: string, cost: number) => prisma.supplierProduct.create({ data: { organizationId: orgId, supplierId, productId, cost } });
  const line = (productId: string, expectedQty: number, receivedQty: number, unitCost = 1, rejectedQty = 0) => ({ productId, expectedQty, receivedQty, unitCost, rejectedQty });
  const postReceipt = async (body: Record<string, unknown>) => {
    const draft = await http().post('/api/receiving').set(auth()).send(body).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    return draft.body.id as string;
  };
  const compareRow = async (supplierId: string, t = token) =>
    (await http().get(`/api/analytics/suppliers?from=${iso(200)}&to=${iso(-1)}&supplierId=${supplierId}`).set(auth(t)).expect(200)).body.suppliers[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    token = (await http().post('/api/auth/register').send({ organizationName: `UX ${u}`, adminEmail: `ux_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'UXW', name: 'W' }).expect(201)).body.id;
    orgId = (await prisma.warehouse.findUniqueOrThrow({ where: { id: whId } })).organizationId;
    // A viewer has report.view (can see analytics) but NOT cost.view (blocked from price drill-down).
    const vEmail = `uxv_${u}@x.test`;
    await http().post('/api/users').set(auth()).send({ email: vEmail, name: 'Viewer', roleKey: 'viewer', password: 'password123' }).expect(201);
    viewerToken = (await http().post('/api/auth/login').send({ email: vEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('trend buckets reconcile to the scorecard and carry direction metadata + per-bucket coverage/sample', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), expectedDeliveryDate: iso(4), items: [line(p, 100, 80)] });
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(9), expectedDeliveryDate: iso(8), items: [line(p, 100, 90)] });

    const series = (await http().get(`/api/analytics/suppliers/${s}/trends?from=${iso(200)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    expect(series.granularity).toBe('MONTHLY'); // >180d
    // Direction metadata preserved.
    const meta = Object.fromEntries(series.metrics.map((m: any) => [m.key, m.higherIsBetter]));
    expect(meta.fillRate).toBe(true); expect(meta.leadTime).toBe(false); expect(meta.price).toBe(false);
    // Buckets carry coverage + sample.
    const active = series.buckets.filter((b: any) => b.receiptsCount > 0);
    expect(active.every((b: any) => b.coverage && typeof b.receiptsCount === 'number')).toBe(true);
    // Σ bucket receipts == scorecard receipts; the bucket holding both receipts uses the same fill definition.
    const totalReceipts = series.buckets.reduce((t: number, b: any) => t + b.receiptsCount, 0);
    const row = await compareRow(s);
    expect(totalReceipts).toBe(row.receiptsCount);
    const both = active.find((b: any) => b.receiptsCount === 2);
    expect(both.fillRatePct).toBe(row.fillRatePct); // 170/200 = 85
    expect(both.coverage.onTimePct).toBe(100);
  });

  it('on-time evidence includes only dated receipts and reconciles numerator/denominator to the metric', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(10), expectedDeliveryDate: iso(9), items: [line(p, 10, 10)] }); // on-time
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(5), expectedDeliveryDate: iso(8), items: [line(p, 10, 10)] }); // late
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(3), items: [line(p, 10, 10)] }); // undated — excluded

    const ev = (await http().get(`/api/analytics/suppliers/${s}/evidence?metric=ON_TIME&from=${iso(200)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    expect(ev.records).toHaveLength(2); // only dated receipts
    expect(ev.denominator).toBe(2);
    expect(ev.numerator).toBe(1);
    expect(ev.value).toBe(50);
    const row = await compareRow(s);
    expect(ev.value).toBe(row.onTimeDeliveryPct); // reconciles to the displayed metric
  });

  it('fill-rate evidence reconciles and respects the product filter', async () => {
    const p1 = await newProduct(); const p2 = await newProduct();
    const s = await newSupplier();
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(6), items: [line(p1, 100, 100), line(p2, 100, 40)] });
    const evAll = (await http().get(`/api/analytics/suppliers/${s}/evidence?metric=FILL_RATE&from=${iso(200)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    expect(evAll.numerator).toBe(140); expect(evAll.denominator).toBe(200); expect(evAll.value).toBe(70);
    const evP1 = (await http().get(`/api/analytics/suppliers/${s}/evidence?metric=FILL_RATE&productId=${p1}&from=${iso(200)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    expect(evP1.records).toHaveLength(1);
    expect(evP1.value).toBe(100); // filter propagates, same definition
  });

  it('price drill-down is gated by cost.view and exposes cost fields when permitted', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    await setRefCost(s, p, 10);
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(6), items: [line(p, 5, 5, 11)] });
    // Viewer (report.view, no cost.view) is blocked from the price drill-down.
    await http().get(`/api/analytics/suppliers/${s}/evidence?metric=PRICE&from=${iso(200)}&to=${iso(-1)}`).set(auth(viewerToken)).expect(403);
    // Admin (cost.view) gets the cost detail.
    const ev = (await http().get(`/api/analytics/suppliers/${s}/evidence?metric=PRICE&from=${iso(200)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    expect(ev.records[0].unitCost).toBe('11');
    expect(ev.records[0].referenceCost).toBe('10');
    expect(ev.value).toBe(10); // +10% vs quote — reconciles to price variance
    // A non-cost metric stays open to the viewer.
    await http().get(`/api/analytics/suppliers/${s}/evidence?metric=FILL_RATE&from=${iso(200)}&to=${iso(-1)}`).set(auth(viewerToken)).expect(200);
  });

  it('a missing metric stays null (not zero) and evidence stays drillable after product archival + across orgs', async () => {
    const p = await newProduct();
    const s = await newSupplier();
    await postReceipt({ warehouseId: whId, supplierId: s, receivingDate: iso(6), items: [line(p, 10, 10)] }); // no dates/ref cost
    const row = await compareRow(s);
    expect(row.onTimeDeliveryPct).toBeNull(); // missing, not 0
    expect(row.priceVariancePct).toBeNull();

    // Archive the product — historical evidence remains drillable.
    await prisma.product.update({ where: { id: p }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    const ev = (await http().get(`/api/analytics/suppliers/${s}/evidence?metric=FILL_RATE&from=${iso(200)}&to=${iso(-1)}`).set(auth()).expect(200)).body;
    expect(ev.records).toHaveLength(1);
    expect(ev.value).toBe(100);

    // Another org sees no evidence for this supplier.
    const token2 = (await http().post('/api/auth/register').send({ organizationName: `UX2 ${u}`, adminEmail: `ux2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    const ev2 = (await http().get(`/api/analytics/suppliers/${s}/evidence?metric=FILL_RATE&from=${iso(200)}&to=${iso(-1)}`).set(auth(token2)).expect(200)).body;
    expect(ev2.records).toHaveLength(0);
  });
});

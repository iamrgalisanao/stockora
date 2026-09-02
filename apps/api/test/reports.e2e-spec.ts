import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;

  const bearer = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (
      await http()
        .post('/api/auth/register')
        .send({ organizationName: `Rep ${unique}`, adminEmail: `rep_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    const unitId = (await http().post('/api/units').set(bearer()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    const warehouseId = (await http().post('/api/warehouses').set(bearer()).send({ code: 'RW', name: 'W' }).expect(201)).body.id;
    const catId = (await http().post('/api/categories').set(bearer()).send({ name: 'Storage' }).expect(201)).body.id;

    const a = (await http().post('/api/products').set(bearer()).send({ sku: 'A-1', name: 'A', baseUomId: unitId, categoryId: catId, cost: 100 }).expect(201)).body.id;
    const b = (await http().post('/api/products').set(bearer()).send({ sku: 'B-1', name: 'B', baseUomId: unitId, cost: 50 }).expect(201)).body.id;

    await http().post('/api/inventory/opening-balances').set(bearer())
      .send({ warehouseId, lines: [{ productId: a, quantity: 10, unitCost: 100 }, { productId: b, quantity: 100, unitCost: 50 }] })
      .expect(201);

    // Stock-status is now policy-driven: A-1 has a reorder point above its stock, B-1 is comfortable.
    await http().post(`/api/products/${a}/policies`).set(bearer()).send({ warehouseId, reorderPoint: 15, reorderQuantity: 20 }).expect(201);
    await http().post(`/api/products/${b}/policies`).set(bearer()).send({ warehouseId, reorderPoint: 5, reorderQuantity: 20 }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('values inventory grouped by warehouse and by category', async () => {
    const byWh = await http().get('/api/reports/valuation?groupBy=warehouse').set(bearer()).expect(200);
    expect(byWh.body.totalValue).toBe('6000'); // 10*100 + 100*50
    expect(byWh.body.rows.length).toBe(1);

    const byCat = await http().get('/api/reports/valuation?groupBy=category').set(bearer()).expect(200);
    const labels = byCat.body.rows.map((r: { label: string; value: string }) => `${r.label}:${r.value}`);
    expect(labels).toContain('Storage:1000');
    expect(labels).toContain('Uncategorized:5000');

    await http().get('/api/reports/valuation?groupBy=bogus').set(bearer()).expect(400);
  });

  it('classifies stock status (reorder state) and filters by it', async () => {
    const all = await http().get('/api/reports/stock-status').set(bearer()).expect(200);
    const a = all.body.find((r: { productSku: string }) => r.productSku === 'A-1');
    const b = all.body.find((r: { productSku: string }) => r.productSku === 'B-1');
    expect(a.state).toBe('REORDER_REQUIRED'); // 10 available <= reorderPoint 15
    expect(b.state).toBe('OK');

    const req = await http().get('/api/reports/stock-status?state=REORDER_REQUIRED').set(bearer()).expect(200);
    expect(req.body.every((r: { state: string }) => r.state === 'REORDER_REQUIRED')).toBe(true);
    expect(req.body.map((r: { productSku: string }) => r.productSku)).toContain('A-1');

    await http().get('/api/reports/stock-status?state=BOGUS').set(bearer()).expect(400);
  });

  it('lists dead stock (never issued) with value', async () => {
    const dead = await http().get('/api/reports/dead-stock?days=0').set(bearer()).expect(200);
    const skus = dead.body.map((r: { sku: string }) => r.sku);
    expect(skus).toEqual(expect.arrayContaining(['A-1', 'B-1']));
    const a = dead.body.find((r: { sku: string }) => r.sku === 'A-1');
    expect(a.lastOutboundAt).toBeNull();
    expect(a.daysSinceOutbound).toBeNull();
    expect(a.value).toBe('1000'); // 10 * 100
  });
});

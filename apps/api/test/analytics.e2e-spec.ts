import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics — reorder + dashboard (e2e, policy-driven)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let lowProductId: string;
  let okProductId: string;
  let warehouseId: string;

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
        .send({ organizationName: `An ${unique}`, adminEmail: `an_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    const unitId = (await http().post('/api/units').set(bearer()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(bearer()).send({ code: 'AW', name: 'W' }).expect(201)).body.id;

    lowProductId = (
      await http().post('/api/products').set(bearer())
        .send({ sku: 'LOW-1', name: 'Low Product', baseUomId: unitId, cost: 100 })
        .expect(201)
    ).body.id;
    okProductId = (
      await http().post('/api/products').set(bearer())
        .send({ sku: 'OK-1', name: 'Ok Product', baseUomId: unitId, cost: 50 })
        .expect(201)
    ).body.id;

    await http().post('/api/inventory/opening-balances').set(bearer())
      .send({ warehouseId, lines: [{ productId: lowProductId, quantity: 10, unitCost: 100 }, { productId: okProductId, quantity: 100, unitCost: 50 }] })
      .expect(201);

    // Warehouse-level policies drive reorder now (2A.1C).
    await http().post(`/api/products/${lowProductId}/policies`).set(bearer())
      .send({ warehouseId, reorderPoint: 15, reorderQuantity: 30 }).expect(201);
    await http().post(`/api/products/${okProductId}/policies`).set(bearer())
      .send({ warehouseId, reorderPoint: 5, reorderQuantity: 20 }).expect(201);

    // A draft receipt keeps pending.receipts non-zero (does not post stock).
    await http().post('/api/receiving').set(bearer())
      .send({ warehouseId, items: [{ productId: lowProductId, expectedQty: 50, receivedQty: 0, unitCost: 100 }] })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('recommends only (warehouse, product) below reorder point using available stock', async () => {
    const res = await http().get('/api/reorder/recommendations').set(bearer()).expect(200);
    const skus = res.body.map((r: { productSku: string }) => r.productSku);
    expect(skus).toContain('LOW-1');
    expect(skus).not.toContain('OK-1'); // 100 available, reorder point 5

    const low = res.body.find((r: { productSku: string }) => r.productSku === 'LOW-1');
    expect(low.warehouseCode).toBe('AW');
    expect(low.available).toBe('10');
    expect(low.inTransit).toBe('0');
    expect(low.state).toBe('REORDER_REQUIRED');
    expect(low.recommendedQuantity).toBe('30'); // reorderQuantity
    expect(low.estimatedCost).toBe('3000'); // 30 * 100 (admin has cost.view)
  });

  it('summarizes the dashboard KPIs from the policy-driven assessment', async () => {
    const res = await http().get('/api/dashboard/summary').set(bearer()).expect(200);
    expect(res.body.totalSkus).toBe(2);
    expect(res.body.totalOnHand).toBe('110'); // 10 + 100
    expect(res.body.reorderCount).toBe(1); // only LOW-1
    expect(res.body.lowStockCount).toBe(0); // LOW_STOCK is distinct from REORDER_REQUIRED
    expect(res.body.outOfStockCount).toBe(0);
    expect(res.body.inventoryValue).toBe('6000'); // 10*100 + 100*50
    expect(res.body.pending.receipts).toBe(1); // the draft receipt
    expect(res.body.recentMovements.length).toBeGreaterThan(0);
  });
});

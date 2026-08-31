import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Phase 05/06/09 HTTP acceptance: suppliers, warehouses + scope filtering, and the
 * opening-balance posting endpoint with idempotency + stock card + reconcile.
 */
describe('Inventory HTTP (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let adminToken: string;
  let unitId: string;
  let productId: string;
  let warehouse1: string;
  let warehouse2: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const reg = await http()
      .post('/api/auth/register')
      .send({
        organizationName: `Inv ${unique}`,
        adminEmail: `inv_${unique}@example.test`,
        adminName: 'Admin',
        adminPassword: 'password123',
      })
      .expect(201);
    adminToken = reg.body.accessToken;

    unitId = (await http().post('/api/units').set(auth(adminToken)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (
      await http()
        .post('/api/products')
        .set(auth(adminToken))
        .send({ sku: 'WIDGET-1', name: 'Widget', baseUomId: unitId })
        .expect(201)
    ).body.id;
    warehouse1 = (await http().post('/api/warehouses').set(auth(adminToken)).send({ code: 'WH1', name: 'Main' }).expect(201)).body.id;
    warehouse2 = (await http().post('/api/warehouses').set(auth(adminToken)).send({ code: 'WH2', name: 'Branch' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a supplier and links a product', async () => {
    const supplier = await http()
      .post('/api/suppliers')
      .set(auth(adminToken))
      .send({ code: 'SUP1', companyName: 'ACME Distribution', leadTimeDays: 7 })
      .expect(201);
    await http()
      .post(`/api/suppliers/${supplier.body.id}/products`)
      .set(auth(adminToken))
      .send({ productId, cost: 2950, leadTimeDays: 7 })
      .expect(201);
    const links = await http().get(`/api/suppliers/${supplier.body.id}/products`).set(auth(adminToken)).expect(200);
    expect(links.body[0].productSku).toBe('WIDGET-1');
    expect(links.body[0].cost).toBe('2950'); // admin has cost.view
  });

  it('creates a warehouse location', async () => {
    const loc = await http()
      .post(`/api/warehouses/${warehouse1}/locations`)
      .set(auth(adminToken))
      .send({ code: 'A-01-01', type: 'BIN' })
      .expect(201);
    expect(loc.body.code).toBe('A-01-01');
  });

  it('posts an opening balance and is idempotent', async () => {
    const key = `open-${unique}`;
    const body = { warehouseId: warehouse1, lines: [{ productId, quantity: 100, unitCost: 100 }] };

    await http().post('/api/inventory/opening-balances').set(auth(adminToken)).set('Idempotency-Key', key).send(body).expect(201);
    // Replay with the same key must NOT double the stock.
    await http().post('/api/inventory/opening-balances').set(auth(adminToken)).set('Idempotency-Key', key).send(body).expect(201);

    const balances = await http()
      .get(`/api/inventory/balances?productId=${productId}`)
      .set(auth(adminToken))
      .expect(200);
    const wh1 = balances.body.find((b: { warehouseId: string }) => b.warehouseId === warehouse1);
    expect(wh1.onHand).toBe('100'); // once, not 200
    expect(wh1.available).toBe('100');
    expect(wh1.avgCost).toBe('100');
    expect(wh1.value).toBe('10000');
  });

  it('serves a stock card and reconciles clean', async () => {
    const card = await http()
      .get(`/api/inventory/products/${productId}/stock-card?warehouseId=${warehouse1}`)
      .set(auth(adminToken))
      .expect(200);
    expect(card.body.entries.length).toBe(1);
    expect(card.body.entries[0].in).toBe('100');
    expect(card.body.closingBalance).toBe('100');

    const recon = await http().post('/api/inventory/reconcile').set(auth(adminToken)).expect(201);
    expect(recon.body.ok).toBe(true);
  });

  it('enforces warehouse scope for a scoped user', async () => {
    // Create a warehouse-staff user restricted to warehouse1.
    const staffEmail = `staff_${unique}@example.test`;
    await http()
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        email: staffEmail,
        name: 'Scoped Staff',
        roleKey: 'warehouse_staff',
        warehouseScope: [warehouse1],
        password: 'password123',
      })
      .expect(201);
    const staffToken = (
      await http().post('/api/auth/login').send({ email: staffEmail, password: 'password123' }).expect(200)
    ).body.accessToken;

    const list = await http().get('/api/warehouses').set(auth(staffToken)).expect(200);
    const ids = list.body.map((w: { id: string }) => w.id);
    expect(ids).toContain(warehouse1);
    expect(ids).not.toContain(warehouse2); // outside scope

    // Scoped user cannot view the out-of-scope warehouse directly.
    await http().get(`/api/warehouses/${warehouse2}`).set(auth(staffToken)).expect(404);

    // Staff has no cost.view: balances omit avgCost.
    const balances = await http().get('/api/inventory/balances').set(auth(staffToken)).expect(200);
    if (balances.body.length > 0) {
      expect(balances.body[0].avgCost).toBeUndefined();
    }
  });
});

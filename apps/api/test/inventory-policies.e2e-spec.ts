import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Inventory Policies — invariants (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let unitId: string;
  let whMain: string;
  let whOther: string;

  const bearer = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  const newProduct = async (sku: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/products').set(bearer()).send({ sku, name: sku, baseUomId: unitId, cost: 10, ...extra }).expect(201)).body.id;

  const openingBalance = (productId: string, warehouseId: string, quantity: number) =>
    http().post('/api/inventory/opening-balances').set(bearer())
      .send({ warehouseId, lines: [{ productId, quantity, unitCost: 10 }] }).expect(201);

  const assess = async (state?: string) =>
    (await http().get(`/api/reports/stock-status${state ? `?state=${state}` : ''}`).set(bearer()).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Pol ${unique}`, adminEmail: `pol_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    unitId = (await http().post('/api/units').set(bearer()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whMain = (await http().post('/api/warehouses').set(bearer()).send({ code: 'MN', name: 'Main' }).expect(201)).body.id;
    whOther = (await http().post('/api/warehouses').set(bearer()).send({ code: 'OT', name: 'Other' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('validates thresholds: reorderQuantity > 0 and maxStock ≥ reorderPoint/minStock', async () => {
    const p = await newProduct(`VAL-${unique}`);
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 5, reorderQuantity: 0 }).expect(400); // qty must be > 0
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 20, reorderQuantity: 5, maxStock: 10 }).expect(400); // max < reorderPoint
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, minStock: 30, reorderPoint: 5, reorderQuantity: 5, maxStock: 10 }).expect(400); // max < minStock
    // A valid one succeeds.
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, minStock: 5, reorderPoint: 10, reorderQuantity: 5, maxStock: 50 }).expect(201);
  });

  it('rejects a variant that does not belong to the product', async () => {
    const owner = await newProduct(`OWN-${unique}`);
    const other = await newProduct(`OTH-${unique}`);
    const foreignVariant = (await http().post(`/api/products/${other}/variants`).set(bearer()).send({ sku: `OTHV-${unique}` }).expect(201)).body.id;
    await http().post(`/api/products/${owner}/policies`).set(bearer())
      .send({ warehouseId: whMain, variantId: foreignVariant, reorderPoint: 5, reorderQuantity: 5 }).expect(400);
  });

  it('rejects a duplicate policy for the same (warehouse, variant)', async () => {
    const p = await newProduct(`DUP-${unique}`);
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 5, reorderQuantity: 5 }).expect(201);
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 9, reorderQuantity: 9 }).expect(409);
  });

  it('surfaces in-transit without counting it (INBOUND_COVERED)', async () => {
    const p = await newProduct(`COVER-${unique}`);
    await openingBalance(p, whMain, 100);
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 80, reorderQuantity: 10 }).expect(201);

    // 100 available > 80 → OK before shipping anything.
    let rows = await assess();
    expect(rows.find((r: { productSku: string }) => r.productSku === `COVER-${unique}`).state).toBe('OK');

    // Ship 40 out of Main: onHand 60, inTransit 40.
    const tr = (await http().post('/api/transfers').set(bearer())
      .send({ sourceWarehouseId: whMain, destWarehouseId: whOther, items: [{ productId: p, quantity: 40 }] }).expect(201)).body.id;
    await http().post(`/api/transfers/${tr}/submit`).set(bearer()).expect(201);
    await http().post(`/api/transfers/${tr}/approve`).set(bearer()).expect(201);
    await http().post(`/api/transfers/${tr}/dispatch`).set(bearer()).expect(201);

    rows = await assess();
    const row = rows.find((r: { productSku: string }) => r.productSku === `COVER-${unique}`);
    expect(row.available).toBe('60'); // in-transit NOT added
    expect(row.inTransit).toBe('40');
    expect(row.state).toBe('INBOUND_COVERED'); // 60 available ≤ 80 but 60 + 40 in-transit > 80
  });

  it('ignores INACTIVE policies in the assessment', async () => {
    const p = await newProduct(`POLINACT-${unique}`);
    await openingBalance(p, whMain, 5);
    const policyId = (await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 15, reorderQuantity: 5 }).expect(201)).body.id;

    let req = await assess('REORDER_REQUIRED');
    expect(req.map((r: { productSku: string }) => r.productSku)).toContain(`POLINACT-${unique}`);

    await http().post(`/api/inventory-policies/${policyId}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);

    req = await assess('REORDER_REQUIRED');
    expect(req.map((r: { productSku: string }) => r.productSku)).not.toContain(`POLINACT-${unique}`);
  });

  it('excludes non-ACTIVE products from the assessment', async () => {
    const p = await newProduct(`PRODINACT-${unique}`);
    await openingBalance(p, whMain, 5);
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 15, reorderQuantity: 5 }).expect(201);

    let req = await assess('REORDER_REQUIRED');
    expect(req.map((r: { productSku: string }) => r.productSku)).toContain(`PRODINACT-${unique}`);

    await http().post(`/api/products/${p}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);

    req = await assess('REORDER_REQUIRED');
    expect(req.map((r: { productSku: string }) => r.productSku)).not.toContain(`PRODINACT-${unique}`);
  });

  it('audits policy creation and updates', async () => {
    const p = await newProduct(`AUD-${unique}`);
    const policyId = (await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId: whMain, reorderPoint: 5, reorderQuantity: 5 }).expect(201)).body.id;
    await http().patch(`/api/inventory-policies/${policyId}`).set(bearer()).send({ reorderPoint: 8 }).expect(200);

    const audit = (await http().get(`/api/audit?entityType=inventory_policy&entityId=${policyId}`).set(bearer()).expect(200)).body.entries;
    const actions = audit.map((a: { action: string }) => a.action);
    expect(actions).toContain('inventory_policy.created');
    expect(actions).toContain('inventory_policy.updated');
  });
});

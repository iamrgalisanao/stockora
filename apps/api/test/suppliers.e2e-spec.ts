import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Suppliers — lifecycle, catalog & archive guard (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let unitId: string;
  let warehouseId: string;
  let productId: string;

  const bearer = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  const newProduct = async (sku: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/products').set(bearer()).send({ sku, name: sku, baseUomId: unitId, cost: 10, ...extra }).expect(201)).body.id;
  const newSupplier = async (code: string) =>
    (await http().post('/api/suppliers').set(bearer()).send({ code, companyName: `${code} Co` }).expect(201)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Sup ${unique}`, adminEmail: `sup_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    unitId = (await http().post('/api/units').set(bearer()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(bearer()).send({ code: 'MN', name: 'Main' }).expect(201)).body.id;
    productId = await newProduct(`WIDGET-${unique}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates with ACTIVE status, searches, filters, and audits', async () => {
    const s = await newSupplier(`ACME-${unique}`);
    expect(s.status).toBe('ACTIVE');

    const byName = await http().get(`/api/suppliers?q=ACME-${unique}`).set(bearer()).expect(200);
    expect(byName.body.map((x: { id: string }) => x.id)).toContain(s.id);

    await http().post(`/api/suppliers/${s.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);
    const active = await http().get('/api/suppliers?status=ACTIVE').set(bearer()).expect(200);
    expect(active.body.map((x: { id: string }) => x.id)).not.toContain(s.id);
    const inactive = await http().get('/api/suppliers?status=INACTIVE').set(bearer()).expect(200);
    expect(inactive.body.map((x: { id: string }) => x.id)).toContain(s.id);

    const audit = (await http().get(`/api/audit?entityType=supplier&entityId=${s.id}`).set(bearer()).expect(200)).body.entries;
    const actions = audit.map((a: { action: string }) => a.action);
    expect(actions).toContain('supplier.created');
    expect(actions).toContain('supplier.status_changed');
  });

  it('rejects a duplicate supplier code', async () => {
    await newSupplier(`DUP-${unique}`);
    await http().post('/api/suppliers').set(bearer()).send({ code: `DUP-${unique}`, companyName: 'Dup' }).expect(409);
  });

  it('manages the supplier catalog (link, duplicate, update, lifecycle) with audit', async () => {
    const s = await newSupplier(`CAT-${unique}`);
    const link = (await http().post(`/api/suppliers/${s.id}/products`).set(bearer())
      .send({ productId, cost: 42, supplierSku: 'V-SKU', minOrderQty: 5 }).expect(201)).body;
    expect(link.status).toBe('ACTIVE');
    expect(link.cost).toBe('42'); // admin has cost.view

    // Duplicate link for same product rejected.
    await http().post(`/api/suppliers/${s.id}/products`).set(bearer()).send({ productId }).expect(409);

    await http().patch(`/api/suppliers/${s.id}/products/${link.id}`).set(bearer()).send({ cost: 45 }).expect(200);
    const deact = (await http().post(`/api/suppliers/${s.id}/products/${link.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201)).body;
    expect(deact.status).toBe('INACTIVE');

    const audit = (await http().get(`/api/audit?entityType=supplier_product&entityId=${link.id}`).set(bearer()).expect(200)).body.entries;
    const actions = audit.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['supplier_product.linked', 'supplier_product.updated', 'supplier_product.status_changed']));
  });

  it('blocks archive while the supplier is preferred on a product', async () => {
    const s = await newSupplier(`PREF-P-${unique}`);
    await newProduct(`PP-${unique}`, { preferredSupplierId: s.id });
    await http().post(`/api/suppliers/${s.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('blocks archive while the supplier is preferred on an inventory policy', async () => {
    const s = await newSupplier(`PREF-POL-${unique}`);
    const p = await newProduct(`POLP-${unique}`);
    await http().post(`/api/products/${p}/policies`).set(bearer())
      .send({ warehouseId, reorderPoint: 5, reorderQuantity: 5, preferredSupplierId: s.id }).expect(201);
    await http().post(`/api/suppliers/${s.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('blocks archive while an open goods receipt references the supplier', async () => {
    const s = await newSupplier(`REC-${unique}`);
    await http().post('/api/receiving').set(bearer())
      .send({ warehouseId, supplierId: s.id, items: [{ productId, expectedQty: 5, receivedQty: 0, unitCost: 10 }] }).expect(201);
    await http().post(`/api/suppliers/${s.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('archives an unreferenced supplier and then refuses to reactivate it', async () => {
    const s = await newSupplier(`FREE-${unique}`);
    const archived = (await http().post(`/api/suppliers/${s.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(201)).body;
    expect(archived.status).toBe('ARCHIVED');
    await http().post(`/api/suppliers/${s.id}/status`).set(bearer()).send({ status: 'ACTIVE' }).expect(400);
  });
});

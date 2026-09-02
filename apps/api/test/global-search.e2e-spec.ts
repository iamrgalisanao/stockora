import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Global Search (e2e)', () => {
  let app: INestApplication;
  const u = Date.now();
  let adminA: string;
  let adminB: string;
  let managerX: string;
  let unitId: string;
  let whX: string;
  let whY: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const search = async (t: string, q: string) =>
    (await http().get(`/api/search?q=${encodeURIComponent(q)}`).set(auth(t)).expect(200)).body as Array<Record<string, unknown>>;

  const product = async (t: string, sku: string, name: string) =>
    (await http().post('/api/products').set(auth(t)).send({ sku, name, baseUomId: unitId }).expect(201)).body.id;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const reg = async (org: string) =>
      (await http().post('/api/auth/register')
        .send({ organizationName: org, adminEmail: `${org}_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)).body.accessToken;
    adminA = await reg(`SrchA${u}`);
    adminB = await reg(`SrchB${u}`);

    unitId = (await http().post('/api/units').set(auth(adminA)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whX = (await http().post('/api/warehouses').set(auth(adminA)).send({ code: `WHX${u}`, name: 'Depot X' }).expect(201)).body.id;
    whY = (await http().post('/api/warehouses').set(auth(adminA)).send({ code: `WHY${u}`, name: 'Depot Y' }).expect(201)).body.id;

    const mEmail = `mgr_${u}@x.test`;
    await http().post('/api/users').set(auth(adminA))
      .send({ email: mEmail, name: 'Mgr', roleKey: 'warehouse_manager', password: 'password123', warehouseScope: [whX] }).expect(201);
    managerX = (await http().post('/api/auth/login').send({ email: mEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ranks an exact SKU match above a name-contains match', async () => {
    const token = `MATCH${u}`;
    const exact = await product(adminA, token, 'Something Else');
    await product(adminA, `OTHER-${u}`, `${token} Deluxe Edition`); // name contains the token
    const res = await search(adminA, token);
    expect(res[0]!.entityId).toBe(exact);
    expect(res[0]!.rank).toBe(0);
  });

  it('resolves an exact barcode match first', async () => {
    const code = `BC${u}`;
    const p = await product(adminA, `HASBC-${u}`, 'Boxed Item');
    await http().post(`/api/products/${p}/barcodes`).set(auth(adminA)).send({ code }).expect(201);
    await product(adminA, `NAMED-${u}`, `${code} lookalike`); // name contains the barcode text
    const res = await search(adminA, code);
    expect(res[0]!.code).toBe(code);
    expect(res[0]!.rank).toBe(0);
    expect(['PRODUCT', 'PRODUCT_VARIANT']).toContain(res[0]!.type);
  });

  it('isolates results by organization', async () => {
    const sku = `ISO-${u}`;
    await product(adminA, sku, 'Org A only');
    expect(await search(adminB, sku)).toEqual([]);
  });

  it('enforces warehouse scope for warehouse-bound entities (but not the shared catalog)', async () => {
    // Both warehouses exist; the whX-scoped manager sees only whX.
    const byX = await search(managerX, `WHX${u}`);
    expect(byX.some((r) => r.entityId === whX)).toBe(true);
    const byY = await search(managerX, `WHY${u}`);
    expect(byY.some((r) => r.entityId === whY)).toBe(false);
    // Catalog is org-wide: the manager can still find a product.
    const sku = `CATVIS-${u}`;
    await product(adminA, sku, 'Visible catalog');
    expect((await search(managerX, sku)).some((r) => r.code === sku)).toBe(true);
  });

  it('excludes inactive and archived entities from normal search', async () => {
    const sku = `GONE-${u}`;
    const p = await product(adminA, sku, 'To be archived');
    expect((await search(adminA, sku)).length).toBeGreaterThan(0);
    await http().post(`/api/products/${p}/status`).set(auth(adminA)).send({ status: 'INACTIVE' }).expect(201);
    expect(await search(adminA, sku)).toEqual([]);
    await http().post(`/api/products/${p}/status`).set(auth(adminA)).send({ status: 'ARCHIVED' }).expect(201);
    expect(await search(adminA, sku)).toEqual([]);
  });

  it('keeps completed/historical documents searchable', async () => {
    const p = await product(adminA, `RCVP-${u}`, 'Received item');
    const receipt = (await http().post('/api/receiving').set(auth(adminA))
      .send({ warehouseId: whX, items: [{ productId: p, expectedQty: 5, receivedQty: 5, unitCost: 10 }] }).expect(201)).body;
    await http().post(`/api/receiving/${receipt.id}/post`).set(auth(adminA)).expect(201); // -> COMPLETED
    const res = await search(adminA, receipt.receiptNumber);
    const hit = res.find((r) => r.entityId === receipt.id);
    expect(hit).toBeTruthy();
    expect(hit!.type).toBe('GOODS_RECEIPT');
    expect(hit!.status).toBe('COMPLETED');
  });
});

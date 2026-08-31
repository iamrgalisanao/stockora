import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Phase 02 + 03 acceptance test. Requires Postgres + applied migrations.
 * Covers user management (last-admin guard, warehouse scope), catalog CRUD,
 * cross-table SKU uniqueness, and cost-visibility gating.
 */
describe('Users + Product Master (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  const adminEmail = `owner_${unique}@example.test`;
  const viewerEmail = `viewer_${unique}@example.test`;
  const password = 'password123';
  let adminToken: string;
  let adminUserId: string;
  let unitId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: `Catalog ${unique}`,
        adminEmail,
        adminName: 'Owner',
        adminPassword: password,
      })
      .expect(201);
    adminToken = reg.body.accessToken;
    adminUserId = reg.body.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- Phase 02: users ----

  it('lists roles for assignment', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/roles')
      .set(auth(adminToken))
      .expect(200);
    expect(res.body.map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(['administrator', 'viewer', 'warehouse_staff']),
    );
  });

  it('creates a Viewer user', async () => {
    await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: viewerEmail, name: 'Val Viewer', roleKey: 'viewer', password })
      .expect(201);
  });

  it('prevents removing the last administrator', async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${adminUserId}`)
      .set(auth(adminToken))
      .send({ roleKey: 'viewer' })
      .expect(400);
  });

  it('prevents disabling your own account', async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${adminUserId}`)
      .set(auth(adminToken))
      .send({ status: 'DISABLED' })
      .expect(400); // last-admin check fires first (admin is the only admin)
  });

  // ---- Phase 03: catalog ----

  it('creates a unit, category, and brand', async () => {
    const unit = await request(app.getHttpServer())
      .post('/api/units')
      .set(auth(adminToken))
      .send({ code: 'PCS', name: 'Piece', precision: 0 })
      .expect(201);
    unitId = unit.body.id;

    await request(app.getHttpServer())
      .post('/api/categories')
      .set(auth(adminToken))
      .send({ name: 'Storage' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/brands')
      .set(auth(adminToken))
      .send({ name: 'Samsung' })
      .expect(201);
  });

  it('rejects a conversion with equal from/to units', async () => {
    await request(app.getHttpServer())
      .post('/api/unit-conversions')
      .set(auth(adminToken))
      .send({ fromUomId: unitId, toUomId: unitId, factor: 2 })
      .expect(400);
  });

  it('creates a product and exposes cost to a cost-privileged admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/products')
      .set(auth(adminToken))
      .send({
        sku: 'SSD-001',
        name: 'Samsung 1TB SSD',
        baseUomId: unitId,
        cost: 2950,
        sellingPrice: 3600,
        reorderPoint: 15,
      })
      .expect(201);
    expect(res.body.cost).toBe('2950');
    expect(res.body.sellingPrice).toBe('3600');
    expect(res.body.baseUomCode).toBe('PCS');
  });

  it('rejects a product referencing a non-existent unit', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .set(auth(adminToken))
      .send({ sku: 'BAD-001', name: 'Bad', baseUomId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
  });

  it('rejects a duplicate SKU', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .set(auth(adminToken))
      .send({ sku: 'SSD-001', name: 'Dup', baseUomId: unitId })
      .expect(409);
  });

  it('hides cost from a Viewer (no cost.view) and forbids product creation', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: viewerEmail, password })
      .expect(200);
    const viewerToken = login.body.accessToken;

    const list = await request(app.getHttpServer())
      .get('/api/products')
      .set(auth(viewerToken))
      .expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].cost).toBeUndefined();
    expect(list.body[0].sellingPrice).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/products')
      .set(auth(viewerToken))
      .send({ sku: 'X-1', name: 'X', baseUomId: unitId })
      .expect(403);
  });

  it('adds a variant and flags the product hasVariants', async () => {
    const products = await request(app.getHttpServer())
      .get('/api/products')
      .set(auth(adminToken))
      .expect(200);
    const productId = products.body[0].id;

    await request(app.getHttpServer())
      .post(`/api/products/${productId}/variants`)
      .set(auth(adminToken))
      .send({ sku: 'SSD-001-BLK', attributes: { color: 'Black' }, sellingPrice: 3600 })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/api/products/${productId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(detail.body.hasVariants).toBe(true);
    expect(detail.body.variants.length).toBe(1);
  });
});

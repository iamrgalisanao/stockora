import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Releases — approval workflow (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let adminToken: string;
  let staffToken: string;
  let productId: string;
  let warehouseId: string;

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    adminToken = (
      await http()
        .post('/api/auth/register')
        .send({ organizationName: `Rel ${unique}`, adminEmail: `rel_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;

    const unitId = (await http().post('/api/units').set(bearer(adminToken)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (await http().post('/api/products').set(bearer(adminToken)).send({ sku: 'RELP-1', name: 'P', baseUomId: unitId }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(bearer(adminToken)).send({ code: 'RLW', name: 'W' }).expect(201)).body.id;

    // Seed stock: 100 units.
    await http()
      .post('/api/inventory/opening-balances')
      .set(bearer(adminToken))
      .send({ warehouseId, lines: [{ productId, quantity: 100, unitCost: 10 }] })
      .expect(201);

    // A warehouse-staff user: can create/release, cannot approve.
    const staffEmail = `staff_${unique}@x.test`;
    await http()
      .post('/api/users')
      .set(bearer(adminToken))
      .send({ email: staffEmail, name: 'Staff', roleKey: 'warehouse_staff', password: 'password123' })
      .expect(201);
    staffToken = (await http().post('/api/auth/login').send({ email: staffEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function onHand(): Promise<string> {
    const b = await http().get(`/api/inventory/balances?productId=${productId}`).set(bearer(adminToken)).expect(200);
    return b.body.find((x: { warehouseId: string }) => x.warehouseId === warehouseId)?.onHand ?? '0';
  }

  it('enforces Draft -> Approve -> Post (cannot post before approval)', async () => {
    const release = await http()
      .post('/api/releases')
      .set(bearer(adminToken))
      .send({ warehouseId, destinationType: 'CUSTOMER', items: [{ productId, requestedQty: 30 }] })
      .expect(201);
    expect(release.body.status).toBe('DRAFT');
    const id = release.body.id;

    // Posting a draft is rejected.
    await http().post(`/api/releases/${id}/post`).set(bearer(adminToken)).expect(400);

    await http().post(`/api/releases/${id}/submit`).set(bearer(adminToken)).expect(201);
    // Posting a for-approval release is still rejected.
    await http().post(`/api/releases/${id}/post`).set(bearer(adminToken)).expect(400);

    const approved = await http().post(`/api/releases/${id}/approve`).set(bearer(adminToken)).send({}).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.items[0].approvedQty).toBe('30');

    const posted = await http().post(`/api/releases/${id}/post`).set(bearer(adminToken)).expect(201);
    expect(posted.body.status).toBe('RELEASED');
    expect(posted.body.items[0].releasedQty).toBe('30');
    expect(await onHand()).toBe('70'); // 100 - 30
  });

  it('separates duties: staff can create/submit but not approve', async () => {
    const release = await http()
      .post('/api/releases')
      .set(bearer(staffToken))
      .send({ warehouseId, destinationType: 'DEPARTMENT', items: [{ productId, requestedQty: 5 }] })
      .expect(201);
    await http().post(`/api/releases/${release.body.id}/submit`).set(bearer(staffToken)).expect(201);
    // Staff lacks inventory.approve -> 403.
    await http().post(`/api/releases/${release.body.id}/approve`).set(bearer(staffToken)).send({}).expect(403);
  });

  it('rejects approving more than requested', async () => {
    const release = await http()
      .post('/api/releases')
      .set(bearer(adminToken))
      .send({ warehouseId, destinationType: 'PROJECT', items: [{ productId, requestedQty: 5 }] })
      .expect(201);
    const itemId = release.body.items[0].id;
    await http().post(`/api/releases/${release.body.id}/submit`).set(bearer(adminToken)).expect(201);
    await http()
      .post(`/api/releases/${release.body.id}/approve`)
      .set(bearer(adminToken))
      .send({ items: [{ itemId, approvedQty: 10 }] })
      .expect(400);
  });

  it('is idempotent on re-post', async () => {
    const release = await http()
      .post('/api/releases')
      .set(bearer(adminToken))
      .send({ warehouseId, destinationType: 'BRANCH', items: [{ productId, requestedQty: 10 }] })
      .expect(201);
    const id = release.body.id;
    await http().post(`/api/releases/${id}/submit`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/releases/${id}/approve`).set(bearer(adminToken)).send({}).expect(201);
    await http().post(`/api/releases/${id}/post`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/releases/${id}/post`).set(bearer(adminToken)).expect(201); // replay
    expect(await onHand()).toBe('60'); // 70 - 10, not 50
  });
});

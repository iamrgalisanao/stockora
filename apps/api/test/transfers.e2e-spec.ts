import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Transfers — approval + in-transit lifecycle (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let adminToken: string;
  let staffToken: string;
  let productId: string;
  let whA: string;
  let whB: string;

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
        .send({ organizationName: `Trf ${unique}`, adminEmail: `trf_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;

    const unitId = (await http().post('/api/units').set(bearer(adminToken)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (await http().post('/api/products').set(bearer(adminToken)).send({ sku: 'TRFP-1', name: 'P', baseUomId: unitId }).expect(201)).body.id;
    whA = (await http().post('/api/warehouses').set(bearer(adminToken)).send({ code: 'A', name: 'A' }).expect(201)).body.id;
    whB = (await http().post('/api/warehouses').set(bearer(adminToken)).send({ code: 'B', name: 'B' }).expect(201)).body.id;

    await http()
      .post('/api/inventory/opening-balances')
      .set(bearer(adminToken))
      .send({ warehouseId: whA, lines: [{ productId, quantity: 100, unitCost: 50 }] })
      .expect(201);

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

  async function bal(warehouseId: string) {
    const b = await http().get(`/api/inventory/balances?productId=${productId}`).set(bearer(adminToken)).expect(200);
    return b.body.find((x: { warehouseId: string }) => x.warehouseId === warehouseId);
  }

  it('rejects a transfer to the same warehouse', async () => {
    await http()
      .post('/api/transfers')
      .set(bearer(adminToken))
      .send({ sourceWarehouseId: whA, destWarehouseId: whA, items: [{ productId, quantity: 10 }] })
      .expect(400);
  });

  it('runs the full lifecycle and maintains in-transit', async () => {
    const created = await http()
      .post('/api/transfers')
      .set(bearer(adminToken))
      .send({ sourceWarehouseId: whA, destWarehouseId: whB, items: [{ productId, quantity: 30 }] })
      .expect(201);
    const id = created.body.id;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.transferNumber).toMatch(/^TR-\d{6}$/);

    // Cannot dispatch before approval.
    await http().post(`/api/transfers/${id}/dispatch`).set(bearer(adminToken)).expect(400);
    await http().post(`/api/transfers/${id}/submit`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/transfers/${id}/dispatch`).set(bearer(adminToken)).expect(400); // still for-approval
    await http().post(`/api/transfers/${id}/approve`).set(bearer(adminToken)).expect(201);

    // Dispatch -> IN_TRANSIT at the source only.
    const dispatched = await http().post(`/api/transfers/${id}/dispatch`).set(bearer(adminToken)).expect(201);
    expect(dispatched.body.status).toBe('IN_TRANSIT');
    let a = await bal(whA);
    expect(a.onHand).toBe('70');
    expect(a.inTransit).toBe('30');
    const b0 = await bal(whB);
    expect(b0?.onHand ?? '0').toBe('0'); // destination NOT raised on dispatch

    // Receive -> RECEIVED; stock lands at destination at carried WAC.
    const received = await http().post(`/api/transfers/${id}/receive`).set(bearer(adminToken)).expect(201);
    expect(received.body.status).toBe('RECEIVED');
    a = await bal(whA);
    const b = await bal(whB);
    expect(a.onHand).toBe('70');
    expect(a.inTransit).toBe('0');
    expect(b.onHand).toBe('30');
    expect(b.avgCost).toBe('50'); // source WAC carried across
  });

  it('separates duties: staff can create/submit but not approve', async () => {
    const created = await http()
      .post('/api/transfers')
      .set(bearer(staffToken))
      .send({ sourceWarehouseId: whA, destWarehouseId: whB, items: [{ productId, quantity: 5 }] })
      .expect(201);
    await http().post(`/api/transfers/${created.body.id}/submit`).set(bearer(staffToken)).expect(201);
    await http().post(`/api/transfers/${created.body.id}/approve`).set(bearer(staffToken)).expect(403);
  });

  it('is idempotent on re-dispatch and re-receive', async () => {
    const created = await http()
      .post('/api/transfers')
      .set(bearer(adminToken))
      .send({ sourceWarehouseId: whA, destWarehouseId: whB, items: [{ productId, quantity: 10 }] })
      .expect(201);
    const id = created.body.id;
    await http().post(`/api/transfers/${id}/submit`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/transfers/${id}/approve`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/transfers/${id}/dispatch`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/transfers/${id}/dispatch`).set(bearer(adminToken)).expect(201); // replay
    await http().post(`/api/transfers/${id}/receive`).set(bearer(adminToken)).expect(201);
    await http().post(`/api/transfers/${id}/receive`).set(bearer(adminToken)).expect(201); // replay

    const a = await bal(whA);
    const b = await bal(whB);
    expect(a.onHand).toBe('60'); // 70 - 10 (once)
    expect(a.inTransit).toBe('0');
    expect(b.onHand).toBe('40'); // 30 + 10 (once)
  });
});

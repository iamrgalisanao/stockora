import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Stock Adjustments — approval + high-value second approver (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let adminToken: string;
  let approverToken: string;
  let productId: string;
  let warehouseId: string;
  let reasonId: string;

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
        .send({ organizationName: `Adj ${unique}`, adminEmail: `adj_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;

    const unitId = (await http().post('/api/units').set(bearer(adminToken)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (await http().post('/api/products').set(bearer(adminToken)).send({ sku: 'ADJP-1', name: 'P', baseUomId: unitId }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(bearer(adminToken)).send({ code: 'ADJW', name: 'W' }).expect(201)).body.id;
    await http()
      .post('/api/inventory/opening-balances')
      .set(bearer(adminToken))
      .send({ warehouseId, lines: [{ productId, quantity: 100, unitCost: 100 }] })
      .expect(201);

    // Default reasons were seeded at registration.
    const reasons = await http().get('/api/adjustment-reasons').set(bearer(adminToken)).expect(200);
    expect(reasons.body.length).toBeGreaterThanOrEqual(10);
    reasonId = reasons.body[0].id;

    // A second approver (role 'approver' has inventory.approve but not inventory.adjust).
    const approverEmail = `approver_${unique}@x.test`;
    await http()
      .post('/api/users')
      .set(bearer(adminToken))
      .send({ email: approverEmail, name: 'Second Approver', roleKey: 'approver', password: 'password123' })
      .expect(201);
    approverToken = (await http().post('/api/auth/login').send({ email: approverEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  async function onHand(): Promise<string> {
    const b = await http().get(`/api/inventory/balances?productId=${productId}`).set(bearer(adminToken)).expect(200);
    return b.body.find((x: { warehouseId: string }) => x.warehouseId === warehouseId)?.onHand ?? '0';
  }

  it('low-value adjustment: single approval, mixed IN/OUT posts to the ledger', async () => {
    const adj = await http()
      .post('/api/adjustments')
      .set(bearer(adminToken))
      .send({
        warehouseId,
        reasonId,
        items: [
          { productId, direction: 'IN', quantity: 5, unitCost: 100 },
          { productId, direction: 'OUT', quantity: 2 },
        ],
      })
      .expect(201);
    const id = adj.body.id;
    expect(adj.body.status).toBe('DRAFT');
    expect(adj.body.adjustmentNumber).toMatch(/^ADJ-\d{6}$/);

    await http().post(`/api/adjustments/${id}/post`).set(bearer(adminToken)).expect(400); // not approved
    const submitted = await http().post(`/api/adjustments/${id}/submit`).set(bearer(adminToken)).expect(201);
    expect(submitted.body.requiresSecondApproval).toBe(false); // value 5*100 + 2*100 = 700 < 10000

    const approved = await http().post(`/api/adjustments/${id}/approve`).set(bearer(adminToken)).expect(201);
    expect(approved.body.status).toBe('APPROVED'); // no second approval needed

    await http().post(`/api/adjustments/${id}/post`).set(bearer(adminToken)).expect(201);
    expect(await onHand()).toBe('103'); // 100 + 5 - 2
  });

  it('high-value adjustment requires a distinct second approver', async () => {
    const adj = await http()
      .post('/api/adjustments')
      .set(bearer(adminToken))
      .send({ warehouseId, reasonId, items: [{ productId, direction: 'IN', quantity: 200, unitCost: 100 }] })
      .expect(201);
    const id = adj.body.id;

    const submitted = await http().post(`/api/adjustments/${id}/submit`).set(bearer(adminToken)).expect(201);
    expect(submitted.body.requiresSecondApproval).toBe(true); // 200*100 = 20000 > 10000

    const firstApproved = await http().post(`/api/adjustments/${id}/approve`).set(bearer(adminToken)).expect(201);
    expect(firstApproved.body.status).toBe('PENDING_SECOND_APPROVAL');

    // Cannot post while awaiting the second approval.
    await http().post(`/api/adjustments/${id}/post`).set(bearer(adminToken)).expect(400);
    // Same person cannot be the second approver.
    await http().post(`/api/adjustments/${id}/second-approve`).set(bearer(adminToken)).expect(400);

    const second = await http().post(`/api/adjustments/${id}/second-approve`).set(bearer(approverToken)).expect(201);
    expect(second.body.status).toBe('APPROVED');

    await http().post(`/api/adjustments/${id}/post`).set(bearer(adminToken)).expect(201);
    expect(await onHand()).toBe('303'); // 103 + 200
  });

  it('respects a per-org threshold change', async () => {
    await http()
      .patch('/api/organizations/current')
      .set(bearer(adminToken))
      .send({ highValueAdjustmentThreshold: 100 })
      .expect(200);

    const adj = await http()
      .post('/api/adjustments')
      .set(bearer(adminToken))
      .send({ warehouseId, reasonId, items: [{ productId, direction: 'IN', quantity: 5, unitCost: 100 }] })
      .expect(201);
    const submitted = await http().post(`/api/adjustments/${adj.body.id}/submit`).set(bearer(adminToken)).expect(201);
    expect(submitted.body.requiresSecondApproval).toBe(true); // 500 > new threshold 100
  });

  it('lets an admin manage adjustment reasons', async () => {
    const created = await http()
      .post('/api/adjustment-reasons')
      .set(bearer(adminToken))
      .send({ code: 'CUSTOM_REASON', name: 'Custom Reason' })
      .expect(201);
    expect(created.body.code).toBe('CUSTOM_REASON');
    await http()
      .post('/api/adjustment-reasons')
      .set(bearer(adminToken))
      .send({ code: 'CUSTOM_REASON', name: 'Dup' })
      .expect(409);
  });
});

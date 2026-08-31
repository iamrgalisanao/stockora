import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Receiving (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let productId: string;
  let warehouseId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
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
        .send({ organizationName: `Rcv ${unique}`, adminEmail: `rcv_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    const unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (await http().post('/api/products').set(auth()).send({ sku: 'RCVP-1', name: 'P', baseUomId: unitId }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(auth()).send({ code: 'RW1', name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function onHand(): Promise<string> {
    const b = await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200);
    return b.body.find((x: { warehouseId: string }) => x.warehouseId === warehouseId)?.onHand ?? '0';
  }

  it('creates, posts a receipt, and increases stock', async () => {
    const draft = await http()
      .post('/api/receiving')
      .set(auth())
      .send({
        warehouseId,
        items: [{ productId, expectedQty: 100, receivedQty: 100, unitCost: 100 }],
      })
      .expect(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.receiptNumber).toMatch(/^GR-\d{6}$/);

    const posted = await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    expect(posted.body.status).toBe('COMPLETED');
    expect(await onHand()).toBe('100');
  });

  it('is idempotent on re-post (no double count)', async () => {
    const draft = await http()
      .post('/api/receiving')
      .set(auth())
      .send({ warehouseId, items: [{ productId, expectedQty: 10, receivedQty: 10, unitCost: 100 }] })
      .expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201); // replay
    expect(await onHand()).toBe('110'); // 100 + 10, not 120
  });

  it('marks partial receipts and only posts received quantities', async () => {
    const draft = await http()
      .post('/api/receiving')
      .set(auth())
      .send({ warehouseId, items: [{ productId, expectedQty: 50, receivedQty: 30, unitCost: 100 }] })
      .expect(201);
    const posted = await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    expect(posted.body.status).toBe('PARTIALLY_RECEIVED');
    expect(await onHand()).toBe('140'); // 110 + 30
  });

  it('rejects editing a posted receipt', async () => {
    const draft = await http()
      .post('/api/receiving')
      .set(auth())
      .send({ warehouseId, items: [{ productId, expectedQty: 5, receivedQty: 5, unitCost: 100 }] })
      .expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    await http()
      .patch(`/api/receiving/${draft.body.id}`)
      .set(auth())
      .send({ notes: 'too late' })
      .expect(400);
  });
});

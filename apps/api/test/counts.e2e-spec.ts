import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Physical Count (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let productId: string;
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
        .send({ organizationName: `Cnt ${unique}`, adminEmail: `cnt_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    const unitId = (await http().post('/api/units').set(bearer()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (await http().post('/api/products').set(bearer()).send({ sku: 'CNTP-1', name: 'P', baseUomId: unitId }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(bearer()).send({ code: 'CW', name: 'W' }).expect(201)).body.id;
    await http()
      .post('/api/inventory/opening-balances')
      .set(bearer())
      .send({ warehouseId, lines: [{ productId, quantity: 100, unitCost: 10 }] })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function onHand(): Promise<string> {
    const b = await http().get(`/api/inventory/balances?productId=${productId}`).set(bearer()).expect(200);
    return b.body.find((x: { warehouseId: string }) => x.warehouseId === warehouseId)?.onHand ?? '0';
  }

  it('snapshots, counts, and posts a negative variance', async () => {
    const created = await http()
      .post('/api/counts')
      .set(bearer())
      .send({ warehouseId, type: 'WAREHOUSE' })
      .expect(201);
    const id = created.body.id;
    expect(created.body.status).toBe('COUNTING');
    expect(created.body.countNumber).toMatch(/^PC-\d{6}$/);
    expect(created.body.items.length).toBe(1);
    expect(created.body.items[0].systemQty).toBe('100');
    const itemId = created.body.items[0].id;

    // Cannot post before approval.
    await http().post(`/api/counts/${id}/post`).set(bearer()).expect(400);
    // Cannot submit before counting all items.
    await http().post(`/api/counts/${id}/submit`).set(bearer()).expect(400);

    const entered = await http()
      .post(`/api/counts/${id}/entries`)
      .set(bearer())
      .send({ items: [{ itemId, countedQty: 95 }] })
      .expect(201);
    expect(entered.body.items[0].varianceQty).toBe('-5');

    await http().post(`/api/counts/${id}/submit`).set(bearer()).expect(201);
    const approved = await http().post(`/api/counts/${id}/approve`).set(bearer()).expect(201);
    expect(approved.body.status).toBe('APPROVED');

    const posted = await http().post(`/api/counts/${id}/post`).set(bearer()).expect(201);
    expect(posted.body.status).toBe('POSTED');
    expect(await onHand()).toBe('95'); // 100 - 5 variance
  });

  it('is idempotent on re-post', async () => {
    const created = await http().post('/api/counts').set(bearer()).send({ warehouseId }).expect(201);
    const id = created.body.id;
    const itemId = created.body.items[0].id;
    await http().post(`/api/counts/${id}/entries`).set(bearer()).send({ items: [{ itemId, countedQty: 100 }] }).expect(201);
    await http().post(`/api/counts/${id}/submit`).set(bearer()).expect(201);
    await http().post(`/api/counts/${id}/approve`).set(bearer()).expect(201);
    await http().post(`/api/counts/${id}/post`).set(bearer()).expect(201);
    await http().post(`/api/counts/${id}/post`).set(bearer()).expect(201); // replay, no-op
    expect(await onHand()).toBe('100'); // snapshot 95, counted 100 -> +5 variance -> 100 (once)
  });

  it('blind count hides system quantity while counting, reveals it at review', async () => {
    const created = await http()
      .post('/api/counts')
      .set(bearer())
      .send({ warehouseId, isBlind: true })
      .expect(201);
    const id = created.body.id;
    const itemId = created.body.items[0].id;
    expect(created.body.items[0].systemQty).toBeUndefined(); // hidden while COUNTING + blind
    expect(created.body.items[0].varianceQty).toBeUndefined();

    await http().post(`/api/counts/${id}/entries`).set(bearer()).send({ items: [{ itemId, countedQty: 100 }] }).expect(201);
    await http().post(`/api/counts/${id}/submit`).set(bearer()).expect(201);

    const review = await http().get(`/api/counts/${id}`).set(bearer()).expect(200);
    expect(review.body.status).toBe('REVIEW');
    expect(review.body.items[0].systemQty).toBeDefined(); // revealed once out of COUNTING
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Warehouses & locations — lifecycle + hierarchy (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let unitId: string;
  let productId: string;
  let seq = 0;

  const bearer = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  const newWarehouse = async (code = `W${unique}_${seq++}`) =>
    (await http().post('/api/warehouses').set(bearer()).send({ code, name: code }).expect(201)).body;
  const newLocation = async (whId: string, code: string, body: Record<string, unknown> = {}) =>
    (await http().post(`/api/warehouses/${whId}/locations`).set(bearer()).send({ code, ...body })).body;
  const openingBalance = (whId: string, qty: number) =>
    http().post('/api/inventory/opening-balances').set(bearer())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 10 }] }).expect(201);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Wh ${unique}`, adminEmail: `wh_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    unitId = (await http().post('/api/units').set(bearer()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    productId = (await http().post('/api/products').set(bearer()).send({ sku: `P-${unique}`, name: 'P', baseUomId: unitId, cost: 10 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // --- codes & hierarchy ---------------------------------------------------

  it('rejects a duplicate warehouse code', async () => {
    const w = await newWarehouse();
    await http().post('/api/warehouses').set(bearer()).send({ code: w.code, name: 'dup' }).expect(409);
  });

  it('enforces location code uniqueness per warehouse (but not across warehouses)', async () => {
    const a = await newWarehouse();
    const b = await newWarehouse();
    await http().post(`/api/warehouses/${a.id}/locations`).set(bearer()).send({ code: 'BIN-01' }).expect(201);
    await http().post(`/api/warehouses/${a.id}/locations`).set(bearer()).send({ code: 'BIN-01' }).expect(409); // dup same wh
    await http().post(`/api/warehouses/${b.id}/locations`).set(bearer()).send({ code: 'BIN-01' }).expect(201); // ok other wh
  });

  it('rejects a cross-warehouse parent at create and at move', async () => {
    const a = await newWarehouse();
    const b = await newWarehouse();
    const bLoc = await newLocation(b.id, 'B-ROOT');
    // create a child in A pointing at a parent in B
    await http().post(`/api/warehouses/${a.id}/locations`).set(bearer()).send({ code: 'A-CHILD', parentId: bLoc.id }).expect(400);
    const aLoc = await newLocation(a.id, 'A-ROOT');
    await http().post(`/api/warehouses/${a.id}/locations/${aLoc.id}/move`).set(bearer()).send({ parentId: bLoc.id }).expect(400);
  });

  it('rejects self-parent and ancestor cycles on move', async () => {
    const w = await newWarehouse();
    const root = await newLocation(w.id, 'ROOT');
    const child = await newLocation(w.id, 'CHILD', { parentId: root.id });
    await http().post(`/api/warehouses/${w.id}/locations/${root.id}/move`).set(bearer()).send({ parentId: root.id }).expect(400); // self
    await http().post(`/api/warehouses/${w.id}/locations/${root.id}/move`).set(bearer()).send({ parentId: child.id }).expect(400); // cycle
  });

  it('moves a location within the same warehouse, preserving warehouseId', async () => {
    const w = await newWarehouse();
    const a = await newLocation(w.id, 'A');
    const b = await newLocation(w.id, 'B');
    const moved = (await http().post(`/api/warehouses/${w.id}/locations/${b.id}/move`).set(bearer()).send({ parentId: a.id }).expect(201)).body;
    expect(moved.parentId).toBe(a.id);
    expect(moved.warehouseId).toBe(w.id);
    // back to root
    const root = (await http().post(`/api/warehouses/${w.id}/locations/${b.id}/move`).set(bearer()).send({ parentId: null }).expect(201)).body;
    expect(root.parentId).toBeNull();
  });

  // --- warehouse archive guard ---------------------------------------------

  it('blocks warehouse archive while it holds stock (any bucket)', async () => {
    const w = await newWarehouse();
    await openingBalance(w.id, 5);
    await http().post(`/api/warehouses/${w.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('blocks warehouse archive while an open document exists', async () => {
    const w = await newWarehouse();
    await http().post('/api/receiving').set(bearer())
      .send({ warehouseId: w.id, items: [{ productId, expectedQty: 5, receivedQty: 0, unitCost: 10 }] }).expect(201);
    await http().post(`/api/warehouses/${w.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('blocks warehouse archive while an active inventory policy targets it', async () => {
    const w = await newWarehouse();
    await http().post(`/api/products/${productId}/policies`).set(bearer())
      .send({ warehouseId: w.id, reorderPoint: 5, reorderQuantity: 5 }).expect(201);
    await http().post(`/api/warehouses/${w.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('blocks warehouse archive while an active location exists', async () => {
    const w = await newWarehouse();
    await newLocation(w.id, 'ONLY');
    await http().post(`/api/warehouses/${w.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  // --- location archive guard ----------------------------------------------

  it('blocks location archive while inventory movements reference it', async () => {
    const w = await newWarehouse();
    const loc = await newLocation(w.id, 'RCV', { usage: 'RECEIVING' });
    const receipt = (await http().post('/api/receiving').set(bearer())
      .send({ warehouseId: w.id, items: [{ productId, expectedQty: 5, receivedQty: 5, unitCost: 10, locationId: loc.id }] }).expect(201)).body;
    await http().post(`/api/receiving/${receipt.id}/post`).set(bearer()).expect(201);
    await http().post(`/api/warehouses/${w.id}/locations/${loc.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('blocks location archive while it has active descendants', async () => {
    const w = await newWarehouse();
    const parent = await newLocation(w.id, 'PARENT');
    await newLocation(w.id, 'KID', { parentId: parent.id });
    await http().post(`/api/warehouses/${w.id}/locations/${parent.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(400);
  });

  it('keeps a location within its warehouse even after movements (no cross-warehouse move)', async () => {
    const w = await newWarehouse();
    const other = await newWarehouse();
    const otherLoc = await newLocation(other.id, 'OTHER-ROOT');
    const loc = await newLocation(w.id, 'MOVED', { usage: 'STORAGE' });
    const sibling = await newLocation(w.id, 'SIB');
    const receipt = (await http().post('/api/receiving').set(bearer())
      .send({ warehouseId: w.id, items: [{ productId, expectedQty: 3, receivedQty: 3, unitCost: 10, locationId: loc.id }] }).expect(201)).body;
    await http().post(`/api/receiving/${receipt.id}/post`).set(bearer()).expect(201);
    // Same-warehouse reparent is still allowed with movements present…
    const moved = (await http().post(`/api/warehouses/${w.id}/locations/${loc.id}/move`).set(bearer()).send({ parentId: sibling.id }).expect(201)).body;
    expect(moved.warehouseId).toBe(w.id);
    // …but it can never be reparented into another warehouse.
    await http().post(`/api/warehouses/${w.id}/locations/${loc.id}/move`).set(bearer()).send({ parentId: otherLoc.id }).expect(400);
  });

  // --- operational selectors & historical resolution -----------------------

  it('excludes inactive/archived warehouses from new operations but keeps them resolvable', async () => {
    const w = await newWarehouse();
    await http().post(`/api/warehouses/${w.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);
    // Cannot start a new receipt in an inactive warehouse.
    await http().post('/api/receiving').set(bearer())
      .send({ warehouseId: w.id, items: [{ productId, expectedQty: 1, receivedQty: 0, unitCost: 10 }] }).expect(400);
    // Still resolves directly and via the archived/inactive filter, but not in the ACTIVE list.
    expect((await http().get(`/api/warehouses/${w.id}`).set(bearer()).expect(200)).body.status).toBe('INACTIVE');
    const active = await http().get('/api/warehouses?status=ACTIVE').set(bearer()).expect(200);
    expect(active.body.map((x: { id: string }) => x.id)).not.toContain(w.id);
    const inactive = await http().get('/api/warehouses?status=INACTIVE').set(bearer()).expect(200);
    expect(inactive.body.map((x: { id: string }) => x.id)).toContain(w.id);
  });

  it('excludes inactive locations from new operational lines', async () => {
    const w = await newWarehouse();
    const loc = await newLocation(w.id, 'DEAD');
    await http().post(`/api/warehouses/${w.id}/locations/${loc.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);
    await http().post('/api/receiving').set(bearer())
      .send({ warehouseId: w.id, items: [{ productId, expectedQty: 1, receivedQty: 0, unitCost: 10, locationId: loc.id }] }).expect(400);
  });

  it('audits warehouse and location lifecycle + hierarchy mutations', async () => {
    const w = await newWarehouse();
    const loc = await newLocation(w.id, 'AUD');
    const sib = await newLocation(w.id, 'AUD2');
    await http().post(`/api/warehouses/${w.id}/locations/${loc.id}/move`).set(bearer()).send({ parentId: sib.id }).expect(201);
    await http().post(`/api/warehouses/${w.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);

    const whAudit = (await http().get(`/api/audit?entityType=warehouse&entityId=${w.id}`).set(bearer()).expect(200)).body.entries
      .map((a: { action: string }) => a.action);
    expect(whAudit).toEqual(expect.arrayContaining(['warehouse.created', 'warehouse.status_changed']));
    const locAudit = (await http().get(`/api/audit?entityType=location&entityId=${loc.id}`).set(bearer()).expect(200)).body.entries
      .map((a: { action: string }) => a.action);
    expect(locAudit).toEqual(expect.arrayContaining(['location.created', 'location.moved']));
  });
});

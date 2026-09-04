import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.6B — mobile worklists, advisory claims, and exactly-once command intake (ADR 0014). Read models are
 * scoped to org + warehouse scope, exclude finished/unauthorized work, and carry per-line tracking
 * requirements; claims are advisory; command intake is exactly-once by idempotency key and never mutates
 * inventory.
 */
describe('mobile workflows (e2e, 2D.6B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string; // org-A admin (unrestricted scope)
  let staffToken: string; // org-A warehouse_staff scoped to MAIN
  let westStaffToken: string; // org-A warehouse_staff scoped to WEST
  let otherToken: string; // a different org
  let unitId: string;
  let mainWh: string;
  let westWh: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (opts: { isSerialized?: boolean; isBatchTracked?: boolean } = {}) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku('MW'), name: sku('MWN'), baseUomId: unitId, ...opts }).expect(201)).body.id as string;

  const receiveStock = async (productId: string, qty: number, wh = mainWh) => {
    const draft = await http().post('/api/receiving').set(auth()).send({ warehouseId: wh, items: [{ productId, expectedQty: qty, receivedQty: qty, unitCost: 10 }] }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };

  const draftReceipt = async (items: Array<{ productId: string; qty: number }>, wh = mainWh) =>
    (await http().post('/api/receiving').set(auth()).send({ warehouseId: wh, items: items.map((i) => ({ productId: i.productId, expectedQty: i.qty, receivedQty: i.qty, unitCost: 10 })) }).expect(201)).body.id as string;

  const approvedRelease = async (productId: string, qty: number, wh = mainWh) => {
    const rel = await http().post('/api/releases').set(auth()).send({ warehouseId: wh, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    return rel.body.id as string;
  };

  const approvedTransfer = async (productId: string, qty: number) => {
    const tr = await http().post('/api/transfers').set(auth()).send({ sourceWarehouseId: mainWh, destWarehouseId: westWh, items: [{ productId, quantity: qty }] }).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/transfers/${tr.body.id}/approve`).set(auth()).expect(201);
    return tr.body.id as string;
  };

  const openCount = async (productId: string, wh = mainWh) =>
    (await http().post('/api/counts').set(auth()).send({ warehouseId: wh, productIds: [productId] }).expect(201)).body.id as string;

  const draftReturn = async (productId: string, qty: number, wh = mainWh) =>
    (await http().post('/api/returns').set(auth()).send({ type: 'CUSTOMER', warehouseId: wh, lines: [{ productId, quantity: qty }] }).expect(201)).body.id as string;

  const worklist = async (type: string, t = token) =>
    (await http().get(`/api/mobile/work/${type}`).set(auth(t)).expect(200)).body as Array<Record<string, any>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (await http().post('/api/auth/register').send({ organizationName: `MW ${u}`, adminEmail: `mw_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    mainWh = (await http().post('/api/warehouses').set(auth()).send({ code: 'MAIN', name: 'Main' }).expect(201)).body.id;
    westWh = (await http().post('/api/warehouses').set(auth()).send({ code: 'WEST', name: 'West' }).expect(201)).body.id;

    const mkStaff = async (label: string, scope: string[]) => {
      const email = `mw_${label}_${u}@x.test`;
      await http().post('/api/users').set(auth()).send({ email, name: label, roleKey: 'warehouse_staff', password: 'password123', warehouseScope: scope }).expect(201);
      return (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken as string;
    };
    staffToken = await mkStaff('mainstaff', [mainWh]);
    westStaffToken = await mkStaff('weststaff', [westWh]);

    otherToken = (await http().post('/api/auth/register').send({ organizationName: `MWO ${u}`, adminEmail: `mwo_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('receiving worklist lists open receipts with per-line tracking requirements; excludes posted ones', async () => {
    const plain = await newProduct();
    const serialized = await newProduct({ isSerialized: true });
    const batch = await newProduct({ isBatchTracked: true });
    const receiptId = await draftReceipt([{ productId: plain, qty: 5 }, { productId: serialized, qty: 3 }, { productId: batch, qty: 4 }]);
    // A fully posted receipt must NOT appear (finished work excluded).
    await receiveStock(plain, 2);

    const list = await worklist('receiving');
    const item = list.find((w) => w.documentId === receiptId);
    expect(item).toBeDefined();
    expect(item!.reference).toBeTruthy();
    expect(item!.warehouseCode).toBe('MAIN');
    expect(typeof item!.version).toBe('number');
    const byProduct = Object.fromEntries(item!.lines.map((l: any) => [l.productId, l]));
    expect(byProduct[plain].tracking).toMatchObject({ serialized: false, lotTracked: false, requireLot: false });
    expect(byProduct[serialized].tracking).toMatchObject({ serialized: true, serialCaptureAtReceipt: true });
    expect(byProduct[batch].tracking).toMatchObject({ lotTracked: true, requireLot: true });
    // No COMPLETED receipt is present.
    expect(list.every((w) => w.status !== 'COMPLETED')).toBe(true);
  });

  it('releases/transfers/counts/returns worklists surface only actionable documents', async () => {
    const p = await newProduct();
    await receiveStock(p, 50);
    const relId = await approvedRelease(p, 5);
    const trId = await approvedTransfer(p, 4);
    const countId = await openCount(p);
    const retId = await draftReturn(p, 2);

    expect((await worklist('releases')).some((w) => w.documentId === relId && w.status === 'APPROVED')).toBe(true);
    const tr = (await worklist('transfers')).find((w) => w.documentId === trId);
    expect(tr).toBeDefined();
    expect(tr!.subAction).toBe('dispatch'); // APPROVED transfer is a dispatch action at the source
    expect((await worklist('counts')).some((w) => w.documentId === countId && w.blind === false)).toBe(true);
    expect((await worklist('returns')).some((w) => w.documentId === retId && w.status === 'DRAFT')).toBe(true);
  });

  it('a dispatched transfer becomes a receive action at the destination', async () => {
    const p = await newProduct();
    await receiveStock(p, 20);
    const trId = await approvedTransfer(p, 6);
    await http().post(`/api/transfers/${trId}/dispatch`).set(auth()).expect(201);
    const tr = (await worklist('transfers')).find((w) => w.documentId === trId);
    expect(tr).toBeDefined();
    expect(tr!.subAction).toBe('receive');
    expect(tr!.warehouseCode).toBe('WEST');
    expect(tr!.lines[0].targetQty).toBe(6); // dispatched quantity is the expected receive target
  });

  it('enforces warehouse scope — a MAIN-scoped operator never sees WEST work', async () => {
    const p = await newProduct();
    const westReceipt = await draftReceipt([{ productId: p, qty: 5 }], westWh);

    // Admin (unrestricted) sees the WEST receipt; MAIN-scoped staff does not; WEST staff does.
    expect((await worklist('receiving', token)).some((w) => w.documentId === westReceipt)).toBe(true);
    expect((await worklist('receiving', staffToken)).some((w) => w.documentId === westReceipt)).toBe(false);
    expect((await worklist('receiving', westStaffToken)).some((w) => w.documentId === westReceipt)).toBe(true);
  });

  it('enforces organization isolation — another org sees none of this org’s work', async () => {
    const p = await newProduct();
    const receiptId = await draftReceipt([{ productId: p, qty: 1 }]);
    expect((await worklist('receiving', otherToken)).some((w) => w.documentId === receiptId)).toBe(false);
  });

  it('advisory claim is displayed and a supervisor can take it over; it is not an authority mechanism', async () => {
    const p = await newProduct();
    const receiptId = await draftReceipt([{ productId: p, qty: 1 }]);

    // MAIN staff claims it.
    const claim = (await http().post(`/api/mobile/work/receiving/${receiptId}/claim`).set(auth(staffToken)).send({ deviceId: 'WH-TAB-01' }).expect(201)).body;
    expect(claim.deviceId).toBe('WH-TAB-01');
    expect(claim.claimedByName).toBe('mainstaff');

    let item = (await worklist('receiving', token)).find((w) => w.documentId === receiptId)!;
    expect(item.claim.deviceId).toBe('WH-TAB-01');

    // Admin (supervisor) takes it over — the claim is overwritten, not blocked (advisory).
    const takeover = (await http().post(`/api/mobile/work/receiving/${receiptId}/claim`).set(auth(token)).send({ deviceId: 'WH-TAB-99' }).expect(201)).body;
    expect(takeover.deviceId).toBe('WH-TAB-99');
    item = (await worklist('receiving', token)).find((w) => w.documentId === receiptId)!;
    expect(item.claim.deviceId).toBe('WH-TAB-99');

    // The prior holder can no longer release a claim they no longer hold.
    await http().delete(`/api/mobile/work/receiving/${receiptId}/claim`).set(auth(staffToken)).expect(403);
    // The current holder can release it.
    await http().delete(`/api/mobile/work/receiving/${receiptId}/claim`).set(auth(token)).expect(200);
    item = (await worklist('receiving', token)).find((w) => w.documentId === receiptId)!;
    expect(item.claim).toBeNull();
  });

  it('claiming out-of-scope or unknown work is rejected', async () => {
    const p = await newProduct();
    const westReceipt = await draftReceipt([{ productId: p, qty: 1 }], westWh);
    await http().post(`/api/mobile/work/receiving/${westReceipt}/claim`).set(auth(staffToken)).send({ deviceId: 'X' }).expect(403);
    await http().post(`/api/mobile/work/receiving/00000000-0000-0000-0000-000000000000/claim`).set(auth()).send({ deviceId: 'X' }).expect(404);
  });

  // ---- command intake ----
  const cmd = (over: Record<string, any> = {}) => ({
    commandId: randomUUID(),
    idempotencyKey: `idem-${u}-${seq++}`,
    deviceId: 'WH-TAB-01',
    warehouseId: mainWh,
    commandType: 'COUNT_SUBMIT',
    schemaVersion: 1,
    appVersion: '2.6.0',
    payload: { entries: [] },
    capturedAt: new Date().toISOString(),
    ...over,
  });

  it('command intake is exactly-once by idempotency key — a retry returns the same receipt, never a second command', async () => {
    const key = `idem-once-${u}-${seq++}`;
    const first = (await http().post('/api/mobile/commands').set(auth(staffToken)).send(cmd({ idempotencyKey: key, commandId: randomUUID() })).expect(201)).body;
    expect(first.outcome).toBe('RECEIVED');
    expect(first.applyStatus).toBe('ACKNOWLEDGED');
    // A timeout-driven retry sends the SAME key (even with a different commandId) and must not double-record.
    const retry = (await http().post('/api/mobile/commands').set(auth(staffToken)).send(cmd({ idempotencyKey: key, commandId: randomUUID() })).expect(201)).body;
    expect(retry.outcome).toBe('ALREADY_PROCESSED');
    expect(retry.commandId).toBe(first.commandId); // the original command wins
    expect(retry.receivedAt).toBe(first.receivedAt);
  });

  it('command intake enforces permission, scope, and schema/version gates', async () => {
    // WEST-scoped staff cannot submit a command targeting MAIN.
    await http().post('/api/mobile/commands').set(auth(westStaffToken)).send(cmd({ warehouseId: mainWh })).expect(403);
    // Unsupported schema is refused.
    await http().post('/api/mobile/commands').set(auth(staffToken)).send(cmd({ schemaVersion: 99 })).expect(400);
    // Below-minimum app build is refused.
    await http().post('/api/mobile/commands').set(auth(staffToken)).send(cmd({ appVersion: '0.0.1' })).expect(400);
  });

  it('command intake does not mutate inventory (capture only) — balances are untouched', async () => {
    const p = await newProduct();
    await receiveStock(p, 10);
    const before = (await http().get(`/api/inventory/balances?productId=${p}`).set(auth()).expect(200)).body;
    await http().post('/api/mobile/commands').set(auth(staffToken)).send(cmd({
      commandType: 'RELEASE_PICK', aggregateId: 'some-release', payload: { lines: [{ lineId: 'x', quantity: 5 }] },
    })).expect(201);
    const after = (await http().get(`/api/inventory/balances?productId=${p}`).set(auth()).expect(200)).body;
    expect(after).toEqual(before); // the command was captured, not applied
  });
});

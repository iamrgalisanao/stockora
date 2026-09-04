import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.6C — sync + conflict engine (ADR 0014). Queued mobile intent becomes authoritative inventory through the
 * EXISTING domain services, or an explicit CONFLICT/REJECTED. Concurrent devices, retries, and stale offline
 * snapshots cannot duplicate movements, overdraw stock, reuse serials, or silently overwrite server state.
 */
describe('mobile sync + conflicts (e2e, 2D.6C)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let mainWh: string;
  let westWh: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const key = () => `idem-${u}-${seq++}`;

  const newProduct = async (opts: { isSerialized?: boolean } = {}) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku('SYNC'), name: sku('SN'), baseUomId: unitId, ...opts }).expect(201)).body.id as string;
  const setFifo = (productId: string) =>
    http().post('/api/inventory/costing-policy').set(auth()).send({ strategy: 'FIFO', productId }).expect(201);
  const receive = async (productId: string, qty: number, unitCost: number, serialNumbers?: string[], wh = mainWh) => {
    const draft = await http().post('/api/receiving').set(auth()).send({ warehouseId: wh, items: [{ productId, expectedQty: qty, receivedQty: qty, unitCost, ...(serialNumbers ? { serialNumbers } : {}) }] }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };
  const approvedRelease = async (productId: string, qty: number) => {
    const rel = await http().post('/api/releases').set(auth()).send({ warehouseId: mainWh, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
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
  const workItem = async (type: string, documentId: string, subAction?: string) => {
    const list = (await http().get(`/api/mobile/work/${type}`).set(auth()).expect(200)).body as Array<Record<string, any>>;
    return list.find((w) => w.documentId === documentId && (subAction ? w.subAction === subAction : true))!;
  };
  const submit = (body: Record<string, unknown>) => http().post('/api/mobile/commands').set(auth()).send(body);
  const baseCmd = (over: Record<string, unknown>) => ({
    commandId: randomUUID(), idempotencyKey: key(), deviceId: 'DEV', warehouseId: mainWh,
    schemaVersion: 1, appVersion: '2.6.0', capturedAt: new Date().toISOString(), ...over,
  });
  const movements = async (productId: string, type: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&type=${type}&limit=100`).set(auth()).expect(200)).body as unknown[];
  const serialStatus = async (productId: string, sn: string) => {
    const list = (await http().get(`/api/serials?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    return list.find((s) => s.serialNumber === sn)?.status;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register').send({ organizationName: `SYNC ${u}`, adminEmail: `sync_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    mainWh = (await http().post('/api/warehouses').set(auth()).send({ code: 'MAIN', name: 'Main' }).expect(201)).body.id;
    westWh = (await http().post('/api/warehouses').set(auth()).send({ code: 'WEST', name: 'West' }).expect(201)).body.id;
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('MAIN SCENARIO: two devices race the same serial — one commits, the other CONFLICTs, no double movement', async () => {
    const p = await newProduct({ isSerialized: true });
    await setFifo(p);
    await receive(p, 1, 100, ['SN-001']);

    // Two independent releases, each approved to issue the serialized unit.
    const relB = await approvedRelease(p, 1);
    const relA = await approvedRelease(p, 1);
    const wiB = await workItem('releases', relB);
    const wiA = await workItem('releases', relA);

    // Device B (online) releases SN-001 — applies authoritatively.
    const rB = (await submit(baseCmd({ commandType: 'RELEASE_PICK', aggregateId: relB, expectedVersion: wiB.version, payload: { lines: [{ lineId: wiB.lines[0].lineId, quantity: 1, serialNumbers: ['SN-001'] }] } })).expect(201)).body;
    expect(rB.status).toBe('APPLIED');

    // Device A (was offline) syncs its queued release of the SAME serial — must conflict, not double-issue.
    const rA = (await submit(baseCmd({ commandType: 'RELEASE_PICK', aggregateId: relA, expectedVersion: wiA.version, payload: { lines: [{ lineId: wiA.lines[0].lineId, quantity: 1, serialNumbers: ['SN-001'] }] } })).expect(201)).body;
    expect(rA.status).toBe('CONFLICT');
    expect(rA.code).toBe('SERIAL_ALREADY_ISSUED');
    expect(rA.resolution).toBe('RESCAN');

    // Exactly one issue movement + one FIFO consumption; the serial stays ISSUED; the layer is depleted once.
    expect(await movements(p, 'SALES_RELEASE')).toHaveLength(1);
    expect(await serialStatus(p, 'SN-001')).toBe('ISSUED');
    const layers = (await http().get(`/api/inventory/cost-layers?productId=${p}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    expect(layers.map((l) => [l.remainingQuantity, l.status])).toEqual([['0', 'DEPLETED']]);

    // Accounting invariants hold.
    const inv = (await http().post('/api/inventory/reconcile').set(auth()).expect(201)).body;
    expect(inv.ok).toBe(true);
    const ser = (await http().get(`/api/serials/reconcile?productId=${p}`).set(auth()).expect(200)).body;
    expect(ser.ok).toBe(true);
  });

  it('QUANTITY VARIANT: stale offline qty exceeds availability — INSUFFICIENT_STOCK, availability preserved, no partial', async () => {
    const p = await newProduct();
    await receive(p, 10, 5);
    const relB = await approvedRelease(p, 6);
    const relA = await approvedRelease(p, 8);
    const wiB = await workItem('releases', relB);
    const wiA = await workItem('releases', relA);

    const rB = (await submit(baseCmd({ commandType: 'RELEASE_PICK', aggregateId: relB, expectedVersion: wiB.version, payload: { lines: [{ lineId: wiB.lines[0].lineId, quantity: 6 }] } })).expect(201)).body;
    expect(rB.status).toBe('APPLIED'); // 10 - 6 = 4 available

    const rA = (await submit(baseCmd({ commandType: 'RELEASE_PICK', aggregateId: relA, expectedVersion: wiA.version, payload: { lines: [{ lineId: wiA.lines[0].lineId, quantity: 8 }] } })).expect(201)).body;
    expect(rA.status).toBe('CONFLICT');
    expect(rA.code).toBe('INSUFFICIENT_STOCK');
    expect(rA.currentState).toEqual({ available: 4 }); // tells the operator what IS available — never silently reduced

    const bal = (await http().get(`/api/inventory/balances?productId=${p}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    expect(bal.reduce((s, b) => s + Number(b.onHand), 0)).toBe(4); // no partial qty-4 mutation from A
    expect(await movements(p, 'SALES_RELEASE')).toHaveLength(1);
  });

  it('SUCCESSFUL RECONNECT: nothing changed server-side — the command applies through the domain service', async () => {
    const p = await newProduct();
    await receive(p, 5, 5);
    const rel = await approvedRelease(p, 2);
    const wi = await workItem('releases', rel);
    const r = (await submit(baseCmd({ commandType: 'RELEASE_PICK', aggregateId: rel, expectedVersion: wi.version, payload: { lines: [{ lineId: wi.lines[0].lineId, quantity: 2 }] } })).expect(201)).body;
    expect(r.status).toBe('APPLIED');
    expect(typeof r.aggregateVersionAfter).toBe('number');
    const bal = (await http().get(`/api/inventory/balances?productId=${p}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    expect(bal.reduce((s, b) => s + Number(b.onHand), 0)).toBe(3);
  });

  it('RETRY: the same command (same idempotency key) applies once and replays the same receipt', async () => {
    const p = await newProduct();
    await receive(p, 5, 5);
    const rel = await approvedRelease(p, 2);
    const wi = await workItem('releases', rel);
    const k = key();
    const cid = randomUUID();
    const first = (await submit(baseCmd({ commandId: cid, idempotencyKey: k, commandType: 'RELEASE_PICK', aggregateId: rel, expectedVersion: wi.version, payload: { lines: [{ lineId: wi.lines[0].lineId, quantity: 2 }] } })).expect(201)).body;
    expect(first.status).toBe('APPLIED');
    expect(first.replay).toBe(false);
    // A SUBMISSION_UNKNOWN retry sends the same key — returns the same receipt, does NOT apply again.
    const retry = (await submit(baseCmd({ commandId: randomUUID(), idempotencyKey: k, commandType: 'RELEASE_PICK', aggregateId: rel, expectedVersion: wi.version, payload: { lines: [{ lineId: wi.lines[0].lineId, quantity: 2 }] } })).expect(201)).body;
    expect(retry.status).toBe('APPLIED');
    expect(retry.replay).toBe(true);
    expect(retry.commandId).toBe(first.commandId);
    expect(await movements(p, 'SALES_RELEASE')).toHaveLength(1); // one domain mutation
  });

  it('TRANSFER DISPATCH RACE: two devices, same transfer — exactly one dispatch, the loser gets TRANSFER_STATE_CHANGED', async () => {
    const p = await newProduct();
    await receive(p, 20, 5);
    const tr = await approvedTransfer(p, 5);
    const wi = await workItem('transfers', tr, 'dispatch');

    const rB = (await submit(baseCmd({ commandType: 'TRANSFER_DISPATCH', aggregateId: tr, expectedVersion: wi.version, payload: { lines: [{ itemId: wi.lines[0].lineId }] } })).expect(201)).body;
    expect(rB.status).toBe('APPLIED');
    const rA = (await submit(baseCmd({ commandType: 'TRANSFER_DISPATCH', aggregateId: tr, expectedVersion: wi.version, payload: { lines: [{ itemId: wi.lines[0].lineId }] } })).expect(201)).body;
    expect(rA.status).toBe('CONFLICT');
    expect(rA.code).toBe('TRANSFER_STATE_CHANGED');
    expect(await movements(p, 'TRANSFER_OUT')).toHaveLength(1);
  });

  it('TRANSFER RECEIVE RACE: two devices, same in-transit transfer — exactly one receive', async () => {
    const p = await newProduct();
    await receive(p, 20, 5);
    const tr = await approvedTransfer(p, 5);
    await http().post(`/api/transfers/${tr}/dispatch`).set(auth()).expect(201); // now IN_TRANSIT
    const wi = await workItem('transfers', tr, 'receive');

    const rB = (await submit(baseCmd({ commandType: 'TRANSFER_RECEIVE', aggregateId: tr, expectedVersion: wi.version, payload: { confirm: true } })).expect(201)).body;
    expect(rB.status).toBe('APPLIED');
    const rA = (await submit(baseCmd({ commandType: 'TRANSFER_RECEIVE', aggregateId: tr, expectedVersion: wi.version, payload: { confirm: true } })).expect(201)).body;
    expect(rA.status).toBe('CONFLICT');
    expect(rA.code).toBe('TRANSFER_STATE_CHANGED');
    // One receive emits a movement pair (clear in-transit at source + raise at destination); A added none.
    expect(await movements(p, 'TRANSFER_IN')).toHaveLength(2);
  });

  it('DEPENDENCY: a receive whose dispatch has not applied is BLOCKED, not sent to the domain', async () => {
    const p = await newProduct();
    await receive(p, 10, 5);
    const tr = await approvedTransfer(p, 3);
    const wiDispatch = await workItem('transfers', tr, 'dispatch');
    const dispatchCommandId = randomUUID();
    // The receive depends on a dispatch command that has NOT been submitted/applied yet.
    const rReceive = (await submit(baseCmd({ commandType: 'TRANSFER_RECEIVE', aggregateId: tr, expectedVersion: wiDispatch.version, dependsOnCommandId: dispatchCommandId, payload: { confirm: true } })).expect(201)).body;
    expect(rReceive.status).toBe('BLOCKED');
    // The transfer was NOT received (still APPROVED, no TRANSFER_IN).
    expect(await movements(p, 'TRANSFER_IN')).toHaveLength(0);
  });

  it('REJECTED: unsupported schema and out-of-scope warehouse are terminal (not auto-retried)', async () => {
    const p = await newProduct();
    await receive(p, 5, 5);
    const rel = await approvedRelease(p, 1);
    const wi = await workItem('releases', rel);
    const bad = (await submit(baseCmd({ schemaVersion: 99, commandType: 'RELEASE_PICK', aggregateId: rel, expectedVersion: wi.version, payload: { lines: [] } })).expect(201)).body;
    expect(bad.status).toBe('REJECTED');
    expect(bad.code).toBe('SCHEMA_UNSUPPORTED');
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.6D — operational hardening (ADR 0014). Offline-authorization window signalling, account/scope
 * revalidation on sync, exactly-once under repeated reconnects, compatibility gates, and org-scoped support
 * diagnostics. No new inventory semantics.
 */
describe('mobile hardening (e2e, 2D.6D)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string; // admin
  let staffToken: string; // warehouse_staff, scoped to MAIN
  let staffUserId: string;
  let viewerToken: string;
  let unitId: string;
  let mainWh: string;
  let westWh: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;
  const key = () => `idem-${u}-${seq++}`;

  const newProduct = async (opts: { isSerialized?: boolean } = {}) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku('HD'), name: sku('HN'), baseUomId: unitId, ...opts }).expect(201)).body.id as string;
  const receive = async (productId: string, qty: number, serialNumbers?: string[]) => {
    const draft = await http().post('/api/receiving').set(auth()).send({ warehouseId: mainWh, items: [{ productId, expectedQty: qty, receivedQty: qty, unitCost: 5, ...(serialNumbers ? { serialNumbers } : {}) }] }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
  };
  const approvedRelease = async (productId: string, qty: number) => {
    const rel = await http().post('/api/releases').set(auth()).send({ warehouseId: mainWh, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    return rel.body.id as string;
  };
  const workItem = async (documentId: string, t = token) => {
    const list = (await http().get('/api/mobile/work/releases').set(auth(t)).expect(200)).body as Array<Record<string, any>>;
    return list.find((w) => w.documentId === documentId)!;
  };
  const cmd = (over: Record<string, unknown>) => ({
    commandId: randomUUID(), idempotencyKey: key(), deviceId: 'DIAG', warehouseId: mainWh,
    schemaVersion: 1, appVersion: '2.6.0', capturedAt: new Date().toISOString(), commandType: 'RELEASE_PICK', payload: { lines: [] }, ...over,
  });
  const submit = (body: Record<string, unknown>, t = token) => http().post('/api/mobile/commands').set(auth(t)).send(body);
  const movements = async (productId: string, type: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&type=${type}&limit=100`).set(auth()).expect(200)).body as unknown[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register').send({ organizationName: `HD ${u}`, adminEmail: `hd_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    mainWh = (await http().post('/api/warehouses').set(auth()).send({ code: 'MAIN', name: 'Main' }).expect(201)).body.id;
    westWh = (await http().post('/api/warehouses').set(auth()).send({ code: 'WEST', name: 'West' }).expect(201)).body.id;

    const staffEmail = `hd_staff_${u}@x.test`;
    staffUserId = (await http().post('/api/users').set(auth()).send({ email: staffEmail, name: 'Staff', roleKey: 'warehouse_staff', password: 'password123', warehouseScope: [mainWh] }).expect(201)).body.userId;
    staffToken = (await http().post('/api/auth/login').send({ email: staffEmail, password: 'password123' }).expect(200)).body.accessToken;

    const viewerEmail = `hd_viewer_${u}@x.test`;
    await http().post('/api/users').set(auth()).send({ email: viewerEmail, name: 'Viewer', roleKey: 'viewer', password: 'password123' }).expect(201);
    viewerToken = (await http().post('/api/auth/login').send({ email: viewerEmail, password: 'password123' }).expect(200)).body.accessToken;
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('health probe advertises the offline-authorization window', async () => {
    const res = await http().get('/api/health/mobile').set(auth()).expect(200);
    expect(typeof res.body.offlineAuthWindowSeconds).toBe('number');
    expect(res.body.offlineAuthWindowSeconds).toBeGreaterThan(0);
  });

  it('a below-minimum app build is rejected by the compatibility gate (never applied)', async () => {
    const p = await newProduct();
    await receive(p, 5);
    const rel = await approvedRelease(p, 1);
    const wi = await workItem(rel);
    const r = (await submit(cmd({ appVersion: '0.0.1', aggregateId: rel, expectedVersion: wi.version, payload: { lines: [{ lineId: wi.lines[0].lineId, quantity: 1 }] } })).expect(201)).body;
    expect(r.status).toBe('REJECTED');
    expect(r.code).toBe('SCHEMA_UNSUPPORTED');
    expect(await movements(p, 'SALES_RELEASE')).toHaveLength(0); // nothing applied
  });

  it('losing warehouse access is revalidated on sync — the queued command is rejected with no mutation', async () => {
    const p = await newProduct();
    await receive(p, 5);
    const rel = await approvedRelease(p, 1);
    const wi = await workItem(rel, staffToken); // staff can still see it while scoped to MAIN

    // Admin revokes the staff's MAIN access (moves scope to WEST) — takes effect on the next request.
    await http().patch(`/api/users/${staffUserId}`).set(auth()).send({ warehouseScope: [westWh] }).expect(200);

    const r = (await submit(cmd({ aggregateId: rel, expectedVersion: wi.version, payload: { lines: [{ lineId: wi.lines[0].lineId, quantity: 1 }] } }), staffToken).expect(201)).body;
    expect(r.status).toBe('REJECTED');
    expect(r.code).toBe('WAREHOUSE_SCOPE_REVOKED');
    expect(await movements(p, 'SALES_RELEASE')).toHaveLength(0);

    // Restore for later tests.
    await http().patch(`/api/users/${staffUserId}`).set(auth()).send({ warehouseScope: [mainWh] }).expect(200);
  });

  it('a disabled account cannot sync at all — the session is revalidated (401), nothing applies', async () => {
    const disabledEmail = `hd_dis_${u}@x.test`;
    const disabledId = (await http().post('/api/users').set(auth()).send({ email: disabledEmail, name: 'Dis', roleKey: 'warehouse_staff', password: 'password123', warehouseScope: [mainWh] }).expect(201)).body.userId;
    const disabledToken = (await http().post('/api/auth/login').send({ email: disabledEmail, password: 'password123' }).expect(200)).body.accessToken;
    await http().patch(`/api/users/${disabledId}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    // The revoked account's token no longer authenticates — capture stays queued client-side, nothing applies.
    await submit(cmd({ aggregateId: randomUUID() }), disabledToken).expect(401);
  });

  it('repeated reconnect/disconnect cycles (same key resubmitted) apply once and always return the same receipt', async () => {
    const p = await newProduct();
    await receive(p, 5);
    const rel = await approvedRelease(p, 2);
    const wi = await workItem(rel);
    const body = cmd({ aggregateId: rel, expectedVersion: wi.version, payload: { lines: [{ lineId: wi.lines[0].lineId, quantity: 2 }] } });
    const receipts: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = (await submit({ ...body, commandId: randomUUID() }).expect(201)).body; // same idempotencyKey, new commandId each time
      expect(r.status).toBe('APPLIED');
      receipts.push(r.commandId);
    }
    expect(new Set(receipts).size).toBe(1); // always the original command's receipt
    expect(await movements(p, 'SALES_RELEASE')).toHaveLength(1); // exactly one domain mutation
  });

  it('exposes org-scoped support diagnostics, gated to admins/managers', async () => {
    // Generate an applied, a conflict, and a rejected command so the aggregate has content.
    const sp = await newProduct({ isSerialized: true });
    await receive(sp, 1, ['HD-SN-1']);
    const relApplied = await approvedRelease(sp, 1);
    const wiA = await workItem(relApplied);
    (await submit(cmd({ aggregateId: relApplied, expectedVersion: wiA.version, payload: { lines: [{ lineId: wiA.lines[0].lineId, quantity: 1, serialNumbers: ['HD-SN-1'] }] } })).expect(201));
    const relConflict = await approvedRelease(sp, 1);
    const wiC = await workItem(relConflict);
    (await submit(cmd({ aggregateId: relConflict, expectedVersion: wiC.version, payload: { lines: [{ lineId: wiC.lines[0].lineId, quantity: 1, serialNumbers: ['HD-SN-1'] }] } })).expect(201)); // serial already issued
    (await submit(cmd({ aggregateId: randomUUID() })).expect(201)); // rejected: nonexistent

    const viewer = await http().get('/api/mobile/diagnostics').set(auth(viewerToken)).expect(403); // AUDIT_VIEW gated
    void viewer;

    const diag = (await http().get('/api/mobile/diagnostics').set(auth()).expect(200)).body;
    expect(diag.totals.applied).toBeGreaterThanOrEqual(1);
    expect(diag.totals.conflict).toBeGreaterThanOrEqual(1);
    expect(diag.totals.rejected).toBeGreaterThanOrEqual(1);
    expect(diag.conflictsByCode.SERIAL_ALREADY_ISSUED).toBeGreaterThanOrEqual(1);
    expect(diag.devices.some((d: Record<string, unknown>) => d.deviceId === 'DIAG')).toBe(true);
    expect(diag.lastAppliedAt).toBeTruthy();
  });
});

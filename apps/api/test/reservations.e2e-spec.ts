import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Reservations — core (e2e)', () => {
  let app: INestApplication;
  const u = Date.now();
  let admin: string;
  let adminB: string;
  let scoped: string;
  let unitId: string;
  let whMain: string;
  let whOther: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const newProduct = async (sku: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/products').set(auth(admin)).send({ sku, name: sku, baseUomId: unitId, ...extra }).expect(201)).body.id;
  const opening = (productId: string, warehouseId: string, quantity: number) =>
    http().post('/api/inventory/opening-balances').set(auth(admin)).send({ warehouseId, lines: [{ productId, quantity, unitCost: 10 }] }).expect(201);
  const availableOf = async (productId: string, warehouseId: string) => {
    const bal = (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth(admin)).expect(200)).body;
    return bal.find((b: { warehouseId: string }) => b.warehouseId === warehouseId)?.available ?? '0';
  };
  const createReservation = (token: string, warehouseId: string, lines: unknown[], extra: Record<string, unknown> = {}) =>
    http().post('/api/reservations').set(auth(token)).send({ warehouseId, lines, ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const reg = async (org: string) =>
      (await http().post('/api/auth/register')
        .send({ organizationName: org, adminEmail: `${org}_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)).body.accessToken;
    admin = await reg(`ResA${u}`);
    adminB = await reg(`ResB${u}`);
    unitId = (await http().post('/api/units').set(auth(admin)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whMain = (await http().post('/api/warehouses').set(auth(admin)).send({ code: `MN${u}`, name: 'Main' }).expect(201)).body.id;
    whOther = (await http().post('/api/warehouses').set(auth(admin)).send({ code: `OT${u}`, name: 'Other' }).expect(201)).body.id;

    const sEmail = `resmgr_${u}@x.test`;
    await http().post('/api/users').set(auth(admin))
      .send({ email: sEmail, name: 'Mgr', roleKey: 'warehouse_manager', password: 'password123', warehouseScope: [whMain] }).expect(201);
    scoped = (await http().post('/api/auth/login').send({ email: sEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('reserves when available is sufficient and commits against availability (no stock movement)', async () => {
    const p = await newProduct(`OK-${u}`);
    await opening(p, whMain, 100);
    const r = (await createReservation(admin, whMain, [{ productId: p, quantity: 30 }]).expect(201)).body;
    expect(r.status).toBe('DRAFT');
    const confirmed = (await http().post(`/api/reservations/${r.id}/confirm`).set(auth(admin)).expect(201)).body;
    expect(confirmed.status).toBe('RESERVED');
    // available dropped by 30; on_hand unchanged (reserve is a commitment, not a movement).
    const bal = (await http().get(`/api/inventory/balances?productId=${p}`).set(auth(admin)).expect(200)).body
      .find((b: { warehouseId: string }) => b.warehouseId === whMain);
    expect(bal.onHand).toBe('100');
    expect(bal.reserved).toBe('30');
    expect(bal.available).toBe('70');
  });

  it('rejects a reservation that exceeds availability', async () => {
    const p = await newProduct(`INSUF-${u}`);
    await opening(p, whMain, 5);
    const r = (await createReservation(admin, whMain, [{ productId: p, quantity: 999 }]).expect(201)).body;
    await http().post(`/api/reservations/${r.id}/confirm`).set(auth(admin)).expect(400);
    expect(await availableOf(p, whMain)).toBe('5'); // nothing committed
  });

  it('does not let two concurrent confirmations oversubscribe', async () => {
    const p = await newProduct(`RACE-${u}`);
    await opening(p, whMain, 100);
    const r1 = (await createReservation(admin, whMain, [{ productId: p, quantity: 60 }]).expect(201)).body;
    const r2 = (await createReservation(admin, whMain, [{ productId: p, quantity: 60 }]).expect(201)).body;
    const [a, b] = await Promise.all([
      http().post(`/api/reservations/${r1.id}/confirm`).set(auth(admin)),
      http().post(`/api/reservations/${r2.id}/confirm`).set(auth(admin)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]); // exactly one wins; total reserved never exceeds on-hand
    expect(await availableOf(p, whMain)).toBe('40');
  });

  it('is atomic across lines — one bad line rolls back the whole reservation', async () => {
    const good = await newProduct(`ATOM-G-${u}`);
    const bad = await newProduct(`ATOM-B-${u}`);
    await opening(good, whMain, 50);
    await opening(bad, whMain, 1);
    const r = (await createReservation(admin, whMain, [
      { productId: good, quantity: 20 },
      { productId: bad, quantity: 5 }, // exceeds the 1 available
    ]).expect(201)).body;
    await http().post(`/api/reservations/${r.id}/confirm`).set(auth(admin)).expect(400);
    expect(await availableOf(good, whMain)).toBe('50'); // good line was NOT reserved
  });

  it('refuses inactive product, warehouse, and location', async () => {
    const p = await newProduct(`INACTP-${u}`);
    await http().post(`/api/products/${p}/status`).set(auth(admin)).send({ status: 'INACTIVE' }).expect(201);
    await createReservation(admin, whMain, [{ productId: p, quantity: 1 }]).expect(400);

    const deadWh = (await http().post('/api/warehouses').set(auth(admin)).send({ code: `DEAD${u}`, name: 'Dead' }).expect(201)).body.id;
    await http().post(`/api/warehouses/${deadWh}/status`).set(auth(admin)).send({ status: 'INACTIVE' }).expect(201);
    const p2 = await newProduct(`INACTW-${u}`);
    await createReservation(admin, deadWh, [{ productId: p2, quantity: 1 }]).expect(400);

    const loc = (await http().post(`/api/warehouses/${whMain}/locations`).set(auth(admin)).send({ code: `L${u}` }).expect(201)).body.id;
    await http().post(`/api/warehouses/${whMain}/locations/${loc}/status`).set(auth(admin)).send({ status: 'INACTIVE' }).expect(201);
    await createReservation(admin, whMain, [{ productId: p2, locationId: loc, quantity: 1 }]).expect(400);
  });

  it('returns quantity to availability on release and on cancel', async () => {
    const p = await newProduct(`RET-${u}`);
    await opening(p, whMain, 100);

    const rel = (await createReservation(admin, whMain, [{ productId: p, quantity: 40 }]).expect(201)).body;
    await http().post(`/api/reservations/${rel.id}/confirm`).set(auth(admin)).expect(201);
    expect(await availableOf(p, whMain)).toBe('60');
    await http().post(`/api/reservations/${rel.id}/release`).set(auth(admin)).expect(201);
    expect(await availableOf(p, whMain)).toBe('100');

    const can = (await createReservation(admin, whMain, [{ productId: p, quantity: 25 }]).expect(201)).body;
    await http().post(`/api/reservations/${can.id}/confirm`).set(auth(admin)).expect(201);
    expect(await availableOf(p, whMain)).toBe('75');
    await http().post(`/api/reservations/${can.id}/cancel`).set(auth(admin)).expect(201);
    expect(await availableOf(p, whMain)).toBe('100');
  });

  it('enforces org isolation and warehouse scope, and audits with a correlation id', async () => {
    const p = await newProduct(`SCOPE-${u}`);
    await opening(p, whMain, 10);
    const r = (await createReservation(admin, whMain, [{ productId: p, quantity: 2 }]).expect(201)).body;
    await http().post(`/api/reservations/${r.id}/confirm`).set(auth(admin)).expect(201);

    await http().get(`/api/reservations/${r.id}`).set(auth(adminB)).expect(404); // other org
    await http().get(`/api/reservations/${r.id}`).set(auth(scoped)).expect(200); // whMain is in scope
    await createReservation(scoped, whOther, [{ productId: p, quantity: 1 }]).expect(403); // out of scope warehouse

    const audit = (await http().get(`/api/audit?entityType=reservation&entityId=${r.id}`).set(auth(admin)).expect(200)).body.entries;
    const actions = audit.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['reservation.created', 'reservation.confirmed']));
    expect(audit.every((a: { correlationId: string | null }) => a.correlationId)).toBe(true);
  });

  it('keeps a historical reservation readable after the product is archived', async () => {
    const p = await newProduct(`HIST-${u}`); // no stock -> archivable
    const r = (await createReservation(admin, whMain, [{ productId: p, quantity: 3 }]).expect(201)).body;
    await http().post(`/api/reservations/${r.id}/cancel`).set(auth(admin)).expect(201); // DRAFT -> CANCELLED
    await http().post(`/api/products/${p}/status`).set(auth(admin)).send({ status: 'ARCHIVED' }).expect(201);

    const still = (await http().get(`/api/reservations/${r.id}`).set(auth(admin)).expect(200)).body;
    expect(still.status).toBe('CANCELLED');
    expect(still.lines[0].productSku).toBe(`HIST-${u}`); // identity still resolves
  });
});

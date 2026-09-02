import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Audit Explorer — read model (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let adminA: string;
  let adminB: string;
  let managerX: string; // warehouse-scoped to whX
  let staffToken: string; // no audit.view
  let whX: string;
  let whY: string;
  let unitId: string;
  let archivedProductId: string;
  let archivedSku: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const register = async (org: string) =>
    (
      await http().post('/api/auth/register')
        .send({ organizationName: org, adminEmail: `${org}_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    adminA = await register(`AuditA${unique}`);
    adminB = await register(`AuditB${unique}`);

    unitId = (await http().post('/api/units').set(auth(adminA)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whX = (await http().post('/api/warehouses').set(auth(adminA)).send({ code: 'WHX', name: 'X' }).expect(201)).body.id;
    whY = (await http().post('/api/warehouses').set(auth(adminA)).send({ code: 'WHY', name: 'Y' }).expect(201)).body.id;
    await http().post(`/api/warehouses/${whX}/locations`).set(auth(adminA)).send({ code: 'BINX' }).expect(201);

    // A product we archive, to prove entity identity survives in the log.
    archivedSku = `ARCH-${unique}`;
    archivedProductId = (await http().post('/api/products').set(auth(adminA)).send({ sku: archivedSku, name: 'Arch', baseUomId: unitId }).expect(201)).body.id;
    await http().post(`/api/products/${archivedProductId}/status`).set(auth(adminA)).send({ status: 'INACTIVE' }).expect(201);
    await http().post(`/api/products/${archivedProductId}/status`).set(auth(adminA)).send({ status: 'ARCHIVED' }).expect(201);

    // Some org-B activity (isolation).
    await http().post('/api/units').set(auth(adminB)).send({ code: 'BOX', name: 'Box' }).expect(201);

    // A warehouse-scoped manager (whX only) and a no-audit staff user.
    const mkUser = async (role: string, scope?: string[]) => {
      const email = `${role}_${scope ? 'scoped' : 'x'}_${unique}@x.test`;
      await http().post('/api/users').set(auth(adminA))
        .send({ email, name: 'Scoped Person', roleKey: role, password: 'password123', ...(scope ? { warehouseScope: scope } : {}) })
        .expect(201);
      return (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken;
    };
    managerX = await mkUser('warehouse_manager', [whX]);
    staffToken = await mkUser('warehouse_staff');
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces the audit.view permission', async () => {
    await http().get('/api/audit').set(auth(staffToken)).expect(403);
    await http().get('/api/audit').set(auth(adminA)).expect(200);
  });

  it('isolates audit history by organization', async () => {
    const a = (await http().get('/api/audit?limit=100').set(auth(adminA)).expect(200)).body;
    const b = (await http().get('/api/audit?limit=100').set(auth(adminB)).expect(200)).body;
    const aOrgs = new Set(a.entries.map((e: { organizationId: string }) => e.organizationId));
    expect(aOrgs.size).toBe(1);
    // Org B never sees org A's warehouse/product events.
    expect(b.entries.some((e: { entityDisplay: string | null }) => e.entityDisplay === 'WHX')).toBe(false);
  });

  it('enforces warehouse scope (scoped user sees only their warehouse-tagged events)', async () => {
    const res = (await http().get('/api/audit?limit=100').set(auth(managerX)).expect(200)).body;
    const warehouseIds = new Set(res.entries.map((e: { warehouseId: string | null }) => e.warehouseId));
    // Only whX; never null (org-wide) or whY.
    expect([...warehouseIds]).toEqual([whX]);
    expect(res.entries.some((e: { entityDisplay: string | null }) => e.entityDisplay === 'WHX')).toBe(true);
    expect(res.entries.some((e: { entityDisplay: string | null }) => e.entityDisplay === 'WHY')).toBe(false);
    // A cross-scope warehouse filter yields nothing rather than leaking.
    const denied = (await http().get(`/api/audit?warehouseId=${whY}`).set(auth(managerX)).expect(200)).body;
    expect(denied.entries).toEqual([]);
  });

  it('filters by entity type + id, action, and free text', async () => {
    const byEntity = (await http().get(`/api/audit?entityType=product&entityId=${archivedProductId}`).set(auth(adminA)).expect(200)).body;
    expect(byEntity.entries.length).toBeGreaterThanOrEqual(3); // created + 2 status changes
    expect(byEntity.entries.every((e: { entityId: string }) => e.entityId === archivedProductId)).toBe(true);

    const byAction = (await http().get('/api/audit?action=product.status_changed&limit=100').set(auth(adminA)).expect(200)).body;
    expect(byAction.entries.every((e: { action: string }) => e.action === 'product.status_changed')).toBe(true);

    const byText = (await http().get(`/api/audit?q=${archivedSku}&limit=100`).set(auth(adminA)).expect(200)).body;
    expect(byText.entries.some((e: { entityDisplay: string | null }) => e.entityDisplay === archivedSku)).toBe(true);
  });

  it('filters by actor and by date range', async () => {
    const all = (await http().get('/api/audit?limit=1').set(auth(adminA)).expect(200)).body;
    const actorId = all.entries[0].actorId;
    expect(actorId).toBeTruthy();
    const byActor = (await http().get(`/api/audit?actorId=${actorId}&limit=100`).set(auth(adminA)).expect(200)).body;
    expect(byActor.entries.every((e: { actorId: string }) => e.actorId === actorId)).toBe(true);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const future = (await http().get(`/api/audit?from=${tomorrow}`).set(auth(adminA)).expect(200)).body;
    expect(future.entries).toEqual([]);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const recent = (await http().get(`/api/audit?from=${yesterday}&limit=5`).set(auth(adminA)).expect(200)).body;
    expect(recent.entries.length).toBeGreaterThan(0);
  });

  it('paginates stably even when many rows share a timestamp', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/audit?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page: { entries: Array<{ id: string }>; nextCursor: string | null } =
        (await http().get(url).set(auth(adminA)).expect(200)).body;
      for (const e of page.entries) {
        expect(seen.has(e.id)).toBe(false); // no duplicates across pages
        seen.add(e.id);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    expect(seen.size).toBeGreaterThan(5); // actually walked multiple pages
  });

  it('keeps a meaningful entity identity and actor snapshot for archived records', async () => {
    const res = (await http().get(`/api/audit?entityType=product&entityId=${archivedProductId}&action=product.status_changed`).set(auth(adminA)).expect(200)).body;
    const archived = res.entries.find((e: { changes: { status?: { to: string } } | null }) => e.changes?.status?.to === 'ARCHIVED');
    expect(archived).toBeTruthy();
    expect(archived.entityDisplay).toBe(archivedSku); // identity snapshot, not a live join
    expect(archived.actorDisplayName).toBe('Admin'); // survives independent of the User row
  });

  it('groups records from one operation under a shared correlation id', async () => {
    const corr = randomUUID();
    const p1 = `CORR1-${unique}`;
    const p2 = `CORR2-${unique}`;
    await http().post('/api/products').set(auth(adminA)).set('X-Correlation-Id', corr).send({ sku: p1, name: p1, baseUomId: unitId }).expect(201);
    await http().post('/api/products').set(auth(adminA)).set('X-Correlation-Id', corr).send({ sku: p2, name: p2, baseUomId: unitId }).expect(201);

    const related = (await http().get(`/api/audit/correlation/${corr}`).set(auth(adminA)).expect(200)).body;
    const skus = related.map((e: { entityDisplay: string | null }) => e.entityDisplay);
    expect(skus).toEqual(expect.arrayContaining([p1, p2]));
    expect(related.every((e: { correlationId: string }) => e.correlationId === corr)).toBe(true);
  });
});

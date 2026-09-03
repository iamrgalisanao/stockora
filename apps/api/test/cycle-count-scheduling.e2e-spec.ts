import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 2C.3A — ABC classification + scheduling core (ADR 0009). Planning layer only: it creates tasks, never
 * counts. Since count completion arrives in 2C.3B, tests that need a "last counted" fact insert a COMPLETED
 * task directly via Prisma (the coverage read model derives lastCountedAt from completed tasks).
 */
describe('Cycle counting — ABC + scheduling (e2e, 2C.3A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let orgId: string;
  let userId: string;
  let unitId: string;

  const NIL = '00000000-0000-0000-0000-000000000000';
  const DAY = 86_400_000;
  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newWarehouse = async () => (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}-${seq++}`, name: 'W' }).expect(201)).body.id as string;
  const newProduct = async (prefix: string, batch = false) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: batch }).expect(201)).body.id as string;
  const seed = (productId: string, qty: number, whId: string, lotNumber?: string) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 5, ...(lotNumber ? { lotNumber } : {}) }] }).expect(201);

  const upsertPolicy = (body: Record<string, unknown>) => http().put('/api/cycle-count/policy').set(auth()).send(body).expect(200);
  const classify = async (whId: string, strategy?: string) =>
    (await http().post('/api/cycle-count/classify').set(auth()).send({ warehouseId: whId, ...(strategy ? { strategy } : {}) })).body;
  const setClass = (whId: string, productId: string, abcClass: string) =>
    http().put('/api/cycle-count/classification').set(auth()).send({ warehouseId: whId, productId, abcClass }).expect(200);
  const listClass = async (whId: string, t = token) =>
    (await http().get(`/api/cycle-count/classifications?warehouseId=${whId}`).set(auth(t)).expect(200)).body as Array<Record<string, any>>;
  const coverage = async (whId: string, dueOnly = false) =>
    (await http().get(`/api/cycle-count/coverage?warehouseId=${whId}${dueOnly ? '&dueOnly=true' : ''}`).set(auth()).expect(200)).body as Array<Record<string, any>>;
  const generate = async (whId: string) =>
    (await http().post('/api/cycle-count/generate').set(auth()).send({ warehouseId: whId }).expect(201)).body as Array<Record<string, any>>;
  const listTasks = async (whId: string, q = '', t = token) =>
    (await http().get(`/api/cycle-count/tasks?warehouseId=${whId}${q}`).set(auth(t)).expect(200)).body as Array<Record<string, any>>;

  const insertCompleted = (whId: string, productId: string, daysAgo: number, abcClass = 'C', lotId = NIL) =>
    prisma.cycleCountTask.create({
      data: {
        organizationId: orgId, warehouseId: whId, productId, variantId: NIL, lotId, abcClass: abcClass as any,
        priority: 3, status: 'COMPLETED', source: 'SCHEDULED', dueAt: new Date(Date.now() - daysAgo * DAY), completedAt: new Date(Date.now() - daysAgo * DAY),
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `CC ${u}`, adminEmail: `cc_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    const me = (await http().get('/api/auth/me').set(auth()).expect(200)).body;
    userId = me.id; orgId = me.organizationId;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('manual ABC assignment works and is scoped to a warehouse', async () => {
    const wh = await newWarehouse();
    const p = await newProduct('MAN');
    await seed(p, 5, wh);
    const row = (await http().put('/api/cycle-count/classification').set(auth()).send({ warehouseId: wh, productId: p, abcClass: 'A' }).expect(200)).body;
    expect(row.abcClass).toBe('A');
    expect(row.manual).toBe(true);
    expect(row.strategy).toBe('MANUAL');
    const rows = await listClass(wh);
    expect(rows.find((r) => r.productId === p)!.abcClass).toBe('A');
  });

  it('automatic MOVEMENT_VELOCITY classification is deterministic and buckets by configurable thresholds', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, strategy: 'MOVEMENT_VELOCITY', aPercent: 40, bPercent: 40 });
    const hi = await newProduct('VEL-HI');
    const mid = await newProduct('VEL-MID');
    const lo = await newProduct('VEL-LO');
    await seed(hi, 100, wh);
    await seed(mid, 50, wh);
    await seed(lo, 10, wh);
    const first = await classify(wh);
    const cls = (rows: Array<Record<string, any>>, id: string) => rows.find((r) => r.productId === id)!.abcClass;
    expect(cls(first, hi)).toBe('A');
    expect(cls(first, mid)).toBe('B');
    expect(cls(first, lo)).toBe('C');
    // Deterministic: a second run yields the same classes.
    const second = await classify(wh);
    expect(cls(second, hi)).toBe('A');
    expect(cls(second, mid)).toBe('B');
    expect(cls(second, lo)).toBe('C');
  });

  it('classification is scoped by warehouse and isolated by org', async () => {
    const wh1 = await newWarehouse();
    const wh2 = await newWarehouse();
    const p = await newProduct('SCOPE');
    await seed(p, 20, wh1);
    await classify(wh1);
    expect((await listClass(wh1)).length).toBeGreaterThan(0);
    expect((await listClass(wh2)).length).toBe(0); // nothing stocked in wh2

    const other = (await http().post('/api/auth/register').send({ organizationName: `CCX ${u}`, adminEmail: `ccx_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    await http().get(`/api/cycle-count/classifications?warehouseId=${wh1}`).set(auth(other)).expect(404); // not this org's warehouse
  });

  it('coverage derives next-due from class frequency, so A and C differ; overdue uses the business date', async () => {
    const wh = await newWarehouse();
    const pa = await newProduct('FREQ-A');
    const pc = await newProduct('FREQ-C');
    await seed(pa, 5, wh);
    await seed(pc, 5, wh);
    await setClass(wh, pa, 'A'); // default A freq = 30d
    await setClass(wh, pc, 'C'); // default C freq = 180d
    await insertCompleted(wh, pa, 60, 'A');
    await insertCompleted(wh, pc, 60, 'C');
    const rows = await coverage(wh);
    const a = rows.find((r) => r.productId === pa)!;
    const c = rows.find((r) => r.productId === pc)!;
    // Counted 60d ago: A (30d cadence) is overdue; C (180d cadence) is not yet due.
    expect(a.overdue).toBe(true);
    expect(c.overdue).toBe(false);
    // nextDue = lastCounted + frequency.
    expect(Math.round((new Date(a.nextDueAt).getTime() - new Date(a.lastCountedAt).getTime()) / DAY)).toBe(30);
    expect(Math.round((new Date(c.nextDueAt).getTime() - new Date(c.lastCountedAt).getTime()) / DAY)).toBe(180);
  });

  it('a never-counted, classified, stocked scope is due; zero-stock scopes are excluded', async () => {
    const wh = await newWarehouse();
    const stocked = await newProduct('COV-STOCK');
    const empty = await newProduct('COV-EMPTY');
    await seed(stocked, 7, wh);
    await setClass(wh, stocked, 'B');
    // `empty` has no opening balance → no balance row → not a coverage scope.
    const rows = await coverage(wh);
    expect(rows.find((r) => r.productId === stocked)!.overdue).toBe(true); // never counted → due now
    expect(rows.find((r) => r.productId === empty)).toBeUndefined();
  });

  it('scheduler creates a task when due, never duplicates an active scope, and is idempotent', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const p = await newProduct('GEN');
    await seed(p, 9, wh);
    await setClass(wh, p, 'A');
    const first = await generate(wh);
    expect(first.length).toBe(1);
    expect(first[0]!.productId).toBe(p);
    expect(first[0]!.status).toBe('PENDING');
    expect(first[0]!.source).toBe('SCHEDULED');
    // Re-run: the scope already has an active task → nothing new.
    const second = await generate(wh);
    expect(second.length).toBe(0);
    expect((await listTasks(wh)).filter((t) => t.productId === p).length).toBe(1);
  });

  it('refuses to generate without an enabled policy, and skips UNCLASSIFIED scopes', async () => {
    const wh = await newWarehouse();
    const p = await newProduct('NOPOL');
    await seed(p, 3, wh);
    await setClass(wh, p, 'A');
    // No policy row yet → generation disabled.
    await http().post('/api/cycle-count/generate').set(auth()).send({ warehouseId: wh }).expect(400);
    // Enable policy but leave a second product UNCLASSIFIED → only the classified one is scheduled.
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const unclassified = await newProduct('NOPOL-U');
    await seed(unclassified, 3, wh);
    const created = await generate(wh);
    expect(created.map((t) => t.productId)).toEqual([p]);
  });

  it('snapshots class/policy onto the task; a later reclassification changes coverage but not the task (history preserved)', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const p = await newProduct('SNAP');
    await seed(p, 4, wh);
    await setClass(wh, p, 'B');
    const [task] = await generate(wh);
    expect(task!.abcClass).toBe('B');
    const full = (await http().get(`/api/cycle-count/tasks/${task!.id}`).set(auth()).expect(200)).body;
    expect(full.abcClass).toBe('B');
    // Reclassify the scope.
    await setClass(wh, p, 'A');
    // Coverage (planning) reflects the new class …
    expect((await coverage(wh)).find((r) => r.productId === p)!.abcClass).toBe('A');
    // … but the already-generated task keeps its original snapshot.
    const after = (await http().get(`/api/cycle-count/tasks/${task!.id}`).set(auth()).expect(200)).body;
    expect(after.abcClass).toBe('B');
  });

  it('batch-tracked products schedule lot-aware tasks; non-lot products stay product-level', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const batch = await newProduct('LOT', true);
    await seed(batch, 5, wh, 'LOT-A');
    await seed(batch, 5, wh, 'LOT-B');
    await setClass(wh, batch, 'A');
    const plain = await newProduct('PLAIN');
    await seed(plain, 5, wh);
    await setClass(wh, plain, 'A');
    const created = await generate(wh);
    const batchTasks = created.filter((t) => t.productId === batch);
    expect(batchTasks.length).toBe(2); // one per lot
    expect(batchTasks.every((t) => t.lotId && t.lotNumber)).toBe(true);
    const plainTask = created.find((t) => t.productId === plain)!;
    expect(plainTask.lotId).toBeNull();
    expect(plainTask.lotNumber).toBeNull();
  });

  it('overdue is derived from dueAt: a past-due generated task is overdue, an ad-hoc task due today is not', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const past = await newProduct('OD-PAST');
    await seed(past, 5, wh);
    await setClass(wh, past, 'A');
    await insertCompleted(wh, past, 60, 'A'); // last counted 60d ago, A cadence 30d → due 30d ago
    const [pastTask] = await generate(wh);
    expect(pastTask!.overdue).toBe(true);

    const adhoc = await newProduct('OD-ADHOC');
    await seed(adhoc, 5, wh);
    const created = (await http().post('/api/cycle-count/tasks').set(auth()).send({ warehouseId: wh, productId: adhoc }).expect(201)).body;
    expect(created.source).toBe('AD_HOC');
    expect(created.overdue).toBe(false); // due today, not past
  });

  it('ad-hoc tasks are allowed and rejected when an active scope task already exists', async () => {
    const wh = await newWarehouse();
    const p = await newProduct('ADH');
    await seed(p, 5, wh);
    const first = (await http().post('/api/cycle-count/tasks').set(auth()).send({ warehouseId: wh, productId: p }).expect(201)).body;
    expect(first.abcClass).toBe('UNCLASSIFIED'); // ad-hoc allowed even without a class
    // A second active task for the same scope is refused (ADR 0009 §7).
    await http().post('/api/cycle-count/tasks').set(auth()).send({ warehouseId: wh, productId: p }).expect(400);
  });

  it('assignment sets an assignee and refuses a non-member', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const p = await newProduct('ASG');
    await seed(p, 5, wh);
    await setClass(wh, p, 'A');
    const [task] = await generate(wh);
    const assigned = (await http().post(`/api/cycle-count/tasks/${task!.id}/assign`).set(auth()).send({ assignedToId: userId }).expect(201)).body;
    expect(assigned.status).toBe('ASSIGNED');
    expect(assigned.assignedToId).toBe(userId);
    expect(assigned.assignedToName).toBe('Admin');
    // A random (non-member) user id is refused.
    await http().post(`/api/cycle-count/tasks/${task!.id}/assign`).set(auth()).send({ assignedToId: '11111111-1111-4111-8111-111111111111' }).expect(400);
  });

  it('archived products are excluded from classification, coverage, and scheduling', async () => {
    const wh = await newWarehouse();
    await upsertPolicy({ warehouseId: wh, enabled: true });
    const p = await newProduct('ARCH');
    await seed(p, 5, wh);
    await setClass(wh, p, 'A');
    await prisma.product.update({ where: { id: p }, data: { status: 'ARCHIVED' } });
    expect((await coverage(wh)).find((r) => r.productId === p)).toBeUndefined();
    expect((await generate(wh)).length).toBe(0);
  });
});

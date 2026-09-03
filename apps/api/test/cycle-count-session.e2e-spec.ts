import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2C.3B — Count Session Integration (ADR 0009 §6). A cycle-count task executes through the EXISTING
 * lot-aware StockCount(type=CYCLE) engine: one task = one authoritative count, IN_PROGRESS on start,
 * COMPLETED only after POSTED, variance posts through the existing ledger path, recounts are new work.
 */
describe('Cycle counting — count session integration (e2e, 2C.3B)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let userId: string;
  let unitId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newWarehouse = async () => (await http().post('/api/warehouses').set(auth()).send({ code: `W${u}-${seq++}`, name: 'W' }).expect(201)).body.id as string;
  const newProduct = async (prefix: string, batch = false) =>
    (await http().post('/api/products').set(auth()).send({ sku: sku(prefix), name: prefix, baseUomId: unitId, isBatchTracked: batch }).expect(201)).body.id as string;
  const seed = (productId: string, qty: number, whId: string, lotNumber?: string) =>
    http().post('/api/inventory/opening-balances').set(auth())
      .send({ warehouseId: whId, lines: [{ productId, quantity: qty, unitCost: 5, ...(lotNumber ? { lotNumber } : {}) }] }).expect(201);

  const upsertPolicy = (whId: string) => http().put('/api/cycle-count/policy').set(auth()).send({ warehouseId: whId, enabled: true }).expect(200);
  const setClass = (whId: string, productId: string, abcClass: string) =>
    http().put('/api/cycle-count/classification').set(auth()).send({ warehouseId: whId, productId, abcClass }).expect(200);
  const generate = async (whId: string) => (await http().post('/api/cycle-count/generate').set(auth()).send({ warehouseId: whId }).expect(201)).body as Array<Record<string, any>>;
  const getTask = async (id: string, t = token) => (await http().get(`/api/cycle-count/tasks/${id}`).set(auth(t)).expect(200)).body as Record<string, any>;
  const start = async (id: string, t = token) => (await http().post(`/api/cycle-count/tasks/${id}/start`).set(auth(t))).body as Record<string, any>;
  const coverage = async (whId: string) => (await http().get(`/api/cycle-count/coverage?warehouseId=${whId}`).set(auth()).expect(200)).body as Array<Record<string, any>>;

  const getCount = async (id: string) => (await http().get(`/api/counts/${id}`).set(auth()).expect(200)).body as Record<string, any>;
  const enter = (id: string, items: Array<{ itemId: string; countedQty: number }>) => http().post(`/api/counts/${id}/entries`).set(auth()).send({ items }).expect(201);
  const submit = (id: string) => http().post(`/api/counts/${id}/submit`).set(auth()).expect(201);
  const approve = (id: string) => http().post(`/api/counts/${id}/approve`).set(auth()).expect(201);
  const post = (id: string) => http().post(`/api/counts/${id}/post`).set(auth()).expect(201);

  // Generate one due task for a freshly-set-up warehouse/product and return it.
  const dueTask = async (prefix: string, qty: number, batch = false, lotNumber?: string) => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct(prefix, batch);
    await seed(p, qty, wh, lotNumber);
    await setClass(wh, p, 'A');
    const task = (await generate(wh))[0]!;
    return { wh, p, task };
  };
  // Run a task all the way to COMPLETED with a given counted quantity.
  const completeTask = async (taskId: string, countedQty: number) => {
    const started = await start(taskId);
    const count = await getCount(started.physicalCountId);
    await enter(count.id, [{ itemId: count.items[0].id, countedQty }]);
    await submit(count.id);
    await approve(count.id);
    await post(count.id);
    return count.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `CCS ${u}`, adminEmail: `ccs_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    userId = (await http().get('/api/auth/me').set(auth()).expect(200)).body.id;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('start creates exactly one CYCLE count, sets IN_PROGRESS, and a replayed start reuses it', async () => {
    const { task } = await dueTask('START', 20);
    const started = await start(task.id);
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.physicalCountId).toBeTruthy();
    const count = await getCount(started.physicalCountId);
    expect(count.type).toBe('CYCLE');
    expect(count.cycleCountTaskId).toBe(task.id);
    // Replayed start → same count.
    const again = await start(task.id);
    expect(again.physicalCountId).toBe(started.physicalCountId);
  });

  it('concurrent starts cannot create two counts', async () => {
    const { task } = await dueTask('CONC', 15);
    const [a, b] = await Promise.all([start(task.id), start(task.id)]);
    expect(a.physicalCountId).toBeTruthy();
    expect(a.physicalCountId).toBe(b.physicalCountId);
  });

  it('the count snapshot matches the task scope: a lot task snapshots exactly its lot', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct('SCOPE-LOT', true);
    await seed(p, 40, wh, 'LOT-A');
    await seed(p, 10, wh, 'LOT-B');
    await setClass(wh, p, 'A');
    const tasks = await generate(wh);
    const lotATask = tasks.find((t) => t.lotNumber === 'LOT-A')!;
    const started = await start(lotATask.id);
    const count = await getCount(started.physicalCountId);
    expect(count.items.length).toBe(1);
    expect(count.items[0].lotId).toBe(lotATask.lotId);
    expect(count.items[0].systemQty).toBe('40'); // exactly LOT-A, not LOT-B
  });

  it('a non-lot task snapshots the product-level (NIL-lot) row', async () => {
    const { task } = await dueTask('SCOPE-PLAIN', 25);
    const started = await start(task.id);
    const count = await getCount(started.physicalCountId);
    expect(count.items.length).toBe(1);
    expect(count.items[0].lotId).toBeNull();
    expect(count.items[0].systemQty).toBe('25');
  });

  it('submit and approve do NOT complete the task; only POSTED does', async () => {
    const { task } = await dueTask('LIFECYCLE', 12);
    const started = await start(task.id);
    const count = await getCount(started.physicalCountId);
    await enter(count.id, [{ itemId: count.items[0].id, countedQty: 12 }]);
    await submit(count.id);
    expect((await getTask(task.id)).status).toBe('IN_PROGRESS');
    await approve(count.id);
    expect((await getTask(task.id)).status).toBe('IN_PROGRESS');
    await post(count.id);
    const done = await getTask(task.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.completedAt).toBeTruthy();
  });

  it('a failed posting (count not approved) leaves the task IN_PROGRESS', async () => {
    const { task } = await dueTask('FAILPOST', 8);
    const started = await start(task.id);
    const count = await getCount(started.physicalCountId);
    await enter(count.id, [{ itemId: count.items[0].id, countedQty: 8 }]);
    // Posting a still-COUNTING count is rejected by the count engine → task must remain IN_PROGRESS.
    await http().post(`/api/counts/${count.id}/post`).set(auth()).expect(400);
    expect((await getTask(task.id)).status).toBe('IN_PROGRESS');
  });

  it('a cancelled task cannot start; a completed task cannot restart', async () => {
    const { task: toCancel } = await dueTask('CANCEL', 5);
    await http().post(`/api/cycle-count/tasks/${toCancel.id}/cancel`).set(auth()).expect(201);
    expect((await getTask(toCancel.id)).status).toBe('CANCELLED');
    await http().post(`/api/cycle-count/tasks/${toCancel.id}/start`).set(auth()).expect(400);

    const { task: done } = await dueTask('RESTART', 5);
    await completeTask(done.id, 5);
    await http().post(`/api/cycle-count/tasks/${done.id}/start`).set(auth()).expect(400);
  });

  it('cancelling a task with an active count also cancels the count (never orphaned)', async () => {
    const { task } = await dueTask('COORD', 9);
    const started = await start(task.id);
    await http().post(`/api/cycle-count/tasks/${task.id}/cancel`).set(auth()).expect(201);
    expect((await getTask(task.id)).status).toBe('CANCELLED');
    expect((await getCount(started.physicalCountId)).status).toBe('CANCELLED');
  });

  it('recount creates a NEW task pointing at the superseded one, with a separate count; the original is untouched', async () => {
    const { task } = await dueTask('RECOUNT', 30);
    const origCountId = await completeTask(task.id, 30);
    const orig = await getTask(task.id);

    const rc = (await http().post(`/api/cycle-count/tasks/${task.id}/recount`).set(auth()).expect(201)).body;
    expect(rc.id).not.toBe(task.id);
    expect(rc.source).toBe('RECOUNT');
    expect(rc.supersedesTaskId).toBe(task.id);
    expect(rc.status).toBe('IN_PROGRESS');
    expect(rc.physicalCountId).not.toBe(origCountId); // a separate StockCount
    // Original stays COMPLETED and keeps its own count.
    expect(orig.status).toBe('COMPLETED');
    expect(orig.physicalCountId).toBe(origCountId);
    // Only a completed task can be recounted.
    await http().post(`/api/cycle-count/tasks/${rc.id}/recount`).set(auth()).expect(400);
  });

  it('org scope is enforced — another org cannot see or start the task', async () => {
    const { task } = await dueTask('SCOPE-ORG', 5);
    const other = (await http().post('/api/auth/register').send({ organizationName: `CCS2 ${u}`, adminEmail: `ccs2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    await http().get(`/api/cycle-count/tasks/${task.id}`).set(auth(other)).expect(404);
    await http().post(`/api/cycle-count/tasks/${task.id}/start`).set(auth(other)).expect(404);
  });

  it('integration: generate → assign → start → count 37 of 40 → submit → approve → post → COMPLETED; variance hits the ledger and coverage updates', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct('SCENARIO', true);
    await seed(p, 40, wh, 'LOT-A');
    await setClass(wh, p, 'A');
    const task = (await generate(wh))[0]!;

    // assign
    const assigned = (await http().post(`/api/cycle-count/tasks/${task.id}/assign`).set(auth()).send({ assignedToId: userId }).expect(201)).body;
    expect(assigned.status).toBe('ASSIGNED');

    // start → snapshot expected 40
    const started = await start(task.id);
    const count = await getCount(started.physicalCountId);
    expect(count.items[0].systemQty).toBe('40');

    // count 37 → submit → approve → post
    await enter(count.id, [{ itemId: count.items[0].id, countedQty: 37 }]);
    await submit(count.id);
    await approve(count.id);
    const posted = (await post(count.id)).body;
    expect(posted.status).toBe('POSTED');
    expect(posted.items[0].varianceQty).toBe('-3'); // -3 through the existing count/ledger path

    // task COMPLETED + coverage lastCountedAt set, next due derived (A cadence = 30d)
    const done = await getTask(task.id);
    expect(done.status).toBe('COMPLETED');
    const cov = (await coverage(wh)).find((r) => r.lotNumber === 'LOT-A')!;
    expect(cov.onHand).toBe('37'); // ledger truth after the -3 variance
    expect(cov.lastCountedAt).toBeTruthy();
    expect(Math.round((new Date(cov.nextDueAt).getTime() - new Date(cov.lastCountedAt).getTime()) / 86_400_000)).toBe(30);
    expect(cov.overdue).toBe(false);

    // Reconciliation: a fresh recount snapshot reads the updated on-hand (37), proving the ledger is the truth.
    const rc = (await http().post(`/api/cycle-count/tasks/${task.id}/recount`).set(auth()).expect(201)).body;
    const rcCount = await getCount(rc.physicalCountId);
    expect(rcCount.items[0].systemQty).toBe('37');
  });
});

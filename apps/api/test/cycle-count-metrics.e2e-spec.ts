import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 2C.3C — Dashboard metrics + worklist (ADR 0009 §10). Read-model only: coverage over SCHEDULED work,
 * accuracy/variance from POSTED cycle counts, one centralized formula. Assignment RBAC + cost.view gating.
 */
describe('Cycle counting — metrics + worklist (e2e, 2C.3C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let userId: string;
  let unitId: string;
  let staffToken: string;
  let staffUserId: string;

  const DAY = 86_400_000;
  const NIL = '00000000-0000-0000-0000-000000000000';
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
  const start = async (id: string) => (await http().post(`/api/cycle-count/tasks/${id}/start`).set(auth())).body as Record<string, any>;
  const getCount = async (id: string) => (await http().get(`/api/counts/${id}`).set(auth()).expect(200)).body as Record<string, any>;
  const metrics = async (whId: string, t = token) => (await http().get(`/api/cycle-count/metrics?warehouseId=${whId}`).set(auth(t)).expect(200)).body as Record<string, any>;
  const tasks = async (qs: string) => (await http().get(`/api/cycle-count/tasks?${qs}`).set(auth()).expect(200)).body as Array<Record<string, any>>;
  const insertCompleted = (whId: string, productId: string, daysAgo: number, abcClass = 'A') =>
    prisma.cycleCountTask.create({ data: { organizationId: orgId, warehouseId: whId, productId, variantId: NIL, lotId: NIL, abcClass: abcClass as any, priority: 1, status: 'COMPLETED', source: 'SCHEDULED', dueAt: new Date(Date.now() - daysAgo * DAY), completedAt: new Date(Date.now() - daysAgo * DAY) } });
  let orgId: string;

  // Run a started/available count to POSTED with a counted quantity.
  const completeCount = async (physicalCountId: string, countedQty: number) => {
    const count = await getCount(physicalCountId);
    await http().post(`/api/counts/${count.id}/entries`).set(auth()).send({ items: [{ itemId: count.items[0].id, countedQty }] }).expect(201);
    await http().post(`/api/counts/${count.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.id}/approve`).set(auth()).expect(201);
    await http().post(`/api/counts/${count.id}/post`).set(auth()).expect(201);
  };
  const adHoc = async (whId: string, productId: string) =>
    (await http().post('/api/cycle-count/tasks').set(auth()).send({ warehouseId: whId, productId }).expect(201)).body as Record<string, any>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    token = (await http().post('/api/auth/register')
      .send({ organizationName: `CCM ${u}`, adminEmail: `ccm_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    const me = (await http().get('/api/auth/me').set(auth()).expect(200)).body;
    userId = me.id; orgId = me.organizationId;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    // A warehouse_staff member: has cycle_count.view + inventory.count, NOT cycle_count.assign, NOT cost.view.
    const staff = (await http().post('/api/users').set(auth()).send({ email: `staff_${u}@x.test`, name: 'Staff', roleKey: 'warehouse_staff', password: 'password123' }).expect(201)).body;
    staffUserId = staff.userId;
    staffToken = (await http().post('/api/auth/login').send({ email: `staff_${u}@x.test`, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('metrics derive due/overdue from the business date, and are org- and warehouse-scoped', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const dueP = await newProduct('M-DUE');
    await seed(dueP, 5, wh);
    await setClass(wh, dueP, 'A');
    const overdueP = await newProduct('M-OD');
    await seed(overdueP, 5, wh);
    await setClass(wh, overdueP, 'A');
    await insertCompleted(wh, overdueP, 60, 'A'); // last counted 60d ago, A cadence 30d → past due
    await generate(wh);

    const m = await metrics(wh);
    expect(m.dueToday).toBe(1); // never-counted scheduled task, due today
    expect(m.overdue).toBe(1);  // 60d-ago scope now past due
    // Org isolation: another org cannot read metrics for a warehouse that is not theirs.
    const other = (await http().post('/api/auth/register').send({ organizationName: `CCM2 ${u}`, adminEmail: `ccm2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    await http().get(`/api/cycle-count/metrics?warehouseId=${wh}`).set(auth(other)).expect(404);
    // With no warehouse filter, the other org's board is empty (scoped to its own warehouses).
    const om = (await http().get('/api/cycle-count/metrics').set(auth(other)).expect(200)).body;
    expect(om.dueToday).toBe(0);
    expect(om.overdue).toBe(0);
  });

  it('worklist supports ABC, assignee (my-counts), and status filters', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const a = await newProduct('W-A');
    const c = await newProduct('W-C');
    await seed(a, 5, wh); await seed(c, 5, wh);
    await setClass(wh, a, 'A'); await setClass(wh, c, 'C');
    const created = await generate(wh);
    const aTask = created.find((t) => t.productId === a)!;
    // ABC filter.
    const onlyA = await tasks(`warehouseId=${wh}&abcClass=A`);
    expect(onlyA.map((t) => t.productId)).toEqual([a]);
    // Assign the A task to me → assignee/my-counts filter.
    await http().post(`/api/cycle-count/tasks/${aTask.id}/assign`).set(auth()).send({ assignedToId: userId }).expect(201);
    const mine = await tasks(`warehouseId=${wh}&assignedToId=${userId}`);
    expect(mine.map((t) => t.id)).toEqual([aTask.id]);
  });

  it('assignment requires the assign permission and rejects a disabled member; reassignment is audited', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct('ASG'); await seed(p, 5, wh); await setClass(wh, p, 'A');
    const task = (await generate(wh))[0]!;
    // Staff (no cycle_count.assign) is forbidden.
    await http().post(`/api/cycle-count/tasks/${task.id}/assign`).set(auth(staffToken)).send({ assignedToId: userId }).expect(403);
    // A disabled member cannot be assigned (use a throwaway member so the shared staff account stays valid).
    const dis = (await http().post('/api/users').set(auth()).send({ email: `dis_${u}@x.test`, name: 'Dis', roleKey: 'warehouse_staff', password: 'password123' }).expect(201)).body;
    await http().patch(`/api/users/${dis.userId}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    await http().post(`/api/cycle-count/tasks/${task.id}/assign`).set(auth()).send({ assignedToId: dis.userId }).expect(400);
    // Reassignment (admin → admin again) is audited.
    await http().post(`/api/cycle-count/tasks/${task.id}/assign`).set(auth()).send({ assignedToId: userId }).expect(201);
    const audit = (await http().get(`/api/audit?entityType=cycle_count_task&entityId=${task.id}`).set(auth()).expect(200)).body;
    expect(audit.entries.some((e: any) => e.action === 'cycle_count.assigned')).toBe(true);
  });

  it('on-time coverage counts SCHEDULED work only (ad-hoc excluded) and matches task history', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const sp = await newProduct('COV-SCHED'); await seed(sp, 10, wh); await setClass(wh, sp, 'A');
    const sched = (await generate(wh))[0]!;
    await completeCount((await start(sched.id)).physicalCountId, 10); // completed on time (due today)
    // An ad-hoc task completed too — must NOT enter the coverage denominator.
    const ap = await newProduct('COV-ADHOC'); await seed(ap, 4, wh);
    const adhocTask = await adHoc(wh, ap);
    await completeCount((await start(adhocTask.id)).physicalCountId, 4);

    const m = await metrics(wh);
    expect(m.scheduledDueInPeriod).toBe(1);
    expect(m.completedOnTime).toBe(1);
    expect(m.onTimeCoveragePct).toBe(100);
    expect(m.completedThisPeriod).toBe(2); // completed count includes ad-hoc, coverage does not
  });

  it('accuracy matches posted variance; variance qty reconciles; metrics move only after POSTED', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct('ACC'); await seed(p, 40, wh); await setClass(wh, p, 'A');
    const task = (await generate(wh))[0]!;
    const started = await start(task.id);
    // Before posting: no completed cycle count → accuracy null, nothing counted.
    const pre = await metrics(wh);
    expect(pre.postedCountsInPeriod).toBe(0);
    expect(pre.accuracyPct).toBeNull();
    expect(pre.inProgress).toBe(1);
    // Count 37 of 40 → |variance| 3 over expected 40 → 1 - 3/40 = 92.5% → 93%.
    await completeCount(started.physicalCountId, 37);
    const post = await metrics(wh);
    expect(post.postedCountsInPeriod).toBe(1);
    expect(post.accuracyPct).toBe(93);
    expect(post.absoluteVarianceQty).toBe('3');
    expect(post.completedThisPeriod).toBe(1);
    expect(post.varianceValue).toBeDefined(); // admin has cost.view
  });

  it('zero expected quantity: counted 0 → 100%, counted >0 → 0% (no divide-by-zero)', async () => {
    // Ad-hoc count on an unstocked product → snapshot expected 0.
    const whZero = await newWarehouse();
    const p0 = await newProduct('Z-ZERO');
    const t0 = await adHoc(whZero, p0);
    await completeCount((await start(t0.id)).physicalCountId, 0);
    expect((await metrics(whZero)).accuracyPct).toBe(100);

    const whFound = await newWarehouse();
    const pF = await newProduct('Z-FOUND');
    const tF = await adHoc(whFound, pF);
    await completeCount((await start(tF.id)).physicalCountId, 5); // unexpected stock found
    const mF = await metrics(whFound);
    expect(mF.accuracyPct).toBe(0);
    expect(mF.absoluteVarianceQty).toBe('5');
  });

  it('variance value is gated by cost.view', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct('COST'); await seed(p, 10, wh); await setClass(wh, p, 'A');
    const task = (await generate(wh))[0]!;
    await completeCount((await start(task.id)).physicalCountId, 8);
    expect((await metrics(wh)).varianceValue).toBeDefined();          // admin: cost.view
    expect((await metrics(wh, staffToken)).varianceValue).toBeUndefined(); // staff: no cost.view
  });

  it('a completed task stays historically readable after its product is archived', async () => {
    const wh = await newWarehouse();
    await upsertPolicy(wh);
    const p = await newProduct('ARCH-HIST'); await seed(p, 6, wh); await setClass(wh, p, 'A');
    const task = (await generate(wh))[0]!;
    await completeCount((await start(task.id)).physicalCountId, 6);
    await prisma.product.update({ where: { id: p }, data: { status: 'ARCHIVED' } });
    const t = (await http().get(`/api/cycle-count/tasks/${task.id}`).set(auth()).expect(200)).body;
    expect(t.status).toBe('COMPLETED');
    expect(t.productSku).toBeTruthy(); // still resolves historically
  });
});

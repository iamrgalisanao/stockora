import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const csv = (headers: string[], rows: string[][]) =>
  [headers.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';

describe('Bulk Import (e2e)', () => {
  let app: INestApplication;
  const u = Date.now();
  let admin: string;
  let adminB: string;
  let scoped: string; // administrator role, scoped to whX only
  let unitId: string;
  let whX: string;
  let whY: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const preview = (t: string, type: string, content: string) =>
    http().post(`/api/imports/${type}/preview`).set(auth(t)).send({ content });
  const commit = (t: string, jobId: string) => http().post(`/api/imports/${jobId}/commit`).set(auth(t));

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
    admin = await reg(`ImpA${u}`);
    adminB = await reg(`ImpB${u}`);

    unitId = (await http().post('/api/units').set(auth(admin)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whX = (await http().post('/api/warehouses').set(auth(admin)).send({ code: `WHX${u}`, name: 'X' }).expect(201)).body.id;
    whY = (await http().post('/api/warehouses').set(auth(admin)).send({ code: `WHY${u}`, name: 'Y' }).expect(201)).body.id;

    const sEmail = `scoped_${u}@x.test`;
    await http().post('/api/users').set(auth(admin))
      .send({ email: sEmail, name: 'Scoped Admin', roleKey: 'administrator', password: 'password123', warehouseScope: [whX] }).expect(201);
    scoped = (await http().post('/api/auth/login').send({ email: sEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const PH = ['sku', 'product_name', 'unit_code', 'barcode', 'parent_sku', 'category'];

  it('preview performs zero domain writes', async () => {
    const sku = `PREVIEW-${u}`;
    await preview(admin, 'products', csv(PH, [[sku, 'Preview Only', 'PCS', '', '', '']])).expect(201);
    // Nothing was created.
    const list = (await http().get(`/api/products`).set(auth(admin)).expect(200)).body;
    expect(list.some((p: { sku: string }) => p.sku === sku)).toBe(false);
  });

  it('flags duplicate SKU in file, duplicate barcode in file, and unknown master references', async () => {
    const dupSku = (await preview(admin, 'products', csv(PH, [
      [`DUP-${u}`, 'A', 'PCS', '', '', ''],
      [`DUP-${u}`, 'B', 'PCS', '', '', ''],
    ])).expect(201)).body;
    expect(dupSku.rows.filter((r: { errors: string[] }) => r.errors.some((e) => /duplicate SKU/i.test(e))).length).toBeGreaterThan(0);

    const dupBc = (await preview(admin, 'products', csv(PH, [
      [`B1-${u}`, 'A', 'PCS', 'SAME1', '', ''],
      [`B2-${u}`, 'B', 'PCS', 'SAME1', '', ''],
    ])).expect(201)).body;
    expect(dupBc.rows.some((r: { errors: string[] }) => r.errors.some((e) => /duplicate barcode/i.test(e)))).toBe(true);

    const unknown = (await preview(admin, 'products', csv(PH, [
      [`UNK-${u}`, 'A', 'NOPE', '', '', 'Ghosts'],
    ])).expect(201)).body;
    const errs = unknown.rows[0].errors.join(' ');
    expect(errs).toMatch(/unknown unit/i);
    expect(errs).toMatch(/unknown category/i);
    expect(unknown.job.invalidRows).toBe(1);
  });

  it('blocks commit while invalid rows remain', async () => {
    const job = (await preview(admin, 'products', csv(PH, [
      [`OK-${u}`, 'Good', 'PCS', '', '', ''],
      [`BAD-${u}`, 'Bad', 'NOPE', '', '', ''], // unknown unit
    ])).expect(201)).body.job;
    expect(job.invalidRows).toBe(1);
    await commit(admin, job.id).expect(400);
  });

  it('commits a clean products file exactly once (double commit rejected) and stamps IMPORT audit + one correlation id', async () => {
    const sku = `IMP-${u}`;
    const bc = `BC-${u}`;
    const job = (await preview(admin, 'products', csv(PH, [[sku, 'Imported Widget', 'PCS', bc, '', '']])).expect(201)).body.job;
    expect(job.validRows).toBe(1);

    const done = (await commit(admin, job.id).expect(201)).body;
    expect(done.status).toBe('COMPLETED');
    await commit(admin, job.id).expect(400); // cannot run twice

    // Product + barcode actually created, resolvable.
    expect((await http().get(`/api/products`).set(auth(admin)).expect(200)).body.some((p: { sku: string }) => p.sku === sku)).toBe(true);
    const resolved = (await http().get(`/api/resolve?code=${bc}`).set(auth(admin)).expect(200)).body;
    expect(resolved.metadata.sku).toBe(sku);

    // Audit: IMPORT source + a single shared correlation id across the job's records.
    const audit = (await http().get(`/api/audit?q=${sku}&limit=50`).set(auth(admin)).expect(200)).body.entries;
    const createdEntry = audit.find((e: { action: string }) => e.action === 'product.created');
    expect(createdEntry.source).toBe('IMPORT');
    const related = (await http().get(`/api/audit/correlation/${createdEntry.correlationId}`).set(auth(admin)).expect(200)).body;
    expect(related.length).toBeGreaterThanOrEqual(2); // product.created + barcode.assigned
    expect(related.every((e: { source: string; correlationId: string }) => e.source === 'IMPORT' && e.correlationId === createdEntry.correlationId)).toBe(true);
  });

  it('posts opening inventory through the ledger and is not double-counted', async () => {
    const p = (await http().post('/api/products').set(auth(admin)).send({ sku: `OPN-${u}`, name: 'Opening item', baseUomId: unitId }).expect(201)).body;
    const OH = ['warehouse_code', 'sku', 'quantity', 'unit_cost'];
    const job = (await preview(admin, 'opening-inventory', csv(OH, [[`WHX${u}`, p.sku, '25', '100']])).expect(201)).body.job;
    expect(job.validRows).toBe(1);
    await commit(admin, job.id).expect(201);

    // Balance reflects a real ledger posting (only the ledger updates balances).
    const bal = (await http().get(`/api/inventory/balances?productId=${p.id}`).set(auth(admin)).expect(200)).body;
    expect(bal.find((b: { warehouseId: string }) => b.warehouseId === whX).onHand).toBe('25');
    await commit(admin, job.id).expect(400); // already committed — not re-posted
  });

  it('enforces org isolation and warehouse scope', async () => {
    const job = (await preview(admin, 'products', csv(PH, [[`ISO-${u}`, 'A', 'PCS', '', '', '']])).expect(201)).body.job;
    await http().get(`/api/imports/${job.id}`).set(auth(adminB)).expect(404); // other org cannot see the job

    // A warehouse-scoped admin cannot open stock into a warehouse outside their scope.
    const p = (await http().post('/api/products').set(auth(admin)).send({ sku: `SCP-${u}`, name: 'Scoped item', baseUomId: unitId }).expect(201)).body;
    const OH = ['warehouse_code', 'sku', 'quantity', 'unit_cost'];
    const scopedPrev = (await preview(scoped, 'opening-inventory', csv(OH, [[`WHY${u}`, p.sku, '5', '10']])).expect(201)).body;
    expect(scopedPrev.rows[0].errors.join(' ')).toMatch(/outside your scope/i);
  });

  it('leaves no partial mutation when a commit fails mid-batch (atomic)', async () => {
    const aa = `ATOM-A-${u}`;
    const bb = `ATOM-B-${u}`;
    const job = (await preview(admin, 'products', csv(PH, [
      [aa, 'Atom A', 'PCS', '', '', ''],
      [bb, 'Atom B', 'PCS', '', '', ''],
    ])).expect(201)).body.job;
    // Race: create AA directly AFTER preview, so the commit's insert of AA hits a unique violation.
    await http().post('/api/products').set(auth(admin)).send({ sku: aa, name: 'Manual A', baseUomId: unitId }).expect(201);

    await commit(admin, job.id).expect((res) => { if (res.status < 400) throw new Error(`expected failure, got ${res.status}`); });

    const list = (await http().get(`/api/products`).set(auth(admin)).expect(200)).body.map((p: { sku: string }) => p.sku);
    expect(list).toContain(aa); // the manually-created one
    expect(list).not.toContain(bb); // BB rolled back — no partial commit
    expect((await http().get(`/api/imports/${job.id}`).set(auth(admin)).expect(200)).body.job.status).toBe('FAILED');
  });
});

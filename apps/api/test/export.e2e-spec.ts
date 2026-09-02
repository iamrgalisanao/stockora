import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Export (e2e)', () => {
  let app: INestApplication;
  const u = Date.now();
  let adminA: string;
  let adminB: string;
  let viewer: string;
  let unitA: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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
    adminA = await reg(`ExpA${u}`);
    adminB = await reg(`ExpB${u}`);

    unitA = (await http().post('/api/units').set(auth(adminA)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    const unitB = (await http().post('/api/units').set(auth(adminB)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id; // org B needs it for round-trip

    // A no-export viewer.
    const vEmail = `vexp_${u}@x.test`;
    await http().post('/api/users').set(auth(adminA)).send({ email: vEmail, name: 'Viewer', roleKey: 'viewer', password: 'password123' }).expect(201);
    viewer = (await http().post('/api/auth/login').send({ email: vEmail, password: 'password123' }).expect(200)).body.accessToken;

    // Org A products (one with a barcode, one whose name is a CSV-injection attempt).
    const p = (await http().post('/api/products').set(auth(adminA)).send({ sku: `EXP-1-${u}`, name: 'Widget One', baseUomId: unitA, cost: 12, sellingPrice: 20 }).expect(201)).body.id;
    await http().post(`/api/products/${p}/barcodes`).set(auth(adminA)).send({ code: `EBC-${u}` }).expect(201);
    await http().post('/api/products').set(auth(adminA)).send({ sku: `EXP-2-${u}`, name: '=cmd()|calc', baseUomId: unitA }).expect(201);
    // Org B has a product org A must never see.
    await http().post('/api/products').set(auth(adminB)).send({ sku: `BONLY-${u}`, name: 'B only', baseUomId: unitB }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires the export permission', async () => {
    await http().get('/api/exports/products').set(auth(viewer)).expect(403);
    await http().get('/api/exports/stock-balances').set(auth(viewer)).expect(403);
    await http().get('/api/exports/products').set(auth(adminA)).expect(200);
  });

  it('exports only the caller organization, and neutralizes CSV-injection', async () => {
    const csv = (await http().get('/api/exports/products').set(auth(adminA)).expect(200)).text as string;
    expect(csv.split(/\r?\n/)[0]).toBe('sku,product_name,description,category,brand,unit_code,cost,selling_price,is_serialized,is_batch_tracked,status,barcode,parent_sku');
    expect(csv).toContain(`EXP-1-${u}`);
    expect(csv).not.toContain(`BONLY-${u}`); // org isolation
    // A cell that starts with '=' must be prefixed so spreadsheets don't execute it.
    expect(csv).toContain("'=cmd()");
    expect(csv).not.toMatch(/(^|,)=cmd\(\)/m);
  });

  it('round-trips: an exported products file re-imports cleanly into another org', async () => {
    const csv = (await http().get('/api/exports/products').set(auth(adminA)).expect(200)).text as string;
    const preview = (await http().post('/api/imports/products/preview').set(auth(adminB)).send({ content: csv }).expect(201)).body;
    expect(preview.job.invalidRows).toBe(0);
    expect(preview.job.validRows).toBe(preview.job.totalRows);
    await http().post(`/api/imports/${preview.job.id}/commit`).set(auth(adminB)).expect(201);
    // Org B now has the exported catalog, barcode included.
    const bProducts = (await http().get('/api/products').set(auth(adminB)).expect(200)).body.map((p: { sku: string }) => p.sku);
    expect(bProducts).toContain(`EXP-1-${u}`);
    expect((await http().get(`/api/resolve?code=EBC-${u}`).set(auth(adminB)).expect(200)).body.metadata.sku).toBe(`EXP-1-${u}`);
  });

  it('serves header-only templates', async () => {
    const tpl = (await http().get('/api/exports/templates/opening-inventory').set(auth(adminA)).expect(200)).text as string;
    expect(tpl.trim()).toBe('warehouse_code,location_code,sku,quantity,unit_cost');
    await http().get('/api/exports/templates/bogus').set(auth(adminA)).expect(400);
  });
});

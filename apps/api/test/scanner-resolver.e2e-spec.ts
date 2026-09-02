import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Scanner — resolver + diagnostic (e2e)', () => {
  let app: INestApplication;
  const u = Date.now();
  let admin: string;
  let viewer: string;
  let unitId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const newProduct = async (sku: string) =>
    (await http().post('/api/products').set(auth(admin)).send({ sku, name: sku, baseUomId: unitId }).expect(201)).body.id;
  const assignBarcode = (productId: string, code: string) =>
    http().post(`/api/products/${productId}/barcodes`).set(auth(admin)).send({ code }).expect(201);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    admin = (await http().post('/api/auth/register')
      .send({ organizationName: `Scan${u}`, adminEmail: `scan_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
      .expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth(admin)).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;

    const vEmail = `viewer_${u}@x.test`;
    await http().post('/api/users').set(auth(admin)).send({ email: vEmail, name: 'Viewer', roleKey: 'viewer', password: 'password123' }).expect(201);
    viewer = (await http().post('/api/auth/login').send({ email: vEmail, password: 'password123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves an active barcode to identity ONLY (never availability)', async () => {
    const p = await newProduct(`ACT-${u}`);
    await assignBarcode(p, `ACT${u}`);
    const res = (await http().get(`/api/resolve?code=ACT${u}`).set(auth(admin)).expect(200)).body;
    expect(res.productId).toBe(p);
    expect(res.type).toBe('PRODUCT');
    expect(res.metadata).toEqual({ sku: `ACT-${u}`, name: `ACT-${u}` });
    // Identity boundary: no stock fields leak into the resolver response.
    for (const k of ['onHand', 'available', 'reserved', 'inTransit', 'quarantined']) {
      expect(res).not.toHaveProperty(k);
    }
  });

  it('returns 404 for an unknown code, and hides non-active identities from the plain resolver', async () => {
    await http().get(`/api/resolve?code=NOPE${u}`).set(auth(admin)).expect(404);
    const p = await newProduct(`ARCH-${u}`);
    await assignBarcode(p, `ARCH${u}`);
    await http().post(`/api/products/${p}/status`).set(auth(admin)).send({ status: 'ARCHIVED' }).expect(201);
    await http().get(`/api/resolve?code=ARCH${u}`).set(auth(admin)).expect(404); // normal contract stays identity-only + active-only
  });

  it('diagnoses RESOLVED / NOT_FOUND / ARCHIVED / INACTIVE for an operator', async () => {
    // RESOLVED
    const active = await newProduct(`DACT-${u}`);
    await assignBarcode(active, `DACT${u}`);
    const ok = (await http().get(`/api/resolve/diagnose?code=DACT${u}`).set(auth(admin)).expect(200)).body;
    expect(ok.outcome).toBe('RESOLVED');
    expect(ok.result.productId).toBe(active);
    expect(ok.result).not.toHaveProperty('onHand');

    // NOT_FOUND
    expect((await http().get(`/api/resolve/diagnose?code=GHOST${u}`).set(auth(admin)).expect(200)).body.outcome).toBe('NOT_FOUND');

    // ARCHIVED (product archived)
    const arch = await newProduct(`DARCH-${u}`);
    await assignBarcode(arch, `DARCH${u}`);
    await http().post(`/api/products/${arch}/status`).set(auth(admin)).send({ status: 'ARCHIVED' }).expect(201);
    const archDiag = (await http().get(`/api/resolve/diagnose?code=DARCH${u}`).set(auth(admin)).expect(200)).body;
    expect(archDiag.outcome).toBe('ARCHIVED');
    expect(archDiag.reason).toContain(`DARCH-${u}`);

    // INACTIVE (barcode deactivated)
    const bcProduct = await newProduct(`DINACT-${u}`);
    const bc = (await http().post(`/api/products/${bcProduct}/barcodes`).set(auth(admin)).send({ code: `DINACT${u}` }).expect(201)).body;
    await http().patch(`/api/products/${bcProduct}/barcodes/${bc.id}`).set(auth(admin)).send({ status: 'INACTIVE' }).expect(200);
    expect((await http().get(`/api/resolve/diagnose?code=DINACT${u}`).set(auth(admin)).expect(200)).body.outcome).toBe('INACTIVE');
  });

  it('gates the diagnostic behind product-manage (a viewer cannot use it, but can use the plain resolver)', async () => {
    const p = await newProduct(`VIEW-${u}`);
    await assignBarcode(p, `VIEW${u}`);
    await http().get(`/api/resolve?code=VIEW${u}`).set(auth(viewer)).expect(200); // plain resolve allowed
    await http().get(`/api/resolve/diagnose?code=VIEW${u}`).set(auth(viewer)).expect(403); // diagnostic denied
  });
});

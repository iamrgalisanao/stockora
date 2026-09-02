import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Catalog lifecycle + audit (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;

  const bearer = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (
      await http()
        .post('/api/auth/register')
        .send({ organizationName: `Life ${unique}`, adminEmail: `life_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a brand as ACTIVE and walks the lifecycle', async () => {
    const brand = (await http().post('/api/brands').set(bearer()).send({ name: 'Acme' }).expect(201)).body;
    expect(brand.status).toBe('ACTIVE');

    const inactive = (await http().post(`/api/brands/${brand.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201)).body;
    expect(inactive.status).toBe('INACTIVE');

    const archived = (await http().post(`/api/brands/${brand.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(201)).body;
    expect(archived.status).toBe('ARCHIVED');

    // Archived cannot be reactivated via the normal endpoint.
    await http().post(`/api/brands/${brand.id}/status`).set(bearer()).send({ status: 'ACTIVE' }).expect(400);

    // Status filter.
    const archivedList = (await http().get('/api/brands?status=ARCHIVED').set(bearer()).expect(200)).body;
    expect(archivedList.map((b: { id: string }) => b.id)).toContain(brand.id);
    const activeList = (await http().get('/api/brands?status=ACTIVE').set(bearer()).expect(200)).body;
    expect(activeList.map((b: { id: string }) => b.id)).not.toContain(brand.id);

    // Entity audit history captured the create + status changes.
    const audit = (await http().get(`/api/audit?entityType=brand&entityId=${brand.id}`).set(bearer()).expect(200)).body;
    const actions = audit.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['brand.created', 'brand.status_changed']));
  });

  it('searches brands by name', async () => {
    await http().post('/api/brands').set(bearer()).send({ name: 'Samsung' }).expect(201);
    await http().post('/api/brands').set(bearer()).send({ name: 'Logitech' }).expect(201);
    const res = (await http().get('/api/brands?q=sung').set(bearer()).expect(200)).body;
    expect(res.map((b: { name: string }) => b.name)).toEqual(['Samsung']);
  });

  it('applies the lifecycle to units and categories too', async () => {
    const unit = (await http().post('/api/units').set(bearer()).send({ code: 'BOX', name: 'Box' }).expect(201)).body;
    expect(unit.status).toBe('ACTIVE');
    await http().post(`/api/units/${unit.id}/status`).set(bearer()).send({ status: 'INACTIVE' }).expect(201);

    const cat = (await http().post('/api/categories').set(bearer()).send({ name: 'Peripherals' }).expect(201)).body;
    expect(cat.status).toBe('ACTIVE');
    const archived = (await http().post(`/api/categories/${cat.id}/status`).set(bearer()).send({ status: 'ARCHIVED' }).expect(201)).body;
    expect(archived.status).toBe('ARCHIVED');
  });
});

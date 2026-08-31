import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PERMISSIONS } from '@iw/contracts';
import { AppModule } from '../src/app.module';

/**
 * Phase 01 acceptance test. Requires a running Postgres (npm run db:up) and an applied
 * migration (npm run api:migrate). Exercises register -> me -> login -> tenant scoping.
 */
describe('Auth + Organization (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  const adminEmail = `admin_${unique}@example.test`;
  const password = 'password123';
  let token: string;
  let organizationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a new organization with an Administrator', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: `Acme ${unique}`,
        adminEmail,
        adminName: 'Acme Admin',
        adminPassword: password,
      })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.roleKey).toBe('administrator');
    expect(res.body.user.permissions).toContain(PERMISSIONS.INVENTORY_RECEIVE);
    expect(res.body.user.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE);
    expect(res.body.user.warehouseScope).toBeNull();
    token = res.body.accessToken;
    organizationId = res.body.user.organizationId;
  });

  it('rejects an unauthenticated request to /me', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('returns the current user from /me with a valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.email).toBe(adminEmail);
    expect(res.body.organizationId).toBe(organizationId);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('rejects login with a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: adminEmail, password: 'wrong-password' })
      .expect(401);
  });

  it('returns the caller-scoped organization', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/organizations/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(organizationId);
    expect(res.body.currency).toBe('PHP');
  });

  it('allows the Administrator to update org settings (SETTINGS_MANAGE)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/organizations/current')
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'USD' })
      .expect(200);
    expect(res.body.currency).toBe('USD');
  });

  it('rejects duplicate registration for the same email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: `Dup ${unique}`,
        adminEmail,
        adminName: 'Dup',
        adminPassword: password,
      })
      .expect(409);
  });
});

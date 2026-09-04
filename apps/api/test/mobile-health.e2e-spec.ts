import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.6A — the authenticated mobile connectivity/session probe (ADR 0014 §5, §12). A 200 proves both API
 * reachability and a still-valid session, and echoes the scope the server currently grants.
 */
describe('mobile health probe (e2e, 2D.6A)', () => {
  let app: INestApplication;
  const u = Date.now();
  let token: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await http().post('/api/auth/register').send({ organizationName: `MOB ${u}`, adminEmail: `mob_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
  }, 60000);

  afterAll(async () => { await app.close(); });

  it('rejects an unauthenticated probe (proves it is a real session check, not a public ping)', async () => {
    await http().get('/api/health/mobile').expect(401);
  });

  it('returns session identity, granted scope, and compatibility gates for an authenticated caller', async () => {
    const res = await http().get('/api/health/mobile').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.serverTime).toBe('string');
    expect(res.body.userId).toBeTruthy();
    expect(res.body.organizationId).toBeTruthy();
    // A fresh admin is unrestricted → scope is null (all warehouses).
    expect(res.body.warehouseScope).toBeNull();
    expect(typeof res.body.minAppVersion).toBe('string');
    expect(typeof res.body.commandSchemaVersion).toBe('number');
  });

  it('still answers the public liveness/readiness probes without a token', async () => {
    await http().get('/api/health/live').expect(200);
    await http().get('/api/health/ready').expect(200);
  });
});

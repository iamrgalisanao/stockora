import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Sessions & refresh tokens (e2e)', () => {
  let app: INestApplication;
  const u = Date.now();
  const email = `sess_${u}@x.test`;
  const password = 'password123';

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async () =>
    (await http().post('/api/auth/login').send({ email, password }).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await http().post('/api/auth/register')
      .send({ organizationName: `Sess ${u}`, adminEmail: email, adminName: 'Admin', adminPassword: password })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues an access + refresh token pair', async () => {
    const body = await login();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.tokenType).toBe('Bearer');
    await http().get('/api/auth/me').set(auth(body.accessToken)).expect(200);
  });

  it('rotates on refresh and invalidates the previous session immediately', async () => {
    const first = await login();
    const rotated = (await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)).body;
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    // The rotated-away access token's session is revoked → immediately rejected.
    await http().get('/api/auth/me').set(auth(first.accessToken)).expect(401);
    await http().get('/api/auth/me').set(auth(rotated.accessToken)).expect(200);
  });

  it('detects refresh-token reuse and revokes the whole family', async () => {
    const first = await login();
    const rotated = (await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200)).body;
    // Reusing the already-rotated original token is treated as theft.
    await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    // …and it burns the family, so even the currently-valid token stops working.
    await http().post('/api/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
  });

  it('logout revokes the current session (access token + refresh both dead)', async () => {
    const s = await login();
    await http().get('/api/auth/me').set(auth(s.accessToken)).expect(200);
    await http().post('/api/auth/logout').set(auth(s.accessToken)).expect(204);
    await http().get('/api/auth/me').set(auth(s.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
  });

  it('logout-all revokes every active session for the user', async () => {
    const a = await login();
    const b = await login();
    const res = (await http().post('/api/auth/logout-all').set(auth(a.accessToken)).expect(200)).body;
    expect(res.revoked).toBeGreaterThanOrEqual(2);
    await http().get('/api/auth/me').set(auth(a.accessToken)).expect(401);
    await http().get('/api/auth/me').set(auth(b.accessToken)).expect(401);
  });

  it('rejects an unknown refresh token', async () => {
    await http().post('/api/auth/refresh').send({ refreshToken: 'x'.repeat(43) }).expect(401);
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('API hardening (e2e)', () => {
  let app: INestApplication;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(json({ limit: '1mb' }));
    app.use(urlencoded({ limit: '1mb', extended: true }));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes liveness and readiness probes', async () => {
    expect((await http().get('/api/health/live').expect(200)).body.status).toBe('ok');
    const ready = (await http().get('/api/health/ready').expect(200)).body;
    expect(ready.db).toBe('ok');
  });

  it('sets baseline security headers and hides X-Powered-By', async () => {
    const res = await http().get('/api/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a consistent error shape', async () => {
    const res = await http().get('/api/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, path: '/api/does-not-exist' });
    expect(typeof res.body.error).toBe('string');
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.body).toHaveProperty('correlationId');
  });

  it('rejects an oversized request body', async () => {
    const huge = 'x'.repeat(1_200_000); // > 1 MB
    await http().post('/api/auth/login').set('Content-Type', 'application/json')
      .send({ email: 'a@b.c', password: huge })
      .expect(413);
  });
});

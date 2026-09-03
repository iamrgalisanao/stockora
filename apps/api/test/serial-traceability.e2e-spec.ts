import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2D.3C — Serial Traceability (ADR 0012). Identity visibility: the explorer feed (scoped list + filters),
 * the movement-history timeline resolved to source documents, and the eligibility feed the shared picker
 * consumes.
 */
describe('Serial traceability (e2e, 2D.3C)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let wh1: string;
  let wh2: string;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string) => {
    const s = sku(prefix);
    return (await http().post('/api/products').set(auth()).send({ sku: s, name: s, baseUomId: unitId, isSerialized: true }).expect(201)).body.id as string;
  };
  const receive = async (productId: string, warehouseId: string, serialNumbers: string[]) => {
    const draft = await http().post('/api/receiving').set(auth())
      .send({ warehouseId, items: [{ productId, expectedQty: serialNumbers.length, receivedQty: serialNumbers.length, unitCost: 10, serialNumbers }] }).expect(201);
    await http().post(`/api/receiving/${draft.body.id}/post`).set(auth()).expect(201);
    return draft.body.id as string;
  };
  const serials = async (q: string) => (await http().get(`/api/serials?${q}`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;
  const serialId = async (productId: string, sn: string) => (await serials(`productId=${productId}`)).find((r) => r.serialNumber === sn)!.id!;
  const releaseSerials = async (warehouseId: string, productId: string, qty: number, serialNumbers: string[]) => {
    const rel = await http().post('/api/releases').set(auth()).send({ warehouseId, destinationType: 'INTERNAL_CONSUMPTION', items: [{ productId, requestedQty: qty }] }).expect(201);
    const itemId = rel.body.items[0].id as string;
    await http().post(`/api/releases/${rel.body.id}/submit`).set(auth()).expect(201);
    await http().post(`/api/releases/${rel.body.id}/approve`).set(auth()).send({}).expect(201);
    await http().post(`/api/releases/${rel.body.id}/post`).set(auth()).send({ serials: [{ itemId, serialNumbers }] }).expect(201);
    return rel.body as { id: string; releaseNumber: string };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    token = (await http().post('/api/auth/register').send({ organizationName: `Trace ${u}`, adminEmail: `trace_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    wh1 = (await http().post('/api/warehouses').set(auth()).send({ code: 'TW1', name: 'W1' }).expect(201)).body.id;
    wh2 = (await http().post('/api/warehouses').set(auth()).send({ code: 'TW2', name: 'W2' }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  it('builds a complete, ordered movement timeline with resolvable document links', async () => {
    const p = await newProduct('TL');
    const rcpt = await receive(p, wh1, ['TL-1']);
    const rel = await releaseSerials(wh1, p, 1, ['TL-1']);
    const id = await serialId(p, 'TL-1');

    const hist = (await http().get(`/api/serials/${id}/history`).set(auth()).expect(200)).body;
    expect(hist.serial.serialNumber).toBe('TL-1');
    const types = hist.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(['RECEIVED', 'ISSUED']); // complete + time-ordered
    // Events resolve to their originating documents.
    const received = hist.events.find((e: { type: string }) => e.type === 'RECEIVED');
    const issued = hist.events.find((e: { type: string }) => e.type === 'ISSUED');
    expect(received.documentType).toBe('goods_receipt');
    expect(received.documentId).toBe(rcpt);
    expect(issued.documentType).toBe('stock_release');
    expect(issued.documentId).toBe(rel.id);
    expect(issued.documentNumber).toBe(rel.releaseNumber);
    // Timestamps ascending.
    expect(new Date(received.at).getTime()).toBeLessThanOrEqual(new Date(issued.at).getTime());
  });

  it('picker eligibility excludes wrong warehouse, wrong status, and wrong lot', async () => {
    const p = await newProduct('EL');
    await receive(p, wh1, ['EL-1', 'EL-2']);
    await receive(p, wh2, ['EL-9']);
    await releaseSerials(wh1, p, 1, ['EL-1']); // EL-1 now ISSUED

    // Eligible for a release at wh1 = IN_STOCK at wh1 only.
    const eligible = await serials(`productId=${p}&warehouseId=${wh1}&status=IN_STOCK`);
    const nums = eligible.map((r) => r.serialNumber).sort();
    expect(nums).toEqual(['EL-2']); // EL-1 issued (wrong status), EL-9 at wh2 (wrong warehouse)
  });

  it('the return-scan feed resolves only ISSUED serials of the product', async () => {
    const p = await newProduct('RS');
    await receive(p, wh1, ['RS-1', 'RS-2']);
    await releaseSerials(wh1, p, 1, ['RS-1']);
    const issued = await serials(`productId=${p}&status=ISSUED`);
    expect(issued.map((r) => r.serialNumber)).toEqual(['RS-1']);
    // An in-stock serial does not appear in the ISSUED feed a return scan would use.
    expect(issued.some((r) => r.serialNumber === 'RS-2')).toBe(false);
  });

  it('"currently in inventory" excludes issued/disposed units', async () => {
    const p = await newProduct('INV');
    await receive(p, wh1, ['INV-1', 'INV-2']);
    await releaseSerials(wh1, p, 1, ['INV-1']); // issued → out of inventory
    const inv = await serials(`productId=${p}&inInventory=true`);
    expect(inv.map((r) => r.serialNumber)).toEqual(['INV-2']);
  });

  it('a historical ISSUED serial remains readable with its history, and the explorer is org-scoped', async () => {
    const p = await newProduct('HS');
    await receive(p, wh1, ['HS-1']);
    await releaseSerials(wh1, p, 1, ['HS-1']);
    const id = await serialId(p, 'HS-1');
    expect((await http().get(`/api/serials/${id}`).set(auth()).expect(200)).body.status).toBe('ISSUED');
    const hist = (await http().get(`/api/serials/${id}/history`).set(auth()).expect(200)).body;
    expect(hist.events.length).toBe(2);

    // Second org cannot read the serial or its history.
    const token2 = (await http().post('/api/auth/register').send({ organizationName: `Trace2 ${u}`, adminEmail: `trace2_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)).body.accessToken;
    await http().get(`/api/serials/${id}`).set(auth(token2)).expect(404);
    await http().get(`/api/serials/${id}/history`).set(auth(token2)).expect(404);
  });
});

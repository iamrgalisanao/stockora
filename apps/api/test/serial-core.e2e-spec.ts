import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 2D.3A — Serial Core + Receiving (ADR 0012). Unit-level identity is a registry-with-state; the ledger
 * stays authoritative. Capture happens on the goods-receipt line, atomically with posting, and the
 * serialized quantity must reconcile to the serial-registry count.
 */
describe('Serial core + receiving (e2e, 2D.3A)', () => {
  let app: INestApplication;
  const u = Date.now();
  let seq = 0;
  let token: string;
  let unitId: string;
  let whId: string;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sku = (p: string) => `${p}-${u}-${seq++}`;

  const newProduct = async (prefix: string, opts: { serialized?: boolean; batch?: boolean } = {}) => {
    const s = sku(prefix);
    const id = (
      await http().post('/api/products').set(auth())
        .send({ sku: s, name: s, baseUomId: unitId, isSerialized: opts.serialized ?? false, isBatchTracked: opts.batch ?? false })
        .expect(201)
    ).body.id;
    return { id, sku: s };
  };

  const draftReceipt = async (items: Record<string, unknown>[], expect = 201) =>
    http().post('/api/receiving').set(auth()).send({ warehouseId: whId, items }).expect(expect);

  const postReceipt = (id: string, expect = 201) => http().post(`/api/receiving/${id}/post`).set(auth()).expect(expect);

  const serials = async (productId: string) =>
    (await http().get(`/api/serials?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string | null>>;

  const onHand = async (productId: string) => {
    const b = (await http().get(`/api/inventory/balances?productId=${productId}`).set(auth()).expect(200)).body as Array<Record<string, string>>;
    return b.filter((x) => x.warehouseId === whId).reduce((s, x) => s + Number(x.onHand), 0);
  };
  const purchaseMovements = async (productId: string) =>
    (await http().get(`/api/inventory/movements?productId=${productId}&type=PURCHASE_RECEIPT&limit=500`).set(auth()).expect(200))
      .body as Array<Record<string, string | null>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    token = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Ser ${u}`, adminEmail: `ser_${u}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    whId = (await http().post('/api/warehouses').set(auth()).send({ code: 'SW1', name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('captures exact serials at receipt, one movement (not N), and each lands IN_STOCK', async () => {
    const p = await newProduct('SER', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 3, receivedQty: 3, unitCost: 500, serialNumbers: ['SN-A', 'SN-B', 'SN-C'] }]);
    const posted = await postReceipt(draft.body.id);
    expect(posted.body.status).toBe('COMPLETED');
    // The response echoes the captured serials on the line.
    expect(posted.body.items[0].serialNumbers.sort()).toEqual(['SN-A', 'SN-B', 'SN-C']);

    expect(await onHand(p.id)).toBe(3);
    const rows = await serials(p.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'IN_STOCK')).toBe(true);
    expect(rows.every((r) => r.currentWarehouseId === whId)).toBe(true);
    expect(rows.every((r) => !!r.lastMovementId && !!r.receivedAt)).toBe(true);

    // §6a: ONE quantity movement of +3, not three unit movements.
    const mv = await purchaseMovements(p.id);
    expect(mv).toHaveLength(1);
    expect(mv[0]!.quantity).toBe('3');
  });

  it('rejects a serial count that does not match the received quantity', async () => {
    const p = await newProduct('SERC', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 3, receivedQty: 3, unitCost: 1, serialNumbers: ['ONLY-1', 'ONLY-2'] }]);
    await postReceipt(draft.body.id, 400);
    // Nothing committed.
    expect(await onHand(p.id)).toBe(0);
    expect(await serials(p.id)).toHaveLength(0);
  });

  it('rejects a non-integer serialized quantity', async () => {
    const p = await newProduct('SERF', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 2, receivedQty: 2.5, unitCost: 1, serialNumbers: ['F1', 'F2', 'F3'] }]);
    await postReceipt(draft.body.id, 400);
    expect(await onHand(p.id)).toBe(0);
  });

  it('rejects duplicate serials within a line', async () => {
    const p = await newProduct('SERD', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 1, serialNumbers: ['DUP', 'DUP'] }]);
    await postReceipt(draft.body.id, 400);
    expect(await serials(p.id)).toHaveLength(0);
  });

  it('rejects duplicate serials across lines in the same receipt', async () => {
    const p = await newProduct('SERX', { serialized: true });
    const draft = await draftReceipt([
      { productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['XL'] },
      { productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['XL'] },
    ]);
    await postReceipt(draft.body.id, 400);
    expect(await serials(p.id)).toHaveLength(0);
    expect(await onHand(p.id)).toBe(0);
  });

  it('rejects a serial already registered for the product, but allows the same string on another product', async () => {
    const p1 = await newProduct('SERU1', { serialized: true });
    const p2 = await newProduct('SERU2', { serialized: true });
    await postReceipt((await draftReceipt([{ productId: p1.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['SHARED'] }])).body.id);

    // Same serial again on p1 → rejected.
    const again = await draftReceipt([{ productId: p1.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['SHARED'] }]);
    await postReceipt(again.body.id, 400);

    // Same string on a different product → allowed (product-scoped uniqueness).
    const other = await draftReceipt([{ productId: p2.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['SHARED'] }]);
    await postReceipt(other.body.id);
    expect(await serials(p2.id)).toHaveLength(1);
  });

  it('trims surrounding whitespace, preserves case, and rejects empty/whitespace serials', async () => {
    const p = await newProduct('SERW', { serialized: true });
    // Whitespace-only → rejected.
    await postReceipt((await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['   '] }])).body.id, 400);

    // Trim surrounding whitespace but keep case.
    const ok = await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['  Ab-9  '] }]);
    await postReceipt(ok.body.id);
    const rows = await serials(p.id);
    expect(rows.map((r) => r.serialNumber)).toEqual(['Ab-9']);
  });

  it('rejects serial capture on a non-serialized product', async () => {
    const p = await newProduct('NOSER', { serialized: false });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['NOPE'] }]);
    await postReceipt(draft.body.id, 400);
  });

  it('nests batch+serial: each serial inherits the resolved lot and reconciles per lot', async () => {
    const p = await newProduct('SERB', { serialized: true, batch: true });
    const draft = await draftReceipt([
      { productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 10, batchNumber: 'LOT-1', serialNumbers: ['B-1', 'B-2'] },
    ]);
    await postReceipt(draft.body.id);
    const rows = await serials(p.id);
    expect(rows).toHaveLength(2);
    const lotId = rows[0]!.lotId;
    expect(lotId).toBeTruthy();
    expect(rows.every((r) => r.lotId === lotId)).toBe(true);
    expect(rows.every((r) => r.lotNumber === 'LOT-1')).toBe(true);

    // Reconciliation: registry counts equal balance buckets, no drift.
    const rec = (await http().get(`/api/serials/reconcile?productId=${p.id}`).set(auth()).expect(200)).body;
    expect(rec.ok).toBe(true);
    expect(rec.serialsChecked).toBe(2);
    expect(rec.drift).toHaveLength(0);
  });

  it('reconciles the serialized quantity to the registry count across the whole org', async () => {
    const rec = (await http().get('/api/serials/reconcile').set(auth()).expect(200)).body;
    expect(rec.ok).toBe(true);
    expect(rec.drift).toHaveLength(0);
    expect(rec.serialsChecked).toBeGreaterThan(0);
  });

  it('keeps serial identity immutable and idempotent on replay', async () => {
    const p = await newProduct('SERI', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['IMM-1'] }]);
    await postReceipt(draft.body.id);
    const before = (await serials(p.id))[0]!;

    // Replay the post — idempotent, no new serial rows, movement link unchanged.
    await postReceipt(draft.body.id);
    const rows = await serials(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.serialNumber).toBe('IMM-1');
    expect(rows[0]!.lastMovementId).toBe(before.lastMovementId);
    expect(await onHand(p.id)).toBe(1);
  });

  it('honors ISSUE-mode policy: receiving captures no serials but stock still rises', async () => {
    const p = await newProduct('SERISS', { serialized: true });
    // Default policy is RECEIPT and not configured.
    const def = (await http().get(`/api/serials/policies/${p.id}`).set(auth()).expect(200)).body;
    expect(def).toMatchObject({ captureMode: 'RECEIPT', requireLotWhenBatchTracked: true, configured: false });

    // Switch to ISSUE capture.
    const upd = await http().put(`/api/serials/policies/${p.id}`).set(auth()).send({ captureMode: 'ISSUE' }).expect(200);
    expect(upd.body).toMatchObject({ captureMode: 'ISSUE', configured: true });

    // Providing serials at receipt is now rejected...
    await postReceipt((await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['EARLY'] }])).body.id, 400);

    // ...but a plain receipt posts and raises stock with no serial rows yet.
    await postReceipt((await draftReceipt([{ productId: p.id, expectedQty: 2, receivedQty: 2, unitCost: 1 }])).body.id);
    expect(await onHand(p.id)).toBe(2);
    expect(await serials(p.id)).toHaveLength(0);
  });

  it('blocks cross-org serial lookup', async () => {
    const p = await newProduct('SERXORG', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['XO-1'] }]);
    await postReceipt(draft.body.id);
    const id = (await serials(p.id))[0]!.id!;

    // A second org cannot read it.
    const u2 = `${u}-org2`;
    const token2 = (
      await http().post('/api/auth/register')
        .send({ organizationName: `Ser2 ${u2}`, adminEmail: `ser2_${u2}@x.test`, adminName: 'Admin', adminPassword: 'password123' })
        .expect(201)
    ).body.accessToken;
    await http().get(`/api/serials/${id}`).set(auth(token2)).expect(404);
    // The owning org can.
    await http().get(`/api/serials/${id}`).set(auth()).expect(200);
  });

  it('keeps a historical serial readable after its product is archived', async () => {
    const p = await newProduct('SERARCH', { serialized: true });
    const draft = await draftReceipt([{ productId: p.id, expectedQty: 1, receivedQty: 1, unitCost: 1, serialNumbers: ['ARCH-1'] }]);
    await postReceipt(draft.body.id);
    const id = (await serials(p.id))[0]!.id!;

    await prisma.product.update({ where: { id: p.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });

    const row = (await http().get(`/api/serials/${id}`).set(auth()).expect(200)).body;
    expect(row.serialNumber).toBe('ARCH-1');
    expect(row.productSku).toBe(p.sku);
  });
});

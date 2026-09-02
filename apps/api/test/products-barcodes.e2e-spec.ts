import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Products, variants & barcodes — invariants (e2e)', () => {
  let app: INestApplication;
  const unique = Date.now();
  let token: string;
  let unitId: string;
  let unit2Id: string;
  let warehouseId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  async function newProduct(sku: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await http().post('/api/products').set(auth()).send({ sku: `${sku}-${unique}`, name: sku, baseUomId: unitId, ...extra }).expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (
      await http().post('/api/auth/register').send({ organizationName: `Pb ${unique}`, adminEmail: `pb_${unique}@x.test`, adminName: 'Admin', adminPassword: 'password123' }).expect(201)
    ).body.accessToken;
    unitId = (await http().post('/api/units').set(auth()).send({ code: 'PCS', name: 'Piece' }).expect(201)).body.id;
    unit2Id = (await http().post('/api/units').set(auth()).send({ code: 'BOX', name: 'Box' }).expect(201)).body.id;
    warehouseId = (await http().post('/api/warehouses').set(auth()).send({ code: 'PBW', name: 'W' }).expect(201)).body.id;
  });

  afterAll(async () => app.close());

  it('creates a product ACTIVE and assigns a unique barcode that resolves to identity', async () => {
    const p = await newProduct('WIDGET');
    const bc = await http().post(`/api/products/${p}/barcodes`).set(auth()).send({ code: `EAN-${unique}`, isPrimary: true }).expect(201);
    expect(bc.body.status).toBe('ACTIVE');

    const resolved = await http().get(`/api/resolve?code=EAN-${unique}`).set(auth()).expect(200);
    expect(resolved.body.type).toBe('PRODUCT');
    expect(resolved.body.productId).toBe(p);
    expect(resolved.body.variantId).toBeNull();

    // Duplicate barcode rejected.
    await http().post(`/api/products/${p}/barcodes`).set(auth()).send({ code: `EAN-${unique}` }).expect(409);
  });

  it('keeps only one PRIMARY barcode per scope', async () => {
    const p = await newProduct('PRIM');
    await http().post(`/api/products/${p}/barcodes`).set(auth()).send({ code: `A-${unique}`, isPrimary: true }).expect(201);
    await http().post(`/api/products/${p}/barcodes`).set(auth()).send({ code: `B-${unique}`, isPrimary: true }).expect(201);
    const list = (await http().get(`/api/products/${p}/barcodes`).set(auth()).expect(200)).body;
    expect(list.filter((b: { isPrimary: boolean }) => b.isPrimary).length).toBe(1);
  });

  it('does not resolve an archived barcode or an inactive-variant barcode', async () => {
    const p = await newProduct('RESO');
    const bc = (await http().post(`/api/products/${p}/barcodes`).set(auth()).send({ code: `ARCH-${unique}` }).expect(201)).body;
    await http().patch(`/api/products/${p}/barcodes/${bc.id}`).set(auth()).send({ status: 'INACTIVE' }).expect(200);
    await http().get(`/api/resolve?code=ARCH-${unique}`).set(auth()).expect(404);

    const variant = (await http().post(`/api/products/${p}/variants`).set(auth()).send({ sku: `RESO-V-${unique}` }).expect(201)).body;
    await http().post(`/api/products/${p}/barcodes`).set(auth()).send({ code: `VAR-${unique}`, variantId: variant.id }).expect(201);
    // resolves while variant active
    const r1 = await http().get(`/api/resolve?code=VAR-${unique}`).set(auth()).expect(200);
    expect(r1.body.type).toBe('PRODUCT_VARIANT');
    expect(r1.body.variantId).toBe(variant.id);
    // deactivate variant -> no longer resolves
    await http().post(`/api/products/${p}/variants/${variant.id}/status`).set(auth()).send({ status: 'INACTIVE' }).expect(201);
    await http().get(`/api/resolve?code=VAR-${unique}`).set(auth()).expect(404);
  });

  it('blocks product archive with inventory, allows it with none', async () => {
    const withStock = await newProduct('HASSTOCK');
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId, lines: [{ productId: withStock, quantity: 10, unitCost: 1 }] }).expect(201);
    await http().post(`/api/products/${withStock}/status`).set(auth()).send({ status: 'ARCHIVED' }).expect(400);

    const empty = await newProduct('NOSTOCK');
    await http().post(`/api/products/${empty}/status`).set(auth()).send({ status: 'ARCHIVED' }).expect(201);
  });

  it('freezes base unit and tracking flags once movements exist', async () => {
    const p = await newProduct('FROZEN');
    await http().post('/api/inventory/opening-balances').set(auth()).send({ warehouseId, lines: [{ productId: p, quantity: 5, unitCost: 1 }] }).expect(201);
    await http().patch(`/api/products/${p}`).set(auth()).send({ isSerialized: true }).expect(400);
    await http().patch(`/api/products/${p}`).set(auth()).send({ baseUomId: unit2Id }).expect(400);
    // descriptive edits still allowed
    await http().patch(`/api/products/${p}`).set(auth()).send({ name: 'Frozen Renamed' }).expect(200);
  });

  it('requires an active variant to activate a variant-product; variant lifecycle does not archive the parent', async () => {
    const p = await newProduct('VARLIFE');
    const v = (await http().post(`/api/products/${p}/variants`).set(auth()).send({ sku: `VARLIFE-V-${unique}` }).expect(201)).body;
    // deactivate the only variant, then the product
    await http().post(`/api/products/${p}/variants/${v.id}/status`).set(auth()).send({ status: 'INACTIVE' }).expect(201);
    const stillActive = (await http().get(`/api/products/${p}`).set(auth()).expect(200)).body;
    expect(stillActive.status).toBe('ACTIVE'); // variant change did not cascade
    await http().post(`/api/products/${p}/status`).set(auth()).send({ status: 'INACTIVE' }).expect(201);
    // cannot re-activate with no active variant
    await http().post(`/api/products/${p}/status`).set(auth()).send({ status: 'ACTIVE' }).expect(400);
    // activate a variant, then the product succeeds
    await http().post(`/api/products/${p}/variants/${v.id}/status`).set(auth()).send({ status: 'ACTIVE' }).expect(201);
    await http().post(`/api/products/${p}/status`).set(auth()).send({ status: 'ACTIVE' }).expect(201);
  });
});

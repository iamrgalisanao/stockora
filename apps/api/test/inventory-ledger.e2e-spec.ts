import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PERMISSIONS } from '@iw/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { InventoryPostingService } from '../src/inventory/inventory-posting.service';
import { InventoryQueryService } from '../src/inventory/inventory-query.service';
import type { RequestUser } from '../src/common/request-user';

/**
 * Phase 07-08 ledger integrity tests (Phase 0 §21). Exercises the posting service and
 * balance projection directly against a live Postgres. Requires migrations applied.
 */
describe('Inventory ledger + balance engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: InventoryPostingService;
  let query: InventoryQueryService;

  let orgId: string;
  let unitId: string;
  let user: RequestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    posting = app.get(InventoryPostingService);
    query = app.get(InventoryQueryService);

    const org = await prisma.organization.create({
      data: { name: `Ledger ${Date.now()}`, slug: `ledger-${randomUUID()}` },
    });
    orgId = org.id;
    const unit = await prisma.unitOfMeasure.create({
      data: { organizationId: orgId, code: 'PCS', name: 'Piece', precision: 0 },
    });
    unitId = unit.id;

    user = {
      userId: randomUUID(),
      email: 'ledger@test',
      name: 'Ledger Tester',
      sessionId: randomUUID(),
      membershipId: randomUUID(),
      organizationId: orgId,
      roleKey: 'administrator',
      roleName: 'Administrator',
      permissions: [
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.COST_VIEW,
        PERMISSIONS.VALUATION_VIEW,
        PERMISSIONS.INVENTORY_ADJUST,
      ],
      warehouseScope: null,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  async function makeProduct(sku: string, allowNegative = false): Promise<string> {
    const p = await prisma.product.create({
      data: { organizationId: orgId, sku: `${sku}-${randomUUID().slice(0, 8)}`, name: sku, baseUomId: unitId, allowNegative },
    });
    return p.id;
  }
  async function makeWarehouse(code: string): Promise<string> {
    const w = await prisma.warehouse.create({
      data: { organizationId: orgId, code: `${code}-${randomUUID().slice(0, 6)}`, name: code },
    });
    return w.id;
  }
  const ctx = () => ({ organizationId: orgId, actorId: user.userId });
  async function onHandOf(productId: string, warehouseId: string): Promise<string> {
    const balances = await query.listBalances(orgId, user, { productId, warehouseId });
    return balances[0]?.onHand ?? '0';
  }
  async function balance(productId: string, warehouseId: string) {
    const b = await query.listBalances(orgId, user, { productId, warehouseId });
    return b[0];
  }

  it('receive 100, release 20 -> on-hand 80', async () => {
    const product = await makeProduct('RCV');
    const wh = await makeWarehouse('W');
    await posting.receipt(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 100, unitCost: 100 }] });
    await posting.release(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 20 }] });
    expect(await onHandOf(product, wh)).toBe('80');
  });

  it('transfer maintains in-transit: A 100 -> dispatch 30 -> receive 30', async () => {
    const product = await makeProduct('TRF');
    const a = await makeWarehouse('A');
    const b = await makeWarehouse('B');
    await posting.openingBalance(ctx(), { warehouseId: a, lines: [{ productId: product, quantity: 100, unitCost: 50 }] });

    const dispatch = await posting.transferDispatch(ctx(), {
      sourceWarehouseId: a,
      lines: [{ productId: product, quantity: 30 }],
    });
    let ba = await balance(product, a);
    expect(ba!.onHand).toBe('70');
    expect(ba!.inTransit).toBe('30');
    expect(await onHandOf(product, b)).toBe('0'); // destination NOT increased on dispatch

    // Carry the source WAC to the destination.
    const carriedCost = dispatch[0]!.unitCost;
    await posting.transferReceive(ctx(), {
      sourceWarehouseId: a,
      destWarehouseId: b,
      lines: [{ productId: product, quantity: 30, unitCost: carriedCost }],
    });
    ba = await balance(product, a);
    const bb = await balance(product, b);
    expect(ba!.onHand).toBe('70');
    expect(ba!.inTransit).toBe('0');
    expect(bb!.onHand).toBe('30');
    expect(bb!.avgCost).toBe('50'); // cost carried across the transfer
  });

  it('concurrent releases never oversell (row lock)', async () => {
    const product = await makeProduct('CNC');
    const wh = await makeWarehouse('C');
    await posting.openingBalance(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 10, unitCost: 1 }] });

    const results = await Promise.allSettled([
      posting.release(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 8 }] }),
      posting.release(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 5 }] }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBe(1); // only one of 8/5 can succeed against 10 (never both)
    const onHand = Number(await onHandOf(product, wh));
    expect(onHand).toBeGreaterThanOrEqual(0); // never oversold
    // Whichever won the row lock first: 10-8=2 or 10-5=5. Both are valid; both succeeding is not.
    expect([2, 5]).toContain(onHand);
  });

  it('idempotent posting: same key applies once', async () => {
    const product = await makeProduct('IDM');
    const wh = await makeWarehouse('I');
    const key = `open-${randomUUID()}`;
    const c = { organizationId: orgId, actorId: user.userId, idempotencyKey: key };
    await posting.openingBalance(c, { warehouseId: wh, lines: [{ productId: product, quantity: 100, unitCost: 10 }] });
    await posting.openingBalance(c, { warehouseId: wh, lines: [{ productId: product, quantity: 100, unitCost: 10 }] });
    expect(await onHandOf(product, wh)).toBe('100'); // not 200
  });

  it('reversal + replacement restores exact quantity', async () => {
    const product = await makeProduct('REV');
    const wh = await makeWarehouse('R');
    const [receipt] = await posting.receipt(ctx(), {
      warehouseId: wh,
      lines: [{ productId: product, quantity: 100, unitCost: 100 }],
    });
    await posting.reverseMovement(ctx(), receipt!.id, 'wrong quantity');
    expect(await onHandOf(product, wh)).toBe('0');
    await posting.receipt(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 80, unitCost: 100 }] });
    expect(await onHandOf(product, wh)).toBe('80');
  });

  it('weighted average cost: 100@100 + 50@120 = 106.6667', async () => {
    const product = await makeProduct('WAC');
    const wh = await makeWarehouse('WACWH');
    await posting.receipt(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 100, unitCost: 100 }] });
    await posting.receipt(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 50, unitCost: 120 }] });
    const b = await balance(product, wh);
    expect(b!.avgCost).toBe('106.6667');
    expect(b!.value).toBe('16000.005'); // 150 * 106.6667
  });

  it('rejects release beyond available when negative inventory is disallowed', async () => {
    const product = await makeProduct('NEG');
    const wh = await makeWarehouse('N');
    await posting.openingBalance(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 5, unitCost: 1 }] });
    await expect(
      posting.release(ctx(), { warehouseId: wh, lines: [{ productId: product, quantity: 10 }] }),
    ).rejects.toThrow();
    expect(await onHandOf(product, wh)).toBe('5'); // unchanged
  });

  it('reconciliation: projection matches the ledger', async () => {
    const result = await query.reconcile(orgId);
    expect(result.ok).toBe(true);
    expect(result.drift).toHaveLength(0);
  });
});

import { Test } from '@nestjs/testing';
import { PERMISSIONS } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from '../inventory/inventory.constants';
import { ReorderAssessmentService } from './reorder-assessment.service';

/**
 * Unit coverage for the authoritative reorder calculation. Reserved and quarantined
 * stock have no public write path yet (2B), so their effect on availability is
 * verified here with crafted balances rather than through HTTP.
 */
describe('ReorderAssessmentService (unit)', () => {
  const ORG = 'org-1';
  const WH = 'wh-1';
  const UOM = 'PCS';

  const user = (opts: Partial<RequestUser> = {}): RequestUser => ({
    userId: 'u1',
    email: 'u@x.test',
    membershipId: 'm1',
    organizationId: ORG,
    roleKey: 'admin',
    roleName: 'Admin',
    permissions: [PERMISSIONS.COST_VIEW],
    warehouseScope: null,
    ...opts,
  });

  // Builds a service whose Prisma returns one policy + one matching balance.
  function build(
    policy: Partial<{
      minStock: number;
      maxStock: number | null;
      reorderPoint: number;
      reorderQuantity: number;
      productId: string;
      variantId: string;
      preferredSupplierId: string | null;
      cost: number;
    }>,
    balance: Partial<{ onHand: number; reserved: number; quarantined: number; inTransit: number }> | null,
    extras: { activeVariant?: boolean; spCost?: number } = {},
  ) {
    const productId = policy.productId ?? 'p1';
    const variantId = policy.variantId ?? NIL_UUID;
    const prisma = {
      inventoryPolicy: {
        findMany: jest.fn().mockResolvedValue([
          {
            warehouseId: WH,
            productId,
            variantId,
            minStock: policy.minStock ?? 0,
            maxStock: policy.maxStock ?? null,
            reorderPoint: policy.reorderPoint ?? 0,
            reorderQuantity: policy.reorderQuantity ?? 10,
            preferredSupplierId: policy.preferredSupplierId ?? null,
            warehouse: { code: 'MAIN' },
            product: { sku: 'SKU', name: 'Name', cost: policy.cost ?? 0, baseUom: { code: UOM } },
            preferredSupplier: policy.preferredSupplierId ? { companyName: 'Acme' } : null,
          },
        ]),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue(extras.activeVariant === false ? [] : [{ id: variantId }]),
      },
      inventoryBalance: {
        findMany: jest.fn().mockResolvedValue(
          balance
            ? [
                {
                  productId,
                  variantId,
                  warehouseId: WH,
                  onHand: balance.onHand ?? 0,
                  reserved: balance.reserved ?? 0,
                  quarantined: balance.quarantined ?? 0,
                  inTransit: balance.inTransit ?? 0,
                },
              ]
            : [],
        ),
      },
      supplierProduct: {
        findMany: jest.fn().mockResolvedValue(
          extras.spCost !== undefined && policy.preferredSupplierId
            ? [{ supplierId: policy.preferredSupplierId, productId, cost: extras.spCost }]
            : [],
        ),
      },
    };
    const service = new ReorderAssessmentService(prisma as unknown as PrismaService);
    return { service, prisma };
  }

  it('uses available (onHand − reserved − quarantined); reserved pushes below reorder point', async () => {
    // onHand 20 is above reorderPoint 15, but reserved 8 leaves 12 available → reorder.
    const { service } = build({ reorderPoint: 15, reorderQuantity: 30 }, { onHand: 20, reserved: 8 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.onHand).toBe('20');
    expect(a.available).toBe('12');
    expect(a.state).toBe('REORDER_REQUIRED');
    expect(a.recommendedQuantity).toBe('30');
  });

  it('excludes quarantined stock from availability', async () => {
    const { service } = build({ reorderPoint: 15, reorderQuantity: 5 }, { onHand: 20, quarantined: 10 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.available).toBe('10'); // 20 − 10 quarantined
    expect(a.state).toBe('REORDER_REQUIRED');
  });

  it('surfaces in-transit without counting it, and downgrades to INBOUND_COVERED', async () => {
    const { service } = build({ reorderPoint: 15, reorderQuantity: 5 }, { onHand: 10, inTransit: 20 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.available).toBe('10'); // in-transit NOT added
    expect(a.inTransit).toBe('20');
    expect(a.state).toBe('INBOUND_COVERED'); // 10 + 20 > 15
    expect(a.recommendedQuantity).toBe('0'); // only REORDER_REQUIRED recommends
  });

  it('marks OUT_OF_STOCK when available ≤ 0', async () => {
    const { service } = build({ reorderPoint: 5, reorderQuantity: 5 }, { onHand: 0 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.state).toBe('OUT_OF_STOCK');
  });

  it('marks OVERSTOCK when onHand exceeds maxStock', async () => {
    const { service } = build({ reorderPoint: 5, reorderQuantity: 5, maxStock: 50 }, { onHand: 80 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.state).toBe('OVERSTOCK');
  });

  it('marks LOW_STOCK only in the band between reorderPoint and minStock (minStock > reorderPoint)', async () => {
    const { service } = build({ minStock: 30, reorderPoint: 10, reorderQuantity: 5 }, { onHand: 20 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.state).toBe('LOW_STOCK'); // 20 > reorderPoint 10 but ≤ minStock 30
  });

  it('returns OK when comfortably stocked', async () => {
    const { service } = build({ reorderPoint: 5, reorderQuantity: 5, maxStock: 100 }, { onHand: 40 });
    const a = (await service.assess(ORG, user()))[0]!;
    expect(a.state).toBe('OK');
  });

  it('estimates cost from the preferred-supplier price and gates it behind cost.view', async () => {
    const withCost = build(
      { reorderPoint: 15, reorderQuantity: 4, preferredSupplierId: 's1', cost: 100 },
      { onHand: 5 },
      { spCost: 25 },
    );
    const a = (await withCost.service.assess(ORG, user()))[0]!;
    expect(a.estimatedCost).toBe('100'); // 4 × 25 supplier price (not 4 × 100 product cost)

    const noCost = build({ reorderPoint: 15, reorderQuantity: 4, cost: 100 }, { onHand: 5 });
    const b = (await noCost.service.assess(ORG, user({ permissions: [] })))[0]!;
    expect(b.estimatedCost).toBeUndefined();
  });

  it('drops a policy whose variant is not ACTIVE', async () => {
    const { service } = build(
      { reorderPoint: 15, reorderQuantity: 5, variantId: 'v1' },
      { onHand: 5 },
      { activeVariant: false },
    );
    expect(await service.assess(ORG, user())).toEqual([]);
  });

  it('rolls up dashboard counts by state', async () => {
    const { service } = build({ reorderPoint: 15, reorderQuantity: 5 }, { onHand: 5 });
    expect(await service.counts(ORG, user())).toEqual({ lowStockCount: 0, outOfStockCount: 0, reorderCount: 1 });
  });
});

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SerialStatus, SerialCaptureMode as PrismaSerialCaptureMode } from '@prisma/client';
import type { InventoryMovement } from '@prisma/client';
import type {
  SerialCaptureMode,
  SerialReconciliationResult,
  SerialReconciliationRow,
  SerialResponse,
  SerialStatus as SerialStatusContract,
  SerialTrackingPolicyResponse,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from '../inventory/inventory.constants';
import type { UpsertSerialPolicyDto } from './dto/serial-policy.dto';

type Tx = Prisma.TransactionClient;

/** One goods-receipt line offered up for serial capture (assembled by the receiving flow). */
export interface ReceiptCaptureInput {
  lineRef: number;
  productId: string;
  variantId: string | null;
  locationId: string | null;
  lotId: string | null;
  isSerialized: boolean;
  isBatchTracked: boolean;
  captureMode: SerialCaptureMode;
  requireLotWhenBatchTracked: boolean;
  receivedQty: Prisma.Decimal;
  serialNumbers: string[];
}

/** A validated, normalized capture ready to write once its movement is posted. */
export interface PreparedReceiptCapture {
  lineRef: number;
  productId: string;
  variantKey: string;
  lotId: string | null;
  locationId: string | null;
  serialNumbers: string[]; // normalized; empty for lines that capture nothing
}

/** Physical serial state → balance bucket (ADR 0012 §8). ISSUED/DISPOSED/RESERVED are outside the check. */
const STATE_BUCKET: Partial<Record<SerialStatus, 'on_hand' | 'in_transit' | 'quarantined' | 'damaged'>> = {
  [SerialStatus.IN_STOCK]: 'on_hand',
  [SerialStatus.IN_TRANSIT]: 'in_transit',
  [SerialStatus.QUARANTINED]: 'quarantined',
  [SerialStatus.DAMAGED]: 'damaged',
};
const IN_INVENTORY_STATES = Object.keys(STATE_BUCKET) as SerialStatus[];

@Injectable()
export class SerialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Per-product capture policy (ADR 0012 §2)
  // -------------------------------------------------------------------------

  async getPolicy(organizationId: string, productId: string): Promise<SerialTrackingPolicyResponse> {
    await this.ensureProduct(organizationId, productId);
    const row = await this.prisma.serialTrackingPolicy.findUnique({
      where: { organizationId_productId: { organizationId, productId } },
    });
    if (!row) {
      // Implicit defaults — a serialized product with no stored policy captures at RECEIPT.
      return { productId, captureMode: 'RECEIPT', requireLotWhenBatchTracked: true, configured: false };
    }
    return {
      productId,
      captureMode: row.captureMode as SerialCaptureMode,
      requireLotWhenBatchTracked: row.requireLotWhenBatchTracked,
      configured: true,
    };
  }

  async upsertPolicy(
    organizationId: string,
    user: RequestUser,
    productId: string,
    dto: UpsertSerialPolicyDto,
  ): Promise<SerialTrackingPolicyResponse> {
    await this.ensureProduct(organizationId, productId);
    const requireLot = dto.requireLotWhenBatchTracked ?? true;
    const captureMode = dto.captureMode as PrismaSerialCaptureMode;
    const row = await this.prisma.serialTrackingPolicy.upsert({
      where: { organizationId_productId: { organizationId, productId } },
      create: { organizationId, productId, captureMode, requireLotWhenBatchTracked: requireLot },
      update: { captureMode, requireLotWhenBatchTracked: requireLot },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'serial_policy.updated',
      entityType: 'serial_tracking_policy',
      entityId: productId,
      newValue: { captureMode: dto.captureMode, requireLotWhenBatchTracked: requireLot },
    });
    return {
      productId,
      captureMode: row.captureMode as SerialCaptureMode,
      requireLotWhenBatchTracked: row.requireLotWhenBatchTracked,
      configured: true,
    };
  }

  /** Resolve capture policy for a set of products (defaults for any without a stored row). */
  async policyMapFor(
    organizationId: string,
    productIds: string[],
  ): Promise<Map<string, { captureMode: SerialCaptureMode; requireLotWhenBatchTracked: boolean }>> {
    const rows = productIds.length
      ? await this.prisma.serialTrackingPolicy.findMany({
          where: { organizationId, productId: { in: [...new Set(productIds)] } },
        })
      : [];
    const map = new Map<string, { captureMode: SerialCaptureMode; requireLotWhenBatchTracked: boolean }>();
    for (const r of rows) {
      map.set(r.productId, { captureMode: r.captureMode as SerialCaptureMode, requireLotWhenBatchTracked: r.requireLotWhenBatchTracked });
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Capture-at-receipt (ADR 0012 §6) — validate fully BEFORE posting, then write
  // inside the receipt's transaction linked to the ledger movement.
  // -------------------------------------------------------------------------

  /**
   * Validate every capture rule and return normalized serials. Detects all failure modes up front so
   * the receipt's posting transaction can commit ledger + registry atomically with no mid-flight surprises.
   */
  async validateReceiptCaptures(
    organizationId: string,
    inputs: ReceiptCaptureInput[],
  ): Promise<PreparedReceiptCapture[]> {
    const prepared: PreparedReceiptCapture[] = [];
    // (product::variant::serial) → first lineRef, for cross-line duplicate detection within the receipt.
    const seen = new Map<string, number>();
    // Serials to check for pre-existence, grouped by product/variant.
    const existenceProbe = new Map<string, { productId: string; variantKey: string; serials: string[] }>();

    for (const input of inputs) {
      const variantKey = input.variantId ?? NIL_UUID;
      const raw = input.serialNumbers ?? [];

      if (!input.isSerialized) {
        if (raw.length > 0) {
          throw new BadRequestException(`Product ${input.productId} is not serialized and cannot capture serial numbers`);
        }
        prepared.push({ lineRef: input.lineRef, productId: input.productId, variantKey, lotId: input.lotId, locationId: input.locationId, serialNumbers: [] });
        continue;
      }

      // Serialized product. Capture only in RECEIPT mode; ISSUE-mode serials are registered later (2D.3B).
      if (input.captureMode !== 'RECEIPT') {
        if (raw.length > 0) {
          throw new BadRequestException(`Product ${input.productId} captures serials at issue, not at receipt`);
        }
        prepared.push({ lineRef: input.lineRef, productId: input.productId, variantKey, lotId: input.lotId, locationId: input.locationId, serialNumbers: [] });
        continue;
      }

      // RECEIPT mode: quantity must be a whole number of units.
      if (!input.receivedQty.isInteger()) {
        throw new BadRequestException(`Serialized product ${input.productId} must be received in whole units (got ${input.receivedQty.toString()})`);
      }
      const expected = input.receivedQty.toNumber();

      // Normalize: trim surrounding whitespace, preserve case (ADR 0012 §6). Reject empties.
      const normalized = raw.map((s) => (s ?? '').trim());
      if (normalized.some((s) => s.length === 0)) {
        throw new BadRequestException(`Product ${input.productId}: empty serial numbers are not allowed`);
      }

      // Exact count against received (not ordered) quantity.
      if (normalized.length !== expected) {
        throw new BadRequestException(
          `Product ${input.productId}: expected ${expected} serial number(s) to match the received quantity, got ${normalized.length}`,
        );
      }

      // Duplicate within the line.
      if (new Set(normalized).size !== normalized.length) {
        throw new BadRequestException(`Product ${input.productId}: duplicate serial numbers within the line`);
      }

      // Batch + serial nesting: a batch-tracked serialized product needs a resolved lot.
      if (input.isBatchTracked && input.requireLotWhenBatchTracked && !input.lotId) {
        throw new BadRequestException(`Product ${input.productId} is batch-tracked; each serial must nest under a lot`);
      }

      // Duplicate across lines in the same receipt (product/variant scoped).
      for (const s of normalized) {
        const key = `${input.productId}::${variantKey}::${s}`;
        if (seen.has(key)) {
          throw new BadRequestException(`Serial ${s} appears on more than one line for the same product`);
        }
        seen.set(key, input.lineRef);
      }

      const probeKey = `${input.productId}::${variantKey}`;
      const probe = existenceProbe.get(probeKey) ?? { productId: input.productId, variantKey, serials: [] };
      probe.serials.push(...normalized);
      existenceProbe.set(probeKey, probe);

      prepared.push({ lineRef: input.lineRef, productId: input.productId, variantKey, lotId: input.lotId, locationId: input.locationId, serialNumbers: normalized });
    }

    // Pre-existence: a serial already registered for this product/variant cannot be received again.
    for (const { productId, variantKey, serials } of existenceProbe.values()) {
      const clash = await this.prisma.inventorySerial.findFirst({
        where: { organizationId, productId, variantId: variantKey, serialNumber: { in: serials } },
        select: { serialNumber: true },
      });
      if (clash) {
        throw new BadRequestException(`Serial ${clash.serialNumber} is already registered for this product`);
      }
    }

    return prepared;
  }

  /**
   * Write the registry rows inside the receipt transaction, each linked to the ledger movement that
   * carried its line (ADR 0012 §6a — one quantity movement, N serial identities linked via lastMovementId).
   */
  async createReceiptSerialsInTx(
    tx: Tx,
    organizationId: string,
    warehouseId: string,
    prepared: PreparedReceiptCapture[],
    movementByLineRef: Map<number, InventoryMovement>,
  ): Promise<number> {
    const now = new Date();
    const data: Prisma.InventorySerialCreateManyInput[] = [];
    for (const cap of prepared) {
      if (cap.serialNumbers.length === 0) continue;
      const movement = movementByLineRef.get(cap.lineRef);
      if (!movement) throw new BadRequestException('Internal: no ledger movement for a serialized line');
      for (const serialNumber of cap.serialNumbers) {
        data.push({
          organizationId,
          productId: cap.productId,
          variantId: cap.variantKey,
          serialNumber,
          lotId: cap.lotId,
          status: SerialStatus.IN_STOCK,
          currentWarehouseId: warehouseId,
          currentLocationId: cap.locationId,
          lastMovementId: movement.id,
          receivedAt: now,
        });
      }
    }
    if (data.length === 0) return 0;
    // No skipDuplicates: we validated uniqueness up front, so a clash here is a real concurrency error
    // and MUST abort the whole receipt (all-or-nothing).
    await tx.inventorySerial.createMany({ data });
    return data.length;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  async list(
    organizationId: string,
    user: RequestUser,
    filter: {
      productId?: string;
      warehouseId?: string;
      status?: SerialStatusContract;
      lotId?: string;
      serialNumber?: string;
      q?: string;
    },
  ): Promise<SerialResponse[]> {
    const where: Prisma.InventorySerialWhereInput = { organizationId };
    if (filter.productId) where.productId = filter.productId;
    if (filter.status) where.status = filter.status as SerialStatus;
    if (filter.lotId) where.lotId = filter.lotId;
    if (filter.serialNumber) where.serialNumber = filter.serialNumber;
    else if (filter.q) where.serialNumber = { contains: filter.q, mode: 'insensitive' };

    // Warehouse scope — a scoped user sees only serials currently in their warehouses.
    if (user.warehouseScope !== null) {
      where.currentWarehouseId = filter.warehouseId
        ? (user.warehouseScope.includes(filter.warehouseId) ? filter.warehouseId : '00000000-0000-0000-0000-000000000000')
        : { in: user.warehouseScope };
    } else if (filter.warehouseId) {
      where.currentWarehouseId = filter.warehouseId;
    }

    const rows = await this.prisma.inventorySerial.findMany({
      where,
      include: { product: { select: { sku: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return this.decorate(organizationId, rows);
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<SerialResponse> {
    const row = await this.prisma.inventorySerial.findFirst({
      where: { id, organizationId },
      include: { product: { select: { sku: true, name: true } } },
    });
    if (!row) throw new NotFoundException('Serial not found');
    if (user.warehouseScope !== null && row.currentWarehouseId && !user.warehouseScope.includes(row.currentWarehouseId)) {
      throw new NotFoundException('Serial not found');
    }
    const [res] = await this.decorate(organizationId, [row]);
    return res!;
  }

  // -------------------------------------------------------------------------
  // Reconciliation (ADR 0012 §8) — a health check, never a balance mutation.
  // -------------------------------------------------------------------------

  async reconcile(organizationId: string, filter?: { productId?: string }): Promise<SerialReconciliationResult> {
    const candidates = await this.prisma.product.findMany({
      where: { organizationId, isSerialized: true, ...(filter?.productId ? { id: filter.productId } : {}) },
      select: { id: true, sku: true },
    });
    // Only RECEIPT-capture products serial-track their in-stock units, so only they reconcile to the
    // balance buckets (ADR 0012 §8). ISSUE-capture products serialize at issue, leaving in-stock quantity
    // deliberately un-serialized — including them would report false drift.
    const policyMap = await this.policyMapFor(organizationId, candidates.map((p) => p.id));
    const products = candidates.filter((p) => (policyMap.get(p.id)?.captureMode ?? 'RECEIPT') === 'RECEIPT');
    if (products.length === 0) return { serialsChecked: 0, drift: [], ok: true };
    const productIds = products.map((p) => p.id);
    const skuOf = new Map(products.map((p) => [p.id, p.sku]));

    const serialGroups = await this.prisma.inventorySerial.groupBy({
      by: ['productId', 'variantId', 'currentWarehouseId', 'lotId', 'status'],
      where: { organizationId, productId: { in: productIds }, status: { in: IN_INVENTORY_STATES } },
      _count: { _all: true },
    });

    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, productId: { in: productIds } },
      select: { productId: true, variantId: true, warehouseId: true, lotId: true, onHand: true, inTransit: true, quarantined: true, damaged: true },
    });

    // key = product|variant|warehouse|lot|bucket
    const serialCounts = new Map<string, number>();
    let serialsChecked = 0;
    for (const g of serialGroups) {
      const bucket = STATE_BUCKET[g.status];
      if (!bucket) continue;
      const wh = g.currentWarehouseId ?? '∅';
      const lot = g.lotId ?? NIL_UUID;
      const key = `${g.productId}|${g.variantId}|${wh}|${lot}|${bucket}`;
      serialCounts.set(key, (serialCounts.get(key) ?? 0) + g._count._all);
      serialsChecked += g._count._all;
    }

    const balanceQty = new Map<string, Prisma.Decimal>();
    for (const b of balances) {
      const base = `${b.productId}|${b.variantId}|${b.warehouseId}|${b.lotId}`;
      // IN_STOCK maps to the non-quarantined physical portion of on-hand — quarantined stock is held WITHIN
      // on_hand (ADR 0012 §8; `available = onHand − reserved − quarantined`), and a v1 reservation never
      // moves a serial out of IN_STOCK, so reserved is NOT subtracted here. Damaged sits outside on_hand.
      for (const [bucket, val] of [
        ['on_hand', new Prisma.Decimal(b.onHand).sub(b.quarantined)],
        ['in_transit', new Prisma.Decimal(b.inTransit)],
        ['quarantined', new Prisma.Decimal(b.quarantined)],
        ['damaged', new Prisma.Decimal(b.damaged)],
      ] as const) {
        if (val.isZero()) continue;
        balanceQty.set(`${base}|${bucket}`, val);
      }
    }

    const drift: SerialReconciliationRow[] = [];
    for (const key of new Set([...serialCounts.keys(), ...balanceQty.keys()])) {
      const count = serialCounts.get(key) ?? 0;
      const qty = balanceQty.get(key) ?? new Prisma.Decimal(0);
      if (!qty.equals(count)) {
        const [productId, , warehouse, lot, bucket] = key.split('|');
        drift.push({
          productId: productId!,
          productSku: skuOf.get(productId!) ?? productId!,
          warehouseId: warehouse === '∅' ? null : warehouse!,
          lotId: lot === NIL_UUID ? null : lot!,
          bucket: bucket!,
          serialCount: count.toString(),
          balanceQty: qty.toString(),
        });
      }
    }
    return { serialsChecked, drift, ok: drift.length === 0 };
  }

  // -------------------------------------------------------------------------
  // Propagation (ADR 0012 §9) — registry state rides each ledger movement. Every method runs inside the
  // caller's posting transaction so serial state and the ledger commit atomically; validation happens up
  // front so an invalid serial fails the workflow before stock changes.
  // -------------------------------------------------------------------------

  /** Normalize a serial set the same way capture-at-receipt does (trim, reject empty/dupes). */
  normalize(raw: string[], productId: string): string[] {
    const norm = (raw ?? []).map((s) => (s ?? '').trim());
    if (norm.some((s) => s.length === 0)) {
      throw new BadRequestException(`Product ${productId}: empty serial numbers are not allowed`);
    }
    if (new Set(norm).size !== norm.length) {
      throw new BadRequestException(`Product ${productId}: duplicate serial numbers in the set`);
    }
    return norm;
  }

  /**
   * Move a set of EXISTING serials from an allowed prior state to a new one, atomically with `movementId`.
   * Validates existence, product/variant scope, current state, and (optionally) warehouse + lot, so a bad
   * serial aborts before anything commits. Returns the affected rows.
   */
  async transitionExistingInTx(
    tx: Tx,
    organizationId: string,
    opts: {
      productId: string;
      variantKey: string;
      serialNumbers: string[];
      expectFrom: SerialStatus[];
      to: SerialStatus;
      requireWarehouseId?: string | null;
      requireLotId?: string | null;
      setWarehouseId?: string | null;
      setLocationId?: string | null;
      setIssuedAt?: boolean;
      movementId: string;
    },
  ): Promise<void> {
    const numbers = this.normalize(opts.serialNumbers, opts.productId);
    if (numbers.length === 0) return;
    const rows = await tx.inventorySerial.findMany({
      where: { organizationId, productId: opts.productId, variantId: opts.variantKey, serialNumber: { in: numbers } },
    });
    const byNumber = new Map(rows.map((r) => [r.serialNumber, r]));
    for (const sn of numbers) {
      const row = byNumber.get(sn);
      if (!row) throw new BadRequestException(`Serial ${sn} is not registered for this product`);
      if (!opts.expectFrom.includes(row.status)) {
        throw new BadRequestException(`Serial ${sn} is ${row.status} and cannot transition to ${opts.to}`);
      }
      if (opts.requireWarehouseId != null && row.currentWarehouseId !== opts.requireWarehouseId) {
        throw new BadRequestException(`Serial ${sn} is not located in the expected warehouse`);
      }
      if (opts.requireLotId != null && row.lotId !== opts.requireLotId) {
        throw new BadRequestException(`Serial ${sn} does not belong to the allocated lot`);
      }
    }
    await tx.inventorySerial.updateMany({
      where: { organizationId, productId: opts.productId, variantId: opts.variantKey, serialNumber: { in: numbers } },
      data: {
        status: opts.to,
        lastMovementId: opts.movementId,
        ...(opts.setWarehouseId !== undefined ? { currentWarehouseId: opts.setWarehouseId } : {}),
        ...(opts.setLocationId !== undefined ? { currentLocationId: opts.setLocationId } : {}),
        ...(opts.setIssuedAt ? { issuedAt: new Date() } : {}),
      },
    });
  }

  /**
   * Register brand-new serials (capture-at-issue, or a controlled positive adjustment). Validates the
   * serials do not already exist for the product, then creates them in the target state.
   */
  async createSerialsInTx(
    tx: Tx,
    organizationId: string,
    opts: {
      productId: string;
      variantKey: string;
      lotId: string | null;
      serialNumbers: string[];
      status: SerialStatus;
      warehouseId: string | null;
      locationId?: string | null;
      movementId: string;
      received?: boolean; // set receivedAt (IN_STOCK registration)
      issued?: boolean; // set issuedAt (capture-at-issue)
    },
  ): Promise<void> {
    const numbers = this.normalize(opts.serialNumbers, opts.productId);
    if (numbers.length === 0) return;
    const clash = await tx.inventorySerial.findFirst({
      where: { organizationId, productId: opts.productId, variantId: opts.variantKey, serialNumber: { in: numbers } },
      select: { serialNumber: true },
    });
    if (clash) throw new BadRequestException(`Serial ${clash.serialNumber} is already registered for this product`);
    const now = new Date();
    await tx.inventorySerial.createMany({
      data: numbers.map((serialNumber) => ({
        organizationId,
        productId: opts.productId,
        variantId: opts.variantKey,
        serialNumber,
        lotId: opts.lotId,
        status: opts.status,
        currentWarehouseId: opts.warehouseId,
        currentLocationId: opts.locationId ?? null,
        lastMovementId: opts.movementId,
        ...(opts.received ? { receivedAt: now } : {}),
        ...(opts.issued ? { issuedAt: now } : {}),
      })),
    });
  }

  /**
   * Resolve the capture policy + serialization flags for one product (used by the domains to decide whether
   * a line needs serials and, if so, whether they are selected (RECEIPT) or created (ISSUE) at issue time).
   */
  async serialMetaFor(
    organizationId: string,
    productId: string,
  ): Promise<{ isSerialized: boolean; isBatchTracked: boolean; captureMode: SerialCaptureMode; requireLotWhenBatchTracked: boolean }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { isSerialized: true, isBatchTracked: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    const policy = (await this.policyMapFor(organizationId, [productId])).get(productId);
    return {
      isSerialized: product.isSerialized,
      isBatchTracked: product.isBatchTracked,
      captureMode: policy?.captureMode ?? 'RECEIPT',
      requireLotWhenBatchTracked: policy?.requireLotWhenBatchTracked ?? true,
    };
  }

  /** The current IN_STOCK serials for a scope (product/variant/warehouse[/lot]) — the count's expected set. */
  async inStockSerials(
    organizationId: string,
    productId: string,
    variantKey: string,
    warehouseId: string,
    lotId: string | null,
  ): Promise<string[]> {
    const rows = await this.prisma.inventorySerial.findMany({
      where: {
        organizationId,
        productId,
        variantId: variantKey,
        currentWarehouseId: warehouseId,
        status: SerialStatus.IN_STOCK,
        ...(lotId ? { lotId } : {}),
      },
      select: { serialNumber: true },
    });
    return rows.map((r) => r.serialNumber);
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async ensureProduct(organizationId: string, productId: string): Promise<void> {
    const p = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
    if (!p) throw new NotFoundException('Product not found');
  }

  private async decorate(
    organizationId: string,
    rows: Array<Prisma.InventorySerialGetPayload<{ include: { product: { select: { sku: true; name: true } } } }>>,
  ): Promise<SerialResponse[]> {
    const warehouseIds = [...new Set(rows.map((r) => r.currentWarehouseId).filter((x): x is string => !!x))];
    const lotIds = [...new Set(rows.map((r) => r.lotId).filter((x): x is string => !!x))];
    const [warehouses, lots] = await Promise.all([
      warehouseIds.length
        ? this.prisma.warehouse.findMany({ where: { organizationId, id: { in: warehouseIds } }, select: { id: true, code: true } })
        : Promise.resolve([]),
      lotIds.length
        ? this.prisma.inventoryLot.findMany({ where: { organizationId, id: { in: lotIds } }, select: { id: true, lotNumber: true } })
        : Promise.resolve([]),
    ]);
    const whCode = new Map(warehouses.map((w) => [w.id, w.code]));
    const lotNo = new Map(lots.map((l) => [l.id, l.lotNumber]));

    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productSku: r.product.sku,
      productName: r.product.name,
      variantId: r.variantId === NIL_UUID ? null : r.variantId,
      serialNumber: r.serialNumber,
      lotId: r.lotId,
      lotNumber: r.lotId ? lotNo.get(r.lotId) ?? null : null,
      status: r.status as SerialStatusContract,
      currentWarehouseId: r.currentWarehouseId,
      warehouseCode: r.currentWarehouseId ? whCode.get(r.currentWarehouseId) ?? null : null,
      currentLocationId: r.currentLocationId,
      lastMovementId: r.lastMovementId,
      receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
    }));
  }
}

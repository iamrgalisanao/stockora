import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, MovementType, InventoryMovement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BucketDeltas,
  D,
  Dec,
  NIL_UUID,
  ZERO,
  bucketDeltasFor,
  negateDeltas,
} from './inventory.constants';

type Tx = Prisma.TransactionClient;

export interface StockLine {
  productId: string;
  variantId?: string | null;
  quantity: Prisma.Decimal.Value;
  unitCost?: Prisma.Decimal.Value | null;
  locationId?: string | null;
  /** Override the default bucket deltas — e.g. consuming a reservation drops on_hand AND reserved. */
  deltas?: BucketDeltas;
}

export interface PostContext {
  organizationId: string;
  actorId?: string | null;
  idempotencyKey?: string | null;
  allowNegative?: boolean; // caller-supplied negative override (requires permission upstream)
  reason?: string | null;
}

interface MovementSpec {
  movementType: MovementType;
  productId: string;
  variantId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  quantity: Dec;
  unitCost?: Dec | null;
  deltas?: BucketDeltas;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  reversalOfId?: string | null;
  reason?: string | null;
  allowNegative?: boolean;
}

interface BalanceRow {
  id: string;
  onHand: Dec;
  reserved: Dec;
  inTransit: Dec;
  quarantined: Dec;
  damaged: Dec;
  avgCost: Dec;
}

const round4 = (d: Dec): Dec => d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

@Injectable()
export class InventoryPostingService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Public commands (each is one atomic, idempotent transaction)
  // -------------------------------------------------------------------------

  /** Opening balance — the first stock posting for a product in a warehouse. */
  openingBalance(
    ctx: PostContext,
    input: { warehouseId: string; lines: StockLine[] },
  ): Promise<InventoryMovement[]> {
    return this.postLines(ctx, MovementType.OPENING_BALANCE, input.warehouseId, input.lines, 'opening_balance');
  }

  /** Goods receipt posting (used by the receiving workflow later). */
  receipt(
    ctx: PostContext,
    input: { warehouseId: string; referenceType?: string; referenceId?: string; lines: StockLine[] },
  ): Promise<InventoryMovement[]> {
    return this.postLines(
      ctx,
      MovementType.PURCHASE_RECEIPT,
      input.warehouseId,
      input.lines,
      input.referenceType ?? 'goods_receipt',
      input.referenceId,
    );
  }

  /** Stock release / issue (SALES_RELEASE by default). */
  release(
    ctx: PostContext,
    input: {
      warehouseId: string;
      movementType?: MovementType;
      referenceType?: string;
      referenceId?: string;
      lines: StockLine[];
    },
  ): Promise<InventoryMovement[]> {
    return this.postLines(
      ctx,
      input.movementType ?? MovementType.SALES_RELEASE,
      input.warehouseId,
      input.lines,
      input.referenceType ?? 'stock_release',
      input.referenceId,
    );
  }

  /** Stock adjustment in/out with a reason. */
  adjustment(
    ctx: PostContext,
    input: { warehouseId: string; direction: 'IN' | 'OUT'; referenceId?: string; lines: StockLine[] },
  ): Promise<InventoryMovement[]> {
    const type = input.direction === 'IN' ? MovementType.STOCK_ADJUSTMENT_IN : MovementType.STOCK_ADJUSTMENT_OUT;
    return this.postLines(ctx, type, input.warehouseId, input.lines, 'stock_adjustment', input.referenceId);
  }

  /**
   * Transfer dispatch — moves stock out of the source into IN_TRANSIT. Returns the
   * movements; each carries `unitCost` (source WAC) so the receive step can blend it
   * into the destination's WAC.
   */
  transferDispatch(
    ctx: PostContext,
    input: { sourceWarehouseId: string; referenceId?: string; lines: StockLine[] },
  ): Promise<InventoryMovement[]> {
    return this.postLines(
      ctx,
      MovementType.TRANSFER_OUT,
      input.sourceWarehouseId,
      input.lines,
      'stock_transfer',
      input.referenceId,
    );
  }

  /**
   * Transfer receive — clears IN_TRANSIT at the source and raises on_hand at the
   * destination (two movements per line), at the carried source WAC. In-transit is
   * held at the SOURCE between dispatch and receive (Phase 0 §6, §8).
   */
  transferReceive(
    ctx: PostContext,
    input: {
      sourceWarehouseId: string;
      destWarehouseId: string;
      referenceId?: string;
      lines: StockLine[];
    },
  ): Promise<InventoryMovement[]> {
    if (input.lines.length === 0) throw new BadRequestException('At least one line is required');
    const ref = input.referenceId ?? randomUUID();
    const specs: MovementSpec[] = [];
    input.lines.forEach((line, i) => {
      const qty = D(line.quantity);
      // Clear in-transit at the source (no cost effect).
      specs.push({
        movementType: MovementType.TRANSFER_IN,
        productId: line.productId,
        variantId: line.variantId ?? null,
        warehouseId: input.sourceWarehouseId,
        quantity: qty,
        deltas: { onHand: ZERO, reserved: ZERO, inTransit: qty.neg(), quarantined: ZERO, damaged: ZERO },
        referenceType: 'stock_transfer',
        referenceId: ref,
        idempotencyKey: i === 0 ? ctx.idempotencyKey ?? null : null,
        reason: ctx.reason ?? null,
      });
      // Raise on_hand at the destination at the carried cost.
      specs.push({
        movementType: MovementType.TRANSFER_IN,
        productId: line.productId,
        variantId: line.variantId ?? null,
        warehouseId: input.destWarehouseId,
        locationId: line.locationId ?? null,
        quantity: qty,
        unitCost: line.unitCost != null ? D(line.unitCost) : null,
        deltas: { onHand: qty, reserved: ZERO, inTransit: ZERO, quarantined: ZERO, damaged: ZERO },
        referenceType: 'stock_transfer',
        referenceId: ref,
        reason: ctx.reason ?? null,
      });
    });
    return this.postSpecs(ctx, specs, 'stock_transfer', ref);
  }

  /** Reverses a posted movement (correction). Restores quantities exactly (Phase 0 §10, §21). */
  async reverseMovement(
    ctx: PostContext,
    movementId: string,
    reason: string,
  ): Promise<InventoryMovement> {
    const original = await this.prisma.inventoryMovement.findFirst({
      where: { id: movementId, organizationId: ctx.organizationId },
    });
    if (!original) throw new BadRequestException('Movement not found');
    if (original.reversalOfId) throw new BadRequestException('Cannot reverse a reversal');

    const deltas: BucketDeltas = negateDeltas({
      onHand: D(original.onHandDelta),
      reserved: D(original.reservedDelta),
      inTransit: D(original.inTransitDelta),
      quarantined: D(original.quarantinedDelta),
      damaged: D(original.damagedDelta),
    });

    return this.prisma.$transaction(async (tx) => {
      const [m] = await this.applyMovements(tx, ctx, [
        {
          movementType: original.movementType,
          productId: original.productId,
          variantId: original.variantId,
          warehouseId: original.warehouseId,
          locationId: original.locationId,
          quantity: D(original.quantity),
          unitCost: D(original.unitCost),
          deltas,
          referenceType: 'reversal',
          referenceId: original.id,
          reversalOfId: original.id,
          reason,
          idempotencyKey: ctx.idempotencyKey ?? null,
          allowNegative: true, // a reversal must always be allowed to restore state
        },
      ]);
      return m!;
    });
  }

  // -------------------------------------------------------------------------
  // Core
  // -------------------------------------------------------------------------

  private async postLines(
    ctx: PostContext,
    type: MovementType,
    warehouseId: string,
    lines: StockLine[],
    referenceType: string,
    referenceId?: string,
  ): Promise<InventoryMovement[]> {
    if (lines.length === 0) throw new BadRequestException('At least one line is required');
    const ref = referenceId ?? randomUUID();
    const specs: MovementSpec[] = lines.map((line, i) => ({
      movementType: type,
      productId: line.productId,
      variantId: line.variantId ?? null,
      warehouseId,
      locationId: line.locationId ?? null,
      quantity: D(line.quantity),
      unitCost: line.unitCost != null ? D(line.unitCost) : null,
      deltas: line.deltas,
      referenceType,
      referenceId: ref,
      // Only the first movement carries the idempotency key (unique per org).
      idempotencyKey: i === 0 ? ctx.idempotencyKey ?? null : null,
      reason: ctx.reason ?? null,
      allowNegative: ctx.allowNegative,
    }));
    return this.postSpecs(ctx, specs, referenceType, ref);
  }

  /** Runs a set of pre-built specs as one atomic, idempotent transaction. */
  private async postSpecs(
    ctx: PostContext,
    specs: MovementSpec[],
    referenceType: string,
    referenceId: string,
  ): Promise<InventoryMovement[]> {
    const priorFor = () =>
      this.prisma.inventoryMovement.findMany({
        where: { organizationId: ctx.organizationId, referenceType, referenceId },
        orderBy: { postedAt: 'asc' },
      });

    // Idempotency fast-path: return the prior result if this key already posted.
    if (ctx.idempotencyKey) {
      const prior = await this.prisma.inventoryMovement.findFirst({
        where: { organizationId: ctx.organizationId, idempotencyKey: ctx.idempotencyKey },
      });
      if (prior?.referenceId) {
        return this.prisma.inventoryMovement.findMany({
          where: { organizationId: ctx.organizationId, referenceType, referenceId: prior.referenceId },
          orderBy: { postedAt: 'asc' },
        });
      }
    }

    try {
      return await this.prisma.$transaction((tx) => this.applyMovements(tx, ctx, specs));
    } catch (e) {
      // Concurrent duplicate: the unique idempotency key lost the race — return the winner.
      if (this.isUniqueViolation(e) && ctx.idempotencyKey) {
        return priorFor();
      }
      throw e;
    }
  }

  private async applyMovements(
    tx: Tx,
    ctx: PostContext,
    specs: MovementSpec[],
  ): Promise<InventoryMovement[]> {
    const out: InventoryMovement[] = [];
    for (const spec of specs) {
      out.push(await this.applyMovement(tx, ctx, spec));
    }
    return out;
  }

  private async applyMovement(tx: Tx, ctx: PostContext, spec: MovementSpec): Promise<InventoryMovement> {
    const qty = spec.quantity;
    if (qty.lte(0)) throw new BadRequestException('quantity must be greater than 0');

    const product = await tx.product.findFirst({
      where: { id: spec.productId, organizationId: ctx.organizationId },
      select: { id: true, baseUomId: true, allowNegative: true },
    });
    if (!product) throw new BadRequestException(`Product ${spec.productId} not found`);

    const warehouse = await tx.warehouse.findFirst({
      where: { id: spec.warehouseId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!warehouse) throw new BadRequestException(`Warehouse ${spec.warehouseId} not found`);

    if (spec.variantId) {
      const variant = await tx.productVariant.findFirst({
        where: { id: spec.variantId, productId: spec.productId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!variant) throw new BadRequestException(`Variant ${spec.variantId} not found for product`);
    }

    const deltas = spec.deltas ?? bucketDeltasFor(spec.movementType, qty);
    const variantKey = spec.variantId ?? NIL_UUID;
    const bal = await this.lockOrCreateBalance(
      tx,
      ctx.organizationId,
      spec.productId,
      variantKey,
      spec.warehouseId,
    );

    const newOnHand = bal.onHand.add(deltas.onHand);
    const newReserved = bal.reserved.add(deltas.reserved);
    const newInTransit = bal.inTransit.add(deltas.inTransit);
    const newQuarantined = bal.quarantined.add(deltas.quarantined);
    const newDamaged = bal.damaged.add(deltas.damaged);

    // Negative guards.
    const negativeAllowed = spec.allowNegative || product.allowNegative || ctx.allowNegative;
    if (newOnHand.lt(0) && !negativeAllowed) {
      throw new ForbiddenException(
        `Insufficient stock: on-hand would become ${newOnHand.toString()} (negative inventory not allowed)`,
      );
    }
    // These buckets must never go negative — a negative means an invalid operation
    // (e.g. receiving a transfer that was never dispatched).
    for (const [name, v] of [
      ['reserved', newReserved],
      ['in_transit', newInTransit],
      ['quarantined', newQuarantined],
      ['damaged', newDamaged],
    ] as const) {
      if (v.lt(0)) {
        throw new BadRequestException(`Invalid operation: ${name} would become negative`);
      }
    }

    // Costing (moving weighted average).
    const { unitCost, totalCost, newAvg } = this.computeCost(bal, deltas.onHand, spec.unitCost ?? null);

    await tx.inventoryBalance.update({
      where: { id: bal.id },
      data: {
        onHand: newOnHand,
        reserved: newReserved,
        inTransit: newInTransit,
        quarantined: newQuarantined,
        damaged: newDamaged,
        avgCost: newAvg,
        version: { increment: 1 },
      },
    });

    const txnNumber = await this.nextNumber(tx, ctx.organizationId, 'movement', 'MV');

    return tx.inventoryMovement.create({
      data: {
        organizationId: ctx.organizationId,
        txnNumber,
        movementType: spec.movementType,
        productId: spec.productId,
        variantId: spec.variantId ?? null,
        warehouseId: spec.warehouseId,
        locationId: spec.locationId ?? null,
        quantity: qty,
        uomId: product.baseUomId,
        onHandDelta: deltas.onHand,
        reservedDelta: deltas.reserved,
        inTransitDelta: deltas.inTransit,
        quarantinedDelta: deltas.quarantined,
        damagedDelta: deltas.damaged,
        unitCost,
        totalCost,
        referenceType: spec.referenceType ?? null,
        referenceId: spec.referenceId ?? null,
        idempotencyKey: spec.idempotencyKey ?? null,
        reversalOfId: spec.reversalOfId ?? null,
        performedById: ctx.actorId ?? null,
        reason: spec.reason ?? null,
      },
    });
  }

  private computeCost(
    bal: BalanceRow,
    onHandDelta: Dec,
    providedUnitCost: Dec | null,
  ): { unitCost: Dec; totalCost: Dec; newAvg: Dec } {
    if (onHandDelta.gt(0)) {
      // Inflow — blend into the moving average.
      const eff = providedUnitCost ?? bal.avgCost;
      const newQty = bal.onHand.add(onHandDelta);
      const newAvg = newQty.gt(0)
        ? round4(bal.onHand.mul(bal.avgCost).add(onHandDelta.mul(eff)).div(newQty))
        : bal.avgCost;
      return { unitCost: round4(eff), totalCost: round4(onHandDelta.mul(eff)), newAvg };
    }
    if (onHandDelta.lt(0)) {
      // Outflow — valued at current average; average unchanged.
      const eff = bal.avgCost;
      return { unitCost: round4(eff), totalCost: round4(onHandDelta.abs().mul(eff)), newAvg: bal.avgCost };
    }
    return { unitCost: round4(providedUnitCost ?? ZERO), totalCost: ZERO, newAvg: bal.avgCost };
  }

  private async lockOrCreateBalance(
    tx: Tx,
    organizationId: string,
    productId: string,
    variantKey: string,
    warehouseId: string,
  ): Promise<BalanceRow> {
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO inventory_balances (id, organization_id, product_id, variant_id, warehouse_id, updated_at)
      VALUES (${id}::uuid, ${organizationId}::uuid, ${productId}::uuid, ${variantKey}::uuid, ${warehouseId}::uuid, now())
      ON CONFLICT (organization_id, product_id, variant_id, warehouse_id) DO NOTHING`;

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        on_hand: string;
        reserved: string;
        in_transit: string;
        quarantined: string;
        damaged: string;
        avg_cost: string;
      }>
    >`
      SELECT id, on_hand::text, reserved::text, in_transit::text, quarantined::text, damaged::text, avg_cost::text
      FROM inventory_balances
      WHERE organization_id = ${organizationId}::uuid
        AND product_id = ${productId}::uuid
        AND variant_id = ${variantKey}::uuid
        AND warehouse_id = ${warehouseId}::uuid
      FOR UPDATE`;

    const r = rows[0]!;
    return {
      id: r.id,
      onHand: D(r.on_hand),
      reserved: D(r.reserved),
      inTransit: D(r.in_transit),
      quarantined: D(r.quarantined),
      damaged: D(r.damaged),
      avgCost: D(r.avg_cost),
    };
  }

  private async nextNumber(tx: Tx, organizationId: string, key: string, prefix: string): Promise<string> {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `${prefix}-${seq.value.toString().padStart(6, '0')}`;
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }
}

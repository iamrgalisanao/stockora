import { Prisma, MovementType } from '@prisma/client';

/** Sentinel used in the balance projection to mean "no variant" (keeps the unique key NULL-free). */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export type Dec = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
export const ZERO = D(0);

export interface BucketDeltas {
  onHand: Dec;
  reserved: Dec;
  inTransit: Dec;
  quarantined: Dec;
  damaged: Dec;
}

const zeroDeltas = (): BucketDeltas => ({
  onHand: ZERO,
  reserved: ZERO,
  inTransit: ZERO,
  quarantined: ZERO,
  damaged: ZERO,
});

/**
 * Maps a movement type + positive quantity to the signed bucket deltas it applies
 * (Phase 0 §6 direction table). The persisted deltas are the source of truth; this
 * helper just constructs them for the standard movement types.
 */
export function bucketDeltasFor(type: MovementType, qty: Dec): BucketDeltas {
  const d = zeroDeltas();
  switch (type) {
    case MovementType.OPENING_BALANCE:
    case MovementType.PURCHASE_RECEIPT:
    case MovementType.STOCK_ADJUSTMENT_IN:
    case MovementType.PRODUCTION_OUTPUT:
      return { ...d, onHand: qty };

    case MovementType.SALES_RELEASE:
    case MovementType.SUPPLIER_RETURN:
    case MovementType.STOCK_ADJUSTMENT_OUT:
    case MovementType.PRODUCTION_CONSUMPTION:
    case MovementType.PROJECT_ISSUE:
    case MovementType.INTERNAL_CONSUMPTION:
      return { ...d, onHand: qty.neg() };

    case MovementType.TRANSFER_OUT:
      return { ...d, onHand: qty.neg(), inTransit: qty };
    case MovementType.TRANSFER_IN:
      return { ...d, inTransit: qty.neg(), onHand: qty };

    case MovementType.CUSTOMER_RETURN:
    case MovementType.RETURN_RECEIPT:
      // Return intake lands in quarantine but IS physically on hand (ADR 0006): on_hand +q and
      // quarantined +q net to zero availability change, since available = on_hand - reserved - quarantined.
      return { ...d, onHand: qty, quarantined: qty };

    case MovementType.RETURN_RESTOCK:
      // Release the quarantine hold; stock stays in the pool and becomes sellable.
      return { ...d, quarantined: qty.neg() };

    case MovementType.RETURN_DISPOSE:
      // Scrapped out of the building; clear the hold (on_hand -q, quarantined -q).
      return { ...d, onHand: qty.neg(), quarantined: qty.neg() };

    case MovementType.DAMAGE:
    case MovementType.EXPIRY:
      return { ...d, onHand: qty.neg(), damaged: qty };

    case MovementType.LOT_MIGRATION:
      // The legacy-lot backfill always passes explicit deltas (a bucket -q at NIL, +q at the lot).
      return d;

    default: {
      // Exhaustiveness guard — a new MovementType must declare its deltas here.
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function negateDeltas(d: BucketDeltas): BucketDeltas {
  return {
    onHand: d.onHand.neg(),
    reserved: d.reserved.neg(),
    inTransit: d.inTransit.neg(),
    quarantined: d.quarantined.neg(),
    damaged: d.damaged.neg(),
  };
}

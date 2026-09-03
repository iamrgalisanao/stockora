# Phase 2C.4 — Inventory-position model

**Status: ✅ Complete.** Final item of Phase 2C. A **read model over the existing ledger-backed balances** —
no new stored fields, no new inventory semantics. One backend read model feeds two operational views.

## One read model, two lenses
`GET /inventory/positions` returns one `InventoryPositionRow` per finest grain
**(product, variant, warehouse, lot)** with the buckets `onHand / reserved / quarantined / damaged /
inTransit` and derived `available`, plus lot **expiry context** for batch stock. Filters: `warehouseId`,
`productId`, `q` (SKU/product/lot), `hasStock`, and an availability `filter`.

- **`available = onHand − reserved − quarantined`.** `damaged` sits **outside** `onHand` (ADR 0007) and is
  **never subtracted again**. `inTransit` is inbound context and is **never** counted as available.
- Fully-drained rows (all buckets zero) are omitted. `avgCost` / `value` are gated by
  `cost.view` / `valuation.view`.

**Inventory Position** (web `/inventory/position`) — a product roll-up with an expandable warehouse → lot
tree ("where is my stock and what state is it in?"); non-batch products have no lot level. **Availability
lens** — a `what-can-I-promise` table emphasising Available / Reserved / Inbound / Quarantined / earliest
expiry, with availability filter chips (Available, Unavailable, Fully reserved, Quarantined, In-transit-only,
Negative/anomaly, Expired-lot).

## Operational reconciliation surface (drill-downs)
Each bucket links back to the records composing it: **Reserved → reservations**, **Quarantined → returns**,
**In transit → transfers**, **Lot → lot traceability**. Batch rows carry `expiryState`, so users see *why*
physical on-hand may not be releasable (expired / expiring) without duplicating FEFO logic — expired lots stay
visible and are flagged, never silently treated as outbound-eligible.

## Tests
- **e2e** (`inventory-position.e2e-spec.ts`, 5): the cross-domain acceptance scenario (receive 100 → reserve
  20 → transfer 15 → return 8 → restock 3 → damage 2 → release 10) with every bucket explained
  (onHand 81 / reserved 20 / quarantined 3 / damaged 2 / inTransit 15 / **available 58**), reserved &
  quarantined drill-downs summing to the same numbers, and ledger reconciliation holding for every
  ledger-backed bucket; lot-aware roll-up + distinctness and non-batch no-lot; expired lot visible & flagged;
  deterministic availability filters + search; org isolation, warehouse scope, and `cost.view` gating.
  **34 unit + 270 e2e green.** Browser-verified both views (roll-up tree with lot links + expiry badges;
  availability lens with drill links).

> Note: reservations are off-ledger (ADR 0005), so `POST /inventory/reconcile` — which sums movement deltas —
> reports the `reserved` bucket as drift whenever a reservation is active. The position read model is
> unaffected (it projects the balance buckets directly); the reconcile endpoint's handling of the off-ledger
> `reserved` bucket is tracked as a separate follow-up.

## Definition of done (2C.4)
> An authorized user can see the complete current inventory position by product, warehouse, and lot;
> distinguish physical, committed, quarantined, damaged, inbound, and available quantities; and drill from
> each bucket back to the operational records composing it, with every total reconciling to the existing
> ledger-backed balances. — met. **Phase 2C is complete.**

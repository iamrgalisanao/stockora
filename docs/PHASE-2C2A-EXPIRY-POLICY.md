# Phase 2C.2A — Expiry Policy + Eligibility (backend)

**Status: ✅ Complete.** First slice of 2C.2 Expiry + FEFO, locked in [ADR 0008](adr/0008-expiry-fefo.md).
Expiry becomes a governed lot attribute with eligibility rules; FEFO auto-allocation is 2C.2B.

## Shelf-life policy
`ShelfLifePolicy` per `(org, product, variant)`: `expiryTrackingRequired`, `minimumShelfLifeOnReceiptDays?`,
`expiringSoonDays?`, `allocationStrategy` (MANUAL | FEFO). Absence ⇒ no expiry requirement + MANUAL; when
absent the response reports implicit defaults (`configured: false`) with `expiryTrackingRequired` seeded
from the product's `isExpiryTracked` flag. API: `GET/PUT /products/:productId/shelf-life-policy`
(`PRODUCT_MANAGE` to edit).

## Business-date expiry (centralized)
`common/business-date.ts` is the one place the calendar boundary is computed: a lot is **valid through**
its `expiryDate` and **expired when the business date > expiryDate** (`DEFAULT_BUSINESS_TZ`, org-settings
override-ready). Derived, non-persisted state `EXPIRED | EXPIRING_SOON | HEALTHY | NO_EXPIRY` from a
configurable `expiringSoonDays`. Lot lifecycle stays ACTIVE/CLOSED/ARCHIVED.

## Receiving / opening validation
Lot resolution (`LotsService.resolveLotId`, used by opening + receiving) now enforces the policy at stock
entry:
- `expiryTrackingRequired` ⇒ the resolved lot must carry an expiry date, else `400`.
- `minimumShelfLifeOnReceiptDays` ⇒ `remaining shelf life ≥ minimum`, else `400` — unless the line sets
  `allowShortShelfLife`, which requires the new **`inventory.expiry_override`** permission and is audited
  (`lot.short_shelf_life_override`).

## Eligibility (release + picker)
- **Release blocks expired lots**: posting a release whose allocation references an expired lot is rejected
  (`400`); physical stock is untouched (ADR 0008 §2 — expiry is not a physical move).
- **Picker excludes expired lots**: `GET /lots/pickable` returns only ACTIVE, in-stock, **non-expired**
  lots (each now carrying `expiryState`).
- Lot explorer gains an `expiryState` filter; `LotResponse`/`PickableLot` expose `expiryState`.

Permissions `inventory.expiry_override` and `inventory.fefo_override` (the latter reserved for 2C.2B) are
added and granted to admin + inventory/warehouse managers.

## Tests
- **e2e** (`lot-expiry.e2e-spec.ts`, 7): optional expiry when policy allows; expiry-required rejects a
  no-expiry receipt; minimum shelf life enforced + audited override; derived EXPIRED/EXPIRING_SOON/HEALTHY
  + `expiryState` filter; expired lot stays in on_hand yet is excluded from release and the picker;
  non-batch unaffected; policy get returns defaults then the configured row. **34 unit + 221 e2e green.**

## Next
**2C.2B — FEFO Allocation**: an `AllocationStrategy` abstraction + deterministic FEFO allocator that
generates `ReleaseAllocation[]` (earliest eligible expiry, deterministic tie-break, no-expiry last),
revalidated under lock at post, with `inventory.fefo_override` + reason + audit for manual bypass.

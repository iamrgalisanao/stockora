# ADR 0008 — Expiry + FEFO (Phase 2C.2)

**Status:** Accepted · **Date:** 2026-09-03 · **Related:** [0007 Batch/Lot Tracking](0007-batch-lot-tracking.md), [0005 Reservations](0005-reservations.md)

## Context

2C.1 established immutable lot identity. 2C.2 crosses the next boundary: the system now decides **which
lots are eligible** and **in what order** they should be consumed. That is a policy/allocation concern,
not a change to lot identity or the ledger. This ADR freezes the model before any migration.

## Core decisions

**1. Expiry is a lot attribute; FEFO is an allocation policy — kept separate.** `InventoryLot` already
carries `manufacturedAt?`/`expiryDate?`. FEFO logic never lives inside Release; it is one implementation
of an `AllocationStrategy` (`MANUAL | FEFO`) that *produces* `ReleaseAllocation[]`.

**2. Expired stock stays physical, but is not normally allocatable.** An ACTIVE lot past expiry remains
in `on_hand`; it is merely **excluded from normal release allocation**. Expiry is never a silent physical
move into damaged/quarantine — that requires an explicit warehouse action (a future expiry disposition).

**3. Business-date boundary, not timestamp ambiguity.** A lot is *valid through* its `expiryDate` and
becomes expired when the **local business date > expiryDate**. The business timezone is centralized in
`Organization.settings.timezone` (default a single config constant, `DEFAULT_BUSINESS_TZ`); a
`businessDate(now, tz)` helper is the one place the calendar boundary is computed. No scattered
`new Date()` comparisons.

**4. FEFO allocates only eligible stock, deterministically.** Candidate lots satisfy: `status = ACTIVE`,
per-warehouse `available > 0`, **not expired**, matching product/variant/warehouse. Ordering:
`expiryDate ASC, receivedAt ASC, lotNumber ASC` (fully deterministic tie-break). Lots **without**
`expiryDate` rank **after** all dated lots (dated first, non-expiring last).

**5. FEFO produces `ReleaseAllocation[]`; it never posts inventory.** `Release line → AllocationStrategy →
ReleaseAllocation[] → existing posting engine`. This is exactly the seam 2C.1B built — the posting engine
and its per-lot availability/negative guards are unchanged.

**6. Manual allocation remains first-class.** FEFO *suggests/auto-allocates*; it is not the only path.
Editing a FEFO plan into a non-FEFO sequence **when an earlier-expiring eligible lot exists** requires the
`inventory.fefo_override` permission **plus a reason**, and is audited. (Managers/admin get the permission.)

**7. FEFO is concurrency-safe by revalidation at post, not by trusting a preview.** Preview/suggestion is
**advisory**. Authoritative posting locks the selected lot balances, **revalidates** eligibility + quantity
under lock, and posts — or returns an allocation conflict. (Preview and posting stay decoupled; the
existing post transaction already locks each lot balance and guards negatives, so revalidation rides it.)

**8. Partial allocation is strict (Phase 2C).** A request for 100 with only 80 eligible **fails** with
insufficient-eligible-stock. No silent 80-of-100 release.

**9. Near-expiry is derived visibility, not persisted state.** From a centralized, configurable
`expiringSoonDays` (per-product override on the policy, else an org/global default), derive
`EXPIRED | EXPIRING_SOON | HEALTHY | NO_EXPIRY` at read time. These are **not** lot statuses — the lot
lifecycle stays `ACTIVE | CLOSED | ARCHIVED` (ADR 0007).

**10. Alerts are facts/read-model, not direct notifications.** The expiry engine produces queryable facts
(`LotExpiringSoon`, `LotExpired`) / a read model; it never calls email/chat directly. Notification wiring
waits for the domain-events/outbox infrastructure (kept separable, consistent with prior deferrals).

## Product shelf-life policy

Expiry expectations are **policy**, not hardcoded per product. Lot tracking and expiry tracking are
related but not identical — **not** every batch-tracked product requires expiry.

```
ShelfLifePolicy
- organizationId, productId, variantId (NIL sentinel)   // unique per (org, product, variant)
- expiryTrackingRequired: bool
- minimumShelfLifeOnReceiptDays?: int
- expiringSoonDays?: int          // overrides the org/global default
- allocationStrategy: MANUAL | FEFO   (default MANUAL)
```

Absence of a policy ⇒ no expiry requirement and MANUAL allocation. When a policy is first created,
`expiryTrackingRequired` seeds from the existing `Product.isExpiryTracked` flag.

## Receiving rules

- When `expiryTrackingRequired`: a receipt/opening line for that product **must** carry `expiryDate`.
- When `minimumShelfLifeOnReceiptDays` is set: `expiryDate >= businessDate + minimumShelfLifeOnReceiptDays`.
- A short-dated lot may be accepted only via an explicit, **audited override** (not by weakening the rule);
  the override permission is `inventory.fefo_override` reused, or a dedicated receiving override — decided
  in 2C.2A implementation. Never silently relax the policy globally.

## Release behavior

```
MANUAL → operator selects allocations (2C.1B, unchanged)
FEFO   → system generates allocations → operator reviews → existing posting consumes them
```

Editing a FEFO plan such that an earlier-expiring eligible lot is skipped ⇒ `inventory.fefo_override` +
reason + audit.

## Expired-stock handling (2C.2)

An expired lot is: excluded from normal release; visible in the expiry read model/dashboard; still
physically counted; still transferable / adjustable / count-correctable; and its return/disposition rules
stay explicit. **Expired stock is never auto-disposed.** A later explicit expiry-disposition workflow may
post `EXPIRY (onHand −q, damaged/expired +q)` — out of scope here.

## Slices

- **2C.2A — Expiry Policy + Eligibility:** `ShelfLifePolicy`; business-date/timezone helper; receiving
  validation (expiry required + minimum shelf life + audited override); expired/expiring-soon read model;
  release **blocks** expired lots. (No FEFO allocator yet.)
- **2C.2B — FEFO Allocation:** `AllocationStrategy` abstraction; deterministic FEFO allocator producing
  `ReleaseAllocation[]`; revalidation under lock at post; `inventory.fefo_override` + reason + audit for
  manual bypass.
- **2C.2C — Expiry UX + Alerts Foundation:** expiry dashboard, lot expiry badges, expiring/expired
  filters, FEFO preview UX, and alert/event facts (no direct notification coupling).

## Mandatory invariants (tested across the slices)

Business-date/timezone expiry; valid-through vs expired-after; batch lot may lack expiry when policy
allows; expiry-required receipt rejected without expiry; minimum-shelf-life enforced; expired lot excluded
from release yet remains in on_hand; FEFO picks earliest eligible expiry with deterministic tie-break;
no-expiry lots rank last; FEFO spans multiple lots; insufficient eligible ⇒ strict fail; preview does not
mutate; post revalidates under lock; concurrent releases cannot over-allocate a lot; manual override needs
permission + reason + audit; closed/archived and quarantined excluded; reservation consumption still works
with FEFO; non-batch unaffected; lot/product aggregates keep reconciling to the ledger.

## Definition of done (2C.2)

> A product can define shelf-life and allocation rules; expired lots remain physically traceable but
> cannot enter normal outbound allocation; and FEFO can deterministically generate safe lot allocations
> through the existing release engine without weakening ledger, concurrency, reservation, or
> manual-override controls.

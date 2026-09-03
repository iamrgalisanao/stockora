# Phase 2C.2B — FEFO Allocation (backend)

**Status: ✅ Complete.** Second slice of 2C.2 ([ADR 0008](adr/0008-expiry-fefo.md)). For FEFO-configured
products the system deterministically generates eligible lot allocations, revalidates them safely at post,
and requires authorized justification for a non-FEFO manual selection. Preview is advisory; post is
authoritative.

## Deterministic allocator (pure/read-only)
`LotsService.fefoPlan(...)` produces an `AllocationPlan { requestedQuantity, allocatedQuantity, complete,
strategy, generatedAt, allocations[] }`. Candidates: `status = ACTIVE`, per-warehouse `available > 0`,
**not expired**; ordered **expiryDate ASC (no-expiry last) → receivedAt ASC → lotNumber ASC → id ASC**;
greedily filled. It performs **zero writes**. `complete = false` when eligible stock cannot cover the
request — **strict mode** is enforced by the caller.

Preview endpoint: `GET /lots/fefo-plan?productId&warehouseId&quantity[&variantId]` (advisory).

## Release integration (post is authoritative)
`allocationStrategyFor(product)` comes from `ShelfLifePolicy` (MANUAL default). At release **post**, per
batch line:
- **FEFO + no allocations** → generate the canonical plan fresh; strict-fail if incomplete; post it.
- **allocations submitted** → **revalidate availability** first: a plan gone stale since preview (a chosen
  lot drained by another release) is a **409 conflict**, never silently reallocated. Then, under a FEFO
  policy, if the submitted plan **materially deviates** from canonical FEFO (per-lot totals differ,
  normalizing split entries — i.e. it bypasses an earlier-expiring eligible lot), it requires the
  **`inventory.fefo_override`** permission **plus a non-empty reason**, and is **audited**
  (`release.fefo_override` with the recommended vs submitted plans). A canonical plan needs no override.
- **MANUAL + no allocations** → rejected (batch requires allocations, 2C.1B rule).

Authoritative revalidation rides the existing post transaction: per-lot balance locks + never-negative
guards + the 2C.2A expired-lot block. Reservations stay lot-agnostic — a FEFO release against a reservation
drops on-hand at the lots and releases `reserved` on the NIL row (ADR 0005), with no lot-specific
reservation ownership.

## Tests
- **e2e** (`fefo-allocation.e2e-spec.ts`, 8): earliest-expiry-first spanning lots + zero-write preview;
  no-expiry-last and expired/closed exclusion; strict insufficient → incomplete plan + failed FEFO release;
  no-allocation FEFO release auto-generates and posts; stale submitted plan → 409; canonical needs no
  override while a bypassing plan needs permission + reason + audit; a user without `fefo_override` cannot
  bypass; and an **end-to-end** scenario (reserve 25 → FEFO A10/B15 against the reservation → C untouched →
  reserved released → per-lot ledger reconciled). A 2C.1B over-allocation test now asserts the earlier 409
  conflict. **34 unit + 229 e2e green.**

## Next
**2C.2C — Expiry UX + Alerts Foundation**: expiry dashboard, lot expiry badges, expiring/expired filters,
FEFO preview UX, and alert/event facts (no direct notification coupling) — closing 2C.2.

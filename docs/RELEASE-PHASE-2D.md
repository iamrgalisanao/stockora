# Release Baseline — Phase 2D

**Tag:** `phase-2d` · **Commit:** `feaa01a` · **Date:** 2026-09-04

A formal baseline snapshot taken at the close of Phase 2D. It records the correctness invariants the platform
guarantees, the architecture decisions that back them, known operational caveats, and the verification state
at tag time. This is the reference point the next major phase builds from.

## What the platform is now

A production-grade Inventory + Warehouse Management System built on an append-only movement ledger, with:
traceable inventory (lot + serial), immutable FIFO/WAC costing, reservations, returns/quarantine, FEFO,
cycle counting, a transactional-outbox event backbone, event-driven notifications (in-app · email · webhook),
transparent supplier analytics, and an installable, offline-capable Mobile Scanner PWA that preserves
correctness under offline and multi-device conditions.

## Core invariants (must hold across every future change)

1. **The ledger is append-only.** `InventoryMovement` rows are immutable; `InventoryBalance` is a derived
   projection, never mutated in place. Every stock change is a posted movement.
2. **Availability is derived, never stored ad hoc:** `available = onHand − reserved − quarantined`. Buckets
   (onHand/reserved/inTransit/quarantined/damaged) never go negative except onHand under an explicit,
   permissioned negative override.
3. **Approval before posting** for releases and transfers (Draft → Approve → Post); high-value adjustments
   require a second approver.
4. **Cost is valuation state over the same quantity ledger.** WAC and FIFO are strategies; FIFO cost layers
   are opened by inflows and consumed oldest-first under `FOR UPDATE` locks inside the posting transaction.
   Posted costs are immutable; a strategy switch requires zero stock; transfers preserve exact multi-layer
   basis; returns restore original issued basis or are rejected — never silently revalued.
5. **Serial identity is a registry-with-state over the ledger.** One immutable identity threads every
   workflow; transitions ride their movement; the registry always reconciles to the balance buckets; no
   substitution across transfer legs.
6. **Lot identity is immutable** and preserved unchanged through every physical workflow; FEFO allocation is
   deterministic, revalidated, and audited on override.
7. **Domain events are exactly-once at least-once-delivered** via the transactional outbox (atomic enqueue in
   the business tx; `SKIP LOCKED` lease relay; idempotent consumers via receipts; backoff + dead-letter).
8. **Tenancy + scope are always enforced:** every query is organization-scoped; warehouse scope and
   permissions are revalidated per request (membership/user/org status included).
9. **Mobile is online-authoritative with an offline command journal.** The device captures intent; the server
   and database remain the sole inventory authority. The first valid committed transaction wins; queued
   commands are revalidated and applied through the *existing* domain services (never reimplemented);
   exactly-once by idempotency key; conflicts are explicit and never silently merged, reallocated, or
   overwritten; no offline action is represented as committed inventory until an APPLIED receipt.

## Shipped ADRs (locked)

| ADR | Title |
| --- | --- |
| 0001 | Inventory invariants |
| 0002 | Phase 2 architecture |
| 0003 | Master data vs. ledger |
| 0004 | Audit read model |
| 0005 | Reservations |
| 0006 | Returns & disposition |
| 0007 | Batch / lot tracking |
| 0008 | Expiry / FEFO |
| 0009 | Cycle counting |
| 0010 | Transactional outbox |
| 0011 | Notifications |
| 0012 | Serial tracking |
| 0013 | FIFO costing |
| 0014 | Mobile scanner PWA & offline command journal |

## Phase map

- **Phase 0–1:** foundation, auth/RBAC, product master, ledger + balance engine, receiving, releases,
  transfers, adjustments, physical count, reorder, dashboard, reports.
- **Phase 2A–2C:** catalog/master-data UX, barcode & scanner UX, import/export, reservations, returns,
  batch/lot, expiry/FEFO, cycle counting.
- **Phase 2D:** transactional outbox (2D.1), notifications (2D.2), serial tracking (2D.3), supplier analytics
  (2D.4), FIFO costing (2D.5), Mobile Scanner PWA (2D.6: foundation · workflows · sync/conflict engine ·
  operational hardening). **Complete.**

## Verification state at tag

- **API e2e:** 57 suites / **406 tests green** (`npm --workspace @iw/api run test:e2e`).
- **Typecheck:** contracts, api, web all clean.
- **Web:** production build clean; the mobile PWA installs, runs offline, and was live-smoke-verified across
  its foundation, workflows, sync/conflict, and hardening slices.
- **Migrations:** `npm --workspace @iw/api run db:verify` replays every migration on a fresh shadow DB in
  order (catches ordering/replay errors before release). Requires `SHADOW_DATABASE_URL` → an empty throwaway
  database.

## Known operational caveats

- **UUID-default migration diff (benign).** `@default("00000000-…")` on `@db.Uuid` columns reads back from the
  database as a cast expression, so `prisma migrate diff --exit-code` always reports a non-empty default-only
  diff even when the schema is correct. `db:verify` tolerates this (exit 2 with only that diff) and fails only
  on a genuine replay error. Not a schema mismatch.
- **Async-timing test nondeterminism (resolved).** The `outbox-relay` and `notification-delivery` suites
  briefly showed rare full-suite-only flakes (never in isolation; production pollers are disabled under Jest).
  Root cause was test-only: a single `processBatch` under-draining, and immediate row re-reads racing commit
  visibility under shared-DB load. Fixed by draining to quiescence and bounded status re-reads — test-only
  changes that cannot mask a real failure. No production correctness impact: in production the outbox poller
  retries continuously to eventual consistency.
- **Background pollers are in-process** (outbox relay, notification delivery). They are safe to run on multiple
  app instances (`SKIP LOCKED` coordination) and are disabled under Jest. A future phase may move them to a
  dedicated worker for horizontal scale / observability.
- **Mobile optional features are progressive enhancements:** camera scanning, Background Sync, Wake Lock, and
  persistent storage are feature-detected; the hardware-wedge/manual path and foreground/manual sync always
  work. See the compatibility matrix in `docs/PHASE-2D6-MOBILE-SCANNER-PWA.md`.

## How to reproduce the baseline

```bash
npm --workspace @iw/contracts run build
npm --workspace @iw/api run typecheck
npm --workspace @iw/web run typecheck
npm --workspace @iw/web run build
npm --workspace @iw/api run test:e2e          # 57 suites / 406 tests
SHADOW_DATABASE_URL=postgres://…/empty_db npm --workspace @iw/api run db:verify
```

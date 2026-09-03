# Phase 2C.3A — ABC + Scheduling Core

**Status: ✅ Complete.** First slice of 2C.3 ([ADR 0009](adr/0009-cycle-counting.md)). A **planning/scheduling
layer** over the existing lot-aware Physical Count engine — it creates tasks, never counts. No ledger
semantics change; execution delegation lands in 2C.3B.

## ABC classification (a planning attribute, never inventory state)
`ProductClassification` per **(product, variant, warehouse)** — velocity is warehouse-scoped. Two strategies
ship: **MANUAL** (`PUT /cycle-count/classification` sets a single scope's class by hand) and
**MOVEMENT_VELOCITY** (`POST /cycle-count/classify` ranks stocked, ACTIVE products by
`Σ |movement quantity|` over the policy `lookbackDays`, then buckets by **configurable** thresholds —
default top 20% → A, next 30% → B, rest → C). Ranking is deterministic (velocity desc, then product/variant
id). `INVENTORY_VALUE` is a reserved strategy, not yet implemented. Classification touches nothing in the
ledger, balances, or allocation.

## Policy (org / warehouse scoped)
`CycleCountPolicy` (`GET`/`PUT /cycle-count/policy`) — `strategy`, per-class frequencies
(`a/b/cFrequencyDays`), `lookbackDays`, `a/bPercent` thresholds, `enabled`. Resolution is most-specific:
warehouse override → org default (NIL-sentinel row) → template defaults. **Absence of an enabled policy
disables scheduling** for that scope (no implicit counting).

## Coverage read model + due calculation
`GET /cycle-count/coverage` derives, per stocked scope (**lot-aware where the product is batch-tracked**):
`abcClass`, `lastCountedAt` (max `completedAt` of COMPLETED tasks — never inferred from task creation),
`nextDueAt = lastCountedAt + frequency(class)`, and `overdue` computed against the **business date**
(ADR 0008 helper). Never-counted stocked scopes are due now; zero-stock and inactive/archived products are
excluded. `hasActiveTask` flags scopes already scheduled.

## Task generation (scheduling creates tasks, not counts)
`POST /cycle-count/generate` creates a `CycleCountTask` for each **due, classified (A/B/C), not-already-active**
scope. Each task **snapshots** its `abcClass` and `policyContext` at generation, so a later reclassification
changes future planning but never rewrites the task (ADR 0009 §9). A **partial unique index** enforces at
most one active (`PENDING|ASSIGNED|IN_PROGRESS`) task per `(org, warehouse, product, variant, lot)` — the
generator is idempotent (a re-run adds nothing) and concurrency-safe (a duplicate insert is caught and
skipped). `POST /cycle-count/tasks` creates an explicit **AD_HOC** task; a second active task for the same
scope is refused. `OVERDUE` is derived from `dueAt`, never persisted.

## Basic assignment
`POST /cycle-count/tasks/:id/assign` sets `assignedToId` (validated as an active org member) and moves
`PENDING → ASSIGNED`. Assignment lives here (not 2C.3C) because it governs task ownership and uniqueness;
the counter worklist UX is 2C.3C.

## RBAC
New deny-by-default permissions: `cycle_count.view / classify / schedule / assign / manage_policy`. Managers
and admin get all; staff/auditor/viewer get `view` (execution still uses `inventory.count`).

## Tests
- **e2e** (`cycle-count-scheduling.e2e-spec.ts`, 13): manual + deterministic automatic classification with
  configurable thresholds; warehouse/org scoping; frequency-derived due dates (A vs C differ);
  business-date overdue; never-counted due & zero-stock excluded; generation creates/does-not-duplicate/idempotent;
  no-policy refusal + UNCLASSIFIED skipped; class/policy snapshot preserved across reclassification;
  lot-aware vs product-level tasks; ad-hoc + duplicate-scope refusal; assignment + non-member rejection;
  archived-product exclusion. **34 unit + 246 e2e green.** (Completion via Prisma-inserted COMPLETED tasks —
  real completion arrives in 2C.3B.)

## Definition of done (2C.3A)
> Inventory can be classified by counting priority (manually or by movement velocity), a policy governs
> per-class cadence, coverage shows what is due against the business date, and due work is generated as
> deterministic, non-duplicating, history-preserving tasks that can be assigned — all without touching the
> ledger or creating a second counting engine. — met.

## Next
**2C.3B — Count Session Integration:** start a task → `StockCount(type=CYCLE)` scoped to it → count →
reconcile through the existing engine → complete the task and stamp `lastCountedAt`; recount handling; start
concurrency/idempotency.

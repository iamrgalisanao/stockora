# ADR 0009 — Cycle Counting (Phase 2C.3)

**Status:** Accepted · **Date:** 2026-09-03 · **Related:** [0007 Batch/Lot Tracking](0007-batch-lot-tracking.md), [0008 Expiry + FEFO](0008-expiry-fefo.md), Physical Count engine (Phase 09)

## Context

The lot-aware Physical Count engine (`StockCount`, per-lot snapshot → count → review → approve → post →
`ADJUSTMENT_IN/OUT`) is already the authoritative reconciliation and posting path, and `CountType.CYCLE`
already exists on it. What is missing is the **planning layer**: deciding *which* stock to count, *how
often*, in *what priority*, and *tracking coverage over time*.

**Guiding principle — one counting engine, one source of truth.**

> Cycle counting **schedules and prioritizes** physical counts; it does **not** create a second
> inventory-counting engine. The existing lot-aware Physical Count remains the authoritative
> reconciliation/posting path. Everything 2C.3 adds is planning, delegation, and read-model reporting.

This ADR freezes the model before any migration.

## Core decisions

**1. ABC classification is a planning attribute, not inventory state.** A product (or lot-grain scope)
carries a classification `A | B | C | UNCLASSIFIED` used **only** to drive count frequency and priority.
It is assignable manually or computed from a policy, but it **never** touches the ledger, balances,
allocation, or any posting rule. It is metadata on planning, nothing more.

```
ABCClass = A | B | C | UNCLASSIFIED
```

**2. The scoring model is pluggable — never hardwire "A = highest value".** Classification is produced by
a named strategy so hybrid/forecasting models can be added later without rewriting queries:

```
ClassificationStrategy = MANUAL | MOVEMENT_VELOCITY | INVENTORY_VALUE
```

**2C.3A ships `MANUAL` + one automatic strategy only: `MOVEMENT_VELOCITY`** (reliable movement history
already exists). `INVENTORY_VALUE` and hybrids are reserved names, not built yet.

*Movement velocity* is deliberately simple and transparent:

```
velocity = Σ |physical movement quantity|  over the last `lookbackDays`   (per product, per warehouse)
```

Rank descending within scope, then bucket by **configurable** thresholds (defaults: top 20% → A, next
30% → B, remaining 50% → C). Thresholds live on the policy — **never** hardcoded into a query. Products
with zero movement in the window fall to C (not UNCLASSIFIED — UNCLASSIFIED means "no classification has
been run/assigned").

**3. Cycle-count policy is org/warehouse scoped, not per product.** One policy governs many products;
warehouse overrides are possible later without duplicating a policy per SKU.

```
CycleCountPolicy
- organizationId
- warehouseId?            // null = org default; a warehouse row overrides it
- strategy: ClassificationStrategy
- aFrequencyDays, bFrequencyDays, cFrequencyDays
- lookbackDays            // velocity window
- classThresholds         // configurable A/B cutoffs (percent), not hardcoded
- enabled: bool
```

Resolution: most-specific wins (warehouse row, else org row); absence of any policy ⇒ scheduling disabled
for that scope (no implicit counting).

**4. Track the last successful count separately from schedule generation — never infer "due" from task
creation.** A read model expresses coverage:

```
CycleCountCoverage   (derived / maintained read model)
- productId, variantId?, lotId?          // lot-aware grain where configured
- warehouseId
- abcClass
- lastCountedAt        // set ONLY when a delegated count POSTS successfully
- nextDueAt            // lastCountedAt (or epoch) + frequency(abcClass)
```

`nextDueAt` derives from the class frequency; due/overdue is computed against the **business date**
(ADR 0008's `businessDate` helper), the single calendar boundary. Never treat "a task exists" as "counted".

**5. Scheduling creates tasks, not counts.** The planning entity is distinct from `StockCount`:

```
CycleCountTask
- id, organizationId, warehouseId
- productId, variantId?, lotId?          // the counting scope
- abcClass                               // SNAPSHOT at generation (decision 9)
- policyContext                          // snapshot: strategy + frequency + thresholds used
- status
- dueAt, priority
- assignedTo?
- source: SCHEDULED | AD_HOC | RECOUNT
- physicalCountId?                       // the delegated StockCount, set on start
- supersedesTaskId?                      // for privileged recount/supersede
```

Lifecycle:

```
PENDING → ASSIGNED → IN_PROGRESS → COMPLETED
                   ↘ CANCELLED
OVERDUE  = derived (dueAt < businessDate), NOT a persisted status
```

`OVERDUE` is derived exactly like expiry state — it is a view over `dueAt`, never written.

**6. Count execution delegates to Physical Count — no duplicate variance logic.**

```
CycleCountTask
   │ start
   ▼
StockCount(type = CYCLE)   ── snapshot → count → review → approve → post (existing engine, unchanged)
   │ post succeeds
   ▼
CycleCountTask → COMPLETED, coverage.lastCountedAt updated
```

The task holds a reference (`physicalCountId`) to exactly one `StockCount`. All variance computation and
`ADJUSTMENT_IN/OUT` posting stay in the existing engine; 2C.3 adds no second reconciliation path.

**7. No overlapping active tasks for the same counting scope.** At most one **active**
(`PENDING | ASSIGNED | IN_PROGRESS`) task may exist per scope:

```
(organizationId, warehouseId, productId, variantId, lotId?)
```

The scheduler is idempotent against this: a re-run does not create a second active task for a scope that
already has one. A privileged ad-hoc **recount** may intentionally supersede an active task (recording
`supersedesTaskId`); ordinary generation never does.

**8. Ad-hoc counts stay first-class.** Not every count originates from ABC scheduling. `source` is always
explicit — `SCHEDULED` (from the scheduler), `AD_HOC` (operator-initiated), `RECOUNT` (a deliberate
re-verification linked to a prior task/count).

**9. Reclassification changes the future only — it never rewrites history.** When a product moves `B → A`,
future scheduling uses `A`; **already-generated tasks keep the `abcClass` and `policyContext` snapshotted
onto them at generation time**. Historical tasks remain readable in their original context. Recompute
affects `nextDueAt`/priority for *new* work, not the record of past work.

**10. Metrics are read-model facts, not posting rules.** KPIs are **derived** from task + count history at
read time (persist only if performance later demands it), never stored as authoritative state and never
influencing a posting:

```
On-time coverage %      Overdue task count       Counts completed
Count accuracy %        Absolute variance qty     Variance value
```

**Count accuracy** is defined explicitly, per counted item, bounded 0–100%:

```
accuracy = clamp( 1 − (absoluteVariance / expectedQuantity), 0, 1 )
```

Aggregate accuracy averages per-item accuracy over the counted items in scope. **Zero-expected-quantity
rule:** when `expectedQuantity = 0`, accuracy is **100%** if `countedQty = 0` (correctly counted empty),
otherwise **0%** (unexpected stock found). This avoids divide-by-zero and treats phantom stock as a full
miss.

## Delegation contract (what stays in Physical Count)

Unchanged and authoritative: per-lot expected-qty snapshot, blind-count handling, variance computation,
review/approve gates, and `ADJUSTMENT_IN/OUT` posting with `referenceType = 'stock_count'`. Cycle counting
**only** picks the scope, creates the `StockCount(type=CYCLE)` for it (a lot-scoped snapshot variant of
the existing product-scoped `create`), and observes its terminal `POSTED` state to close the task and stamp
coverage.

## Scope-grain rule

The scheduled counting unit respects the lot-aware grain **where configured**: a batch-tracked product
schedules **lot-aware** tasks (one active task per lot scope); a non-lot product stays **product-level**
(`lotId = null`). Reservations/allocation are untouched — this is purely which physical rows get verified.

## Slices

- **2C.3A — ABC + Scheduling Core:** `ABCClass` attribute; `CycleCountPolicy` (org/warehouse scope);
  `MANUAL` + `MOVEMENT_VELOCITY` classification with configurable thresholds; `CycleCountCoverage` read
  model + due calculation (business-date); `CycleCountTask` generation (idempotent, no duplicate active
  task per scope; snapshots class/policy context); **basic assignment** (`assignedTo`, permission-gated) —
  included here because it affects task ownership and uniqueness. *No* counter worklist UX yet.
- **2C.3B — Count Session Integration:** start task → `StockCount(type=CYCLE)` (lot-aware worklist scope);
  complete/reconcile through the existing engine; `lastCountedAt`/coverage updated only on `POSTED`;
  recount handling (`RECOUNT` + `supersedesTaskId`); full task lifecycle; start concurrency/idempotency
  (one count per task, no duplicate sessions).
- **2C.3C — UX + Metrics:** cycle-count dashboard; due/overdue worklists; assignment UI; ABC filters;
  links into count execution; coverage + accuracy metrics (read-model, reconciling to task/count history).

## Mandatory invariants (tested across the slices)

**2C.3A:** manual ABC assignment works; automatic classification is deterministic; classification scoped
correctly by org/warehouse; reclassification affects future tasks only (snapshots preserved); due date
derived from class frequency; A/B/C frequencies differ correctly; scheduler creates a task when due;
scheduler does not duplicate an active task for a scope; repeated scheduler run is idempotent;
inactive/archived products excluded; zero-stock handling follows the explicit policy; lot-tracked product
schedules lot-aware tasks where configured; non-lot product remains product-level; warehouse scope
enforced; ad-hoc task allowed; task snapshots the class/policy used to generate it; overdue derived from
business date/time.

**2C.3B:** starting a task creates exactly one `CYCLE` physical count; a replayed start does not create a
second count; count snapshot matches task scope; a batch-tracked task counts the correct lot; variance
posts through the existing count engine (no duplicate logic); task completes only after count
reconciliation posts; a cancelled task cannot start; a completed task cannot restart; recount creates an
explicit new task/count relationship; `lastCountedAt` updates only after successful `POSTED`; concurrent
starts cannot create duplicate sessions.

**2C.3C:** dashboard scope enforced; due/overdue filters accurate; assignment respects permissions;
coverage metrics reconcile with task history; accuracy metric matches count variances (incl. the
zero-expected rule); historical completed tasks remain readable after product archival.

## Definition of done (2C.3)

> The system can classify inventory by counting priority, generate due cycle-count work deterministically,
> execute that work through the existing lot-aware Physical Count engine, and show coverage and accuracy —
> **without introducing a second source of inventory truth.**

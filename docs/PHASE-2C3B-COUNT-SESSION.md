# Phase 2C.3B — Count Session Integration

**Status: ✅ Complete.** Second slice of 2C.3 ([ADR 0009](adr/0009-cycle-counting.md)). A cycle-count task now
**executes end-to-end through the existing lot-aware Physical Count engine** — no second counting engine, no
duplicate variance logic.

## One task = one authoritative StockCount
`StockCount.cycleCountTaskId` (**unique**) links a task to the single `StockCount(type=CYCLE)` that executes
it. `CycleCountTask.physicalCountId` is the back-reference. The uniqueness guarantees at most one count can
attach to a task.

## Lifecycle
```
CycleCountTask  → start → StockCount(type=CYCLE)  → count → submit → approve → post
   IN_PROGRESS                (existing engine, snapshot/variance/ledger unchanged)      ↓ POSTED
   COMPLETED  ←──────────────────────────────────────────────────────────────── task completed
```
- **`POST /cycle-count/tasks/:id/start`** snapshots exactly the task's scope into a new CYCLE count and moves
  the task to **IN_PROGRESS**. Batch scope → warehouse/product/variant/**lot**; non-lot scope →
  warehouse/product/variant (NIL lot). Start is **idempotent/replay-safe** (an in-flight task returns its
  existing count) and **concurrency-safe** (the unique `cycleCountTaskId` makes a second create lose with
  P2002 and adopt the winner's count — never two counts).
- The count is driven through the **unchanged** `/counts/:id/entries|submit|approve|post` endpoints.
- **COMPLETED happens only after the count POSTS** — the completion hook lives in `CountsService.post`, after
  the variance has gone through the ledger. `submit` and `approve` never complete the task; a **failed post
  leaves the task IN_PROGRESS**.
- `lastCountedAt` is derived from completed-task history (coverage read model) — never from start, submit, or
  approval.

## Cancellation (coordinated, never orphaned)
`POST /cycle-count/tasks/:id/cancel` cancels the task **and** its unposted count together, so an active count
is never left orphaned. A task whose count already posted is COMPLETED and cannot be cancelled; a cancelled
task cannot start; a completed task cannot restart.

## Recount (new work, never a mutation)
`POST /cycle-count/tasks/:id/recount` (completed tasks only) creates a **new** task
(`source = RECOUNT`, `supersedesTaskId = original`) and starts it, producing a **separate** StockCount. The
original task and its count history are never reopened or overwritten (ADR 0009 §8). The prior count's POSTED
result is the ledger truth the recount re-snapshots against.

## RBAC
`start` is execution → gated by `inventory.count` (staff can execute assigned counts). `cancel` and `recount`
are managerial → `cycle_count.schedule`.

## Tests
- **e2e** (`cycle-count-session.e2e-spec.ts`, 11): one-count-per-start + replay reuse + concurrent-start
  single-count; scope-exact snapshot (lot vs product-level); submit/approve don't complete, POSTED does;
  failed post leaves IN_PROGRESS; cancelled-can't-start / completed-can't-restart; coordinated cancel also
  cancels the count; recount = new superseding task + separate count, original untouched; org scope; and the
  **integration scenario** (generate LOT-A → assign → start → count 37 of 40 → submit → approve → post → task
  COMPLETED; variance −3 through the existing ledger path; coverage `onHand` 37, `lastCountedAt` set, next due
  = +30d for class A; a fresh recount snapshot reads 37, proving the ledger is the only inventory truth).
  **34 unit + 257 e2e green.**

## Definition of done (2C.3B)
> A cycle-count task can be executed end-to-end through the existing lot-aware Stock Count engine, with a
> strict one-task/one-count relationship, completion only after posted reconciliation, and recounts preserved
> as new historical work rather than mutations of prior counts. — met.

## Next
**2C.3C — UX + Metrics:** cycle-count dashboard, due/overdue worklists, assignment UI, ABC filters, links into
count execution, and coverage/accuracy metrics (read-model, reconciling to task/count history).

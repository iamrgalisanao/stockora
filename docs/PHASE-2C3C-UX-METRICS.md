# Phase 2C.3C — UX + Metrics

**Status: ✅ Complete.** Final slice of 2C.3 ([ADR 0009](adr/0009-cycle-counting.md)). Strictly **read-model +
orchestration** over the task/count engine from 2C.3A/B — no new inventory semantics. **This completes
2C.3 Cycle Counting.**

## Dashboard metrics (one backend service, UI never recomputes)
`GET /cycle-count/metrics?warehouseId=&from=&to=` returns, warehouse-scoped over a period (default trailing
30 days): **Due today, Overdue, Assigned to me, In progress, Completed this period, On-time coverage %,
Count accuracy %, Absolute variance qty, Variance value**. Formulas are centralized in `CycleCountService`:

- **On-time coverage** = completed-on-time ÷ SCHEDULED tasks due in period. **Ad-hoc and recount excluded**
  (ADR 0009 §10).
- **Accuracy** = `1 − Σ|variance| / Σ expected`, bounded 0–100 %; the zero-expected rule (all-zero expected
  ⇒ 100 % if nothing counted, else 0 %) avoids divide-by-zero — `CycleCountService.accuracyPct` is the one
  implementation.
- Accuracy/variance are computed from **POSTED cycle counts only** — metrics move only after posted
  reconciliation. `varianceValue` is gated by `cost.view`.

## Worklist
`GET /cycle-count/tasks` with filters: **status, overdue, ABC class, source, assignee, warehouse, product/
SKU/lot search, due-date range**. Web `/cycle-count/tasks` adds the views **Due / Overdue / My counts / In
progress / Completed**. Derived **OVERDUE timing** is shown as a badge kept visually distinct from the
persisted status (never a persisted lifecycle value).

## Task detail + execution (no second count form)
`/cycle-count/tasks/[id]` shows **scope, ABC class, due date, assignee, source, policy snapshot, linked
stock count**, and **why** the item is being counted (e.g. *"ABC C · scheduled every 180 days · Due …"*) —
context, not an arbitrary task. **Start Count** / **Continue Count** routes into the **existing Physical
Count screen** (`/counts/[id]`); a completed task links to its posted count and offers **Recount**. Lot-aware
tasks show the lot with a link to Lot Detail; non-lot tasks show no lot UI at all.

## Assignment
Assign-to-me and an assign-to-member picker (best-effort member list; falls back to assign-to-me when the
viewer lacks `user.manage`). RBAC stays authoritative (`cycle_count.assign`); reassignment is audited; a
disabled member cannot be assigned.

## Tests
- **e2e** (`cycle-count-metrics.e2e-spec.ts`, 8): metrics org/warehouse scope + business-date due/overdue;
  ABC/assignee/my-counts worklist filters; assignment permission + disabled-member rejection + audited
  reassignment; on-time coverage excludes ad-hoc and matches task history; accuracy matches posted variance,
  variance qty reconciles, metrics move only after POSTED; zero-expected 0/nonzero rule; `cost.view` gating
  of variance value; completed task stays historically readable after product archival. **34 unit + 265 e2e
  green.** Browser-verified: dashboard tiles, worklist (ABC/lot/timing), task detail (why-context, policy
  snapshot, lot link), and **Start count → existing Physical Count screen** (scope-exact snapshot).

## Definition of done (2C.3C / 2C.3)
> An authorized warehouse user can see what must be counted, why and when it is due, receive or manage
> assignments, execute the work through the existing Physical Count flow, and measure schedule coverage and
> inventory-count accuracy from posted count history. — met. **2C.3 Cycle Counting is complete.**

## Next
**2C.4 — Inventory-position model** (the final Phase 2C item): a unified on-hand / reserved / in-transit
position view.

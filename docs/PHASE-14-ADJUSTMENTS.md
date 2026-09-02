# Phase 14 — Stock Adjustments (approval + high-value second approver, backend + UI)

**Status: ✅ Complete and verified (backend + UI).** Roadmap step 14, fourth vertical slice.
Flow: `DRAFT → SUBMITTED → APPROVED → POSTED`, with an extra `PENDING_SECOND_APPROVAL` step when
the adjustment's cost impact exceeds the org's high-value threshold.

## Product decisions (confirmed by user)
- **Second approver above a value threshold** — computed cost impact `Σ |qty| × cost` (IN at the
  provided unit cost, OUT at current WAC). Above `organization.settings.highValueAdjustmentThreshold`
  (default **10000**, editable via `PATCH /organizations/current`), a **second, distinct** approver is
  required (`secondApprovedById ≠ firstApprovedById`).
- **Configurable reasons table** — per-org `adjustment_reasons`, managed by admins; 10 sensible
  defaults are seeded at organization registration and are fully editable.

## Backend
- Entities: `adjustment_reasons`, `stock_adjustments`, `stock_adjustment_items`
  (`AdjustmentStatus`, `AdjustmentDirection` IN/OUT per line; `ADJ-NNNNNN`).
- `AdjustmentsService`: create/update/submit/approve/**secondApprove**/reject/post/cancel.
  `submit` computes `estimatedValue` + `requiresSecondApproval`. `post` writes `ADJUSTMENT_IN` and/or
  `ADJUSTMENT_OUT` to the ledger (mixed directions supported; idempotent per direction).
- `AdjustmentReasonsService`: list/create/update.
- Endpoints under `/api/adjustments` and `/api/adjustment-reasons`. Create/submit/post/cancel gated by
  `inventory.adjust`; approve/second-approve/reject by `inventory.approve`; reason management by
  `settings.manage`. Warehouse scope enforced.

## Web UI
- Pages: **Adjustments** (list, with a "2-approver" flag), **Adjustments → New** (warehouse, reason,
  per-line direction/qty/unit-cost), **Adjustments → [id]** (status-aware actions incl. Second
  approval), and **Administration → Adjustment Reasons** (manage the configurable list). New nav
  groups: Control, Administration.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **48 e2e** ✅ (4 new adjustment
  tests: low-value single approval with mixed IN/OUT posting, high-value distinct second approver,
  per-org threshold change, reasons management incl. duplicate-code conflict).
- **Live browser walkthrough:** ADJ-000001 (Physical Count, IN ×5 @ 100) → Submit (est. value 500) →
  Approve → Post; MAIN on-hand 20 → 25 and WAC recomputed 2950 → 2380.

## Migration
`stock_adjustments` (adjustment_reasons + stock_adjustments + stock_adjustment_items).

## Next
**Physical Count** (snapshot → count → variance → adjustment, reusing the adjustment engine), then the
**reorder engine**, **dashboard**, and **reports**.

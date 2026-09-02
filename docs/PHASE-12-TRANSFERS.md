# Phase 12 — Warehouse Transfers (approval + in-transit, backend + UI)

**Status: ✅ Complete and verified (backend + UI).** Roadmap step 12, third vertical slice.
Flow: `DRAFT → FOR_APPROVAL → APPROVED → IN_TRANSIT → RECEIVED` (approval enforced; in-transit held
at the source between dispatch and receive).

## Backend
- Entities: `stock_transfers` + `stock_transfer_items` (`TransferStatus`; `TR-NNNNNN`). Items track
  `quantity`, `qtyDispatched`, `qtyReceived`, and `dispatchUnitCost` (source WAC captured at dispatch).
- `TransfersService` transitions (status-guarded):
  - `create` (source ≠ dest; caller needs access to both ends) · `update` (draft) · `submit`
  - `approve` / `reject` — `inventory.approve`
  - `dispatch` (→ IN_TRANSIT): posts `TRANSFER_OUT` at the source (on_hand↓, in_transit↑) and
    captures the carried WAC per line — needs source access, `inventory.transfer`
  - `receive` (→ RECEIVED): posts `TRANSFER_IN` (source in_transit↓, dest on_hand↑) at the carried
    WAC — needs dest access, `inventory.transfer`
  - `cancel` (before dispatch)
- Both dispatch and receive are idempotent (stable keys). Warehouse scope: a user sees/acts on
  transfers where the source **or** destination is in scope.

## Web UI
- Pages: **Transfers** (list), **Transfers → New** (source/dest + lines), **Transfers → [id]**
  (status-aware, permission-gated actions: Submit / Approve / Reject / Dispatch / Receive / Cancel,
  with a Quantity / Dispatched / Received line table). Nav link added.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **44 e2e** ✅ (4 new transfer
  tests: same-warehouse rejected, full lifecycle with in-transit at source only, duty separation,
  idempotent re-dispatch/re-receive).
- **Live browser walkthrough:** created TR-000001 (MAIN→BRANCH, SSD ×10) → Submit → Approve →
  Dispatch (MAIN on-hand 30→20, in-transit 10, BRANCH 0) → Receive (MAIN 20, BRANCH 10, in-transit 0,
  WAC 2950 carried to BRANCH).

## Note on browser testing
The in-app browser pane rendered at a small emulated viewport this session, so screenshot/coordinate
clicks were unreliable; the walkthrough was driven via DOM-level `form_input` + element-ref clicks,
which are unaffected. No product-code issues — purely a test-harness quirk.

## Migration
`stock_transfers` (stock_transfers + stock_transfer_items).

## Next
Remaining control documents as slices: **Stock Adjustments** (with high-value second-approver per the
approval decision) and **Physical Count** (snapshot → variance → adjustment). Then reorder + dashboards + reports.

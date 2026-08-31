# Phase 11 — Stock Releases (approval workflow, backend + UI)

**Status: ✅ Complete and verified (backend + UI).** Roadmap step 11, second vertical slice.
Implements the product decision that **releases require approval**: enforced
`DRAFT → FOR_APPROVAL → APPROVED → RELEASED`.

## Backend
- Entities: `stock_releases` + `stock_release_items` (`ReleaseStatus` state machine, `RL-NNNNNN` numbers).
- **New permission `inventory.approve`** — a generic document-approval capability distinct from
  creating a release, so a creator cannot approve their own. Added to Administrator, Inventory
  Manager, Warehouse Manager, Approver, and Finance bundles; **NOT** Warehouse Staff. Seed backfills
  it onto existing orgs' system roles.
- `ReleasesService` transitions (each guarded by the current status):
  - `create` (DRAFT, requestedQty) · `update` (draft only) · `submit` (→ FOR_APPROVAL)
  - `approve` (→ APPROVED, sets approvedQty; rejects approving more than requested) — `inventory.approve`
  - `reject` (→ REJECTED) — `inventory.approve`
  - `post` (→ RELEASED): posts `SALES_RELEASE` via the ledger (idempotent), only from APPROVED — `inventory.release`
  - `cancel` (before RELEASED)
- Endpoints under `/api/releases`; warehouse-scope enforced.

## Web UI (Next.js)
- Pages: **Releases** (list), **Releases → New** (create form), **Releases → [id]** (detail with
  status-aware, permission-gated action buttons: Submit / Approve / Reject / Release to stock / Cancel).
- Nav link added under Warehouse.

## Contracts packaging fix (dual ESM/CJS)
`@iw/contracts` now builds **both** CommonJS (`dist/cjs`, for the NestJS API via `require`) and ESM
(`dist/esm`, for Next via `import`), selected by the package `exports` map. This resolves a Next dev
error where webpack's react-refresh injected `import.meta` into the CommonJS-only module. Runtime enum
values can now be imported from `@iw/contracts` in the web app (single source of truth). Jest maps the
package to its TS source, so tests are unaffected.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **40 e2e** ✅ (4 new release
  tests: enforced approval order, duty separation staff-can't-approve, over-approval rejected, idempotent re-post).
- **Live browser walkthrough:** created RL-000001 (Samsung SSD ×20) → Submit → Approve → Release to
  stock → status RELEASED; Stock Overview on-hand dropped 50 → 30, value 147,500 → 88,500.

## Migration
`stock_releases` (stock_releases + stock_release_items).

## Next
**Transfers** slice — approval (`inventory.approve`) plus the in-transit lifecycle
(dispatch → in transit → receive), each with its UI screen.

# Phase 2A.1A — Catalog Foundations (backend + UI)

**Status: ✅ Complete.** First slice of Phase 2A (operational readiness). Establishes the master-data
lifecycle + reusable management UI on the catalog entities.

## Lifecycle model (ADR 0003)
- New `EntityStatus` enum **ACTIVE / INACTIVE / ARCHIVED** replaces `isActive` on categories, brands,
  and units (data-preserving migration: `isActive=true→ACTIVE`, `false→INACTIVE`, then drop the column).
  Metadata: `statusChangedAt`, `archivedAt`, `archivedById`.
- Transitions enforced (`common/status-lifecycle.ts`): ACTIVE⇄INACTIVE, ACTIVE/INACTIVE→ARCHIVED;
  **ARCHIVED→ACTIVE is blocked** via the normal endpoint (privileged restore is a later, separate op).

## Backend
- Categories / Brands / Units services now: search (`?q=`) + status filter (`?status=`), create/update,
  and a `POST /:id/status` transition endpoint — every mutation writes an **audit** record
  (`brand.created`, `unit.status_changed`, `category.updated`, …).
- **Generic audit query:** `GET /api/audit?entityType=&entityId=&action=&limit=` (`audit.view`) — powers
  the per-entity history drawer now and the org-wide explorer later (2A.1F).
- Contracts updated: `CategoryResponse` / `BrandResponse` / `UnitResponse` expose `status`; new
  `EntityStatus` and `AuditEntryResponse` contracts.

## Web UI (Administration nav)
- Reusable components (`components/master-data.tsx`): **`MasterDataManager`** (search + status filter +
  table + create/edit form + lifecycle action buttons + audit drawer), `StatusBadge`, `AuditDrawer` —
  the pattern all future master-data screens reuse.
- Pages: **Categories** (with parent), **Brands**, **Units** — full List → Search/Filter → Create/Edit →
  Deactivate/Activate/Archive → History, no seeds/API needed.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **59 e2e** ✅ (3 new catalog-
  lifecycle tests: brand ACTIVE→INACTIVE→ARCHIVED with ARCHIVED→ACTIVE blocked, status filter, entity
  audit history, name search; units + categories lifecycle).
- Live browser: Brands admin renders with status filter + row actions; audit drawer opens; create form opens.

## Next
**2A.1B — Products + variants:** application commands, `ProductBarcode` (multi-barcode), `BarcodeResolver`
v1, product archive rule (block while on-hand > 0). Then 2A.1C inventory policies, 2A.1D suppliers,
2A.1E warehouses/locations, 2A.1F audit explorer.

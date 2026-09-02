# Phase 2A.3B — Export (backend + UI)

**Status: ✅ Complete.** Second half of 2A.3. Read-only CSV export whose formats mirror the import
templates, so a file can round-trip.

## Backend
- **`ExportService`** produces CSV for **products** (+ variants + barcodes), **suppliers** (+ links),
  and **stock balances**. Org-isolated; stock balances warehouse-scoped; `cost` columns gated by
  `cost.view`.
- **Formats double as import templates** — the products/suppliers exports use the exact import columns,
  and stock balances use the opening-inventory columns (so an export re-imports as an opening template).
- **CSV-injection neutralized**: any cell starting with `= + - @` (or control chars) is apostrophe-
  prefixed before quoting, so spreadsheets never execute exported content.
- **Header-only templates**: `GET /api/exports/templates/{products|suppliers|opening-inventory}`.
- Endpoints: `GET /api/exports/products` and `/suppliers` (`export.catalog`),
  `GET /api/exports/stock-balances` (`export.inventory`), templates (`inventory.view`). Each streams
  `text/csv` with an attachment disposition.

## Web UI
- **Import & Export** page gains an **Export** card: one-click Products / Suppliers / Stock balances,
  plus blank template downloads. The client fetches with the bearer token (a plain link can't) and
  saves via a Blob URL.

## Tests
- **e2e** (`export.e2e-spec.ts`, 4): export requires the permission (a viewer is denied); exports only
  the caller's organization and neutralizes a `=cmd()` cell; an exported products file **round-trips**
  cleanly into another org (preview all-valid → commit → catalog + barcode present); header-only
  templates serve, unknown template → 400. **29 unit + 123 e2e green.**

## Deferred (as scoped)
XLSX / multi-sheet onboarding packs, scheduled exports, and additional export domains are out of scope
— CSV is enough for the first slice.

---
**2A.3 complete.** Next: **2A.4 — Hardening**, the final operational-readiness gate before 2B
(reservations & returns).

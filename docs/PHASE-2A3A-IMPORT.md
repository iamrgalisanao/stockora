# Phase 2A.3A — Bulk Import (backend + UI)

**Status: ✅ Complete.** First half of 2A.3. Safe bulk onboarding of the highest-value domains, as a
**staged preview → commit** workflow. Parsing and validation NEVER write to domain tables; commit
replays only the already-validated staged rows through domain rules and the ledger — no bypass.

## Flow
`Upload → Parse → Validate → Preview → (fix errors) → Commit → result`. A persisted `ImportJob` +
`ImportRow[]` hold the validated rows; commit reads that staging, never a re-parse of raw input.

## Domains (v1)
- **Products + variants + barcodes** — one row per base product; a row with `parent_sku` is a variant;
  a `barcode` column assigns identity.
- **Suppliers + supplier-product links** — a row without `product_sku` defines a supplier; with it,
  links an existing product.
- **Opening inventory** — the strictest; **posts through the ledger** (`InventoryPostingService`),
  never a direct balance write.

Categories, brands, and units **must already exist** — no silent auto-create of typo'd master data.

## Validation (pure read; per the spec)
- **Products:** duplicate SKU in-file / vs DB, duplicate barcode in-file / vs DB, unknown
  category/brand/unit, invalid status, invalid batch/serial flags, variant parent resolution.
- **Suppliers:** duplicate supplier code, unknown supplier/product for links, invalid cost/MOQ,
  duplicate link in-file / vs DB.
- **Opening inventory:** warehouse must exist + be ACTIVE + in scope; location must belong to it and be
  ACTIVE; SKU (product or variant) ACTIVE; quantity > 0 (no negative/zero); unit_cost ≥ 0; batch/serial
  items rejected (not yet supported via import).

## Commit (safe, auditable)
- **All-or-nothing per job.** Invalid rows block commit. Products/suppliers commit inside one
  `$transaction` (a failure mid-batch rolls back — no partial mutation). Opening inventory posts per
  warehouse through the ledger with a stable idempotency key `import:<job>:<warehouse>`.
- **Idempotent status machine** (`PENDING/VALIDATED/COMMITTING/COMPLETED/FAILED/CANCELLED`): an
  optimistic `VALIDATED → COMMITTING` flip means a racing or repeat commit is rejected cleanly;
  `COMPLETED → commit` is refused.
- **Auditability:** every record the commit emits carries `source = IMPORT` and the **job's shared
  `correlationId`**, so the Audit Explorer shows an import as one grouped operation
  (`product.created`, `barcode.assigned`, `opening_inventory.posted`, …).

## Security & RBAC
- Distinct permissions: `import.products`, `import.suppliers`, `import.opening_inventory` — the last is
  admin-restricted (inventory-manager gets catalog/supplier import but **not** opening inventory).
- Org-isolated; warehouse scope enforced on opening inventory. File protections: 2 MB / 5,000-row caps,
  UTF-8 (BOM-stripped), a text-only CSV parser (never evaluates spreadsheet formulas).

## Endpoints
`POST /api/imports/{products|suppliers|opening-inventory}/preview` (each behind its permission),
`GET /api/imports/:jobId`, `POST /api/imports/:jobId/commit` (type permission enforced per job).

## Web UI
- **Import** (Administration → Import): pick a type, load a template or upload/paste CSV, **Preview**
  (status + valid/warning/invalid counts + a per-row table with the exact errors), then **Commit** —
  enabled only when there are zero invalid rows.

## Tests
- **e2e** (`import.e2e-spec.ts`, 7): preview writes nothing; duplicate SKU/barcode in-file and unknown
  master refs flagged; invalid rows block commit; clean commit runs once (double-commit rejected) with
  IMPORT audit + one shared correlation id; opening inventory posts through the ledger and isn't
  double-counted; org isolation + warehouse scope; a failed commit leaves no partial mutation (atomic).
  **29 unit + 119 e2e green.**

## Next
**2A.3B — Export** (products, suppliers, stock balances as CSV; formats double as import templates,
with CSV-injection neutralization).

# Phase 2A.2A — Global Search (backend + UI)

**Status: ✅ Complete.** First half of 2A.2. One search entry point across the catalog and warehouse.
Deliberately scoped to **find-and-identify** — search identifies and links, it never carries stock
availability (that stays a separate inventory query, preserving the resolver boundary).

## Backend — a search orchestrator, not one giant query
`GlobalSearchService` fans a query out to per-domain providers, each owning its own searchable fields
and scope rules; the aggregator normalizes and ranks the hits. No cross-domain SQL, so domain
ownership stays clean.

```
GlobalSearchService
  ├─ CatalogSearchProvider    products, variants, barcodes
  ├─ SupplierSearchProvider   suppliers
  ├─ WarehouseSearchProvider  warehouses, locations   (warehouse-scoped)
  └─ DocumentSearchProvider   receipts/releases/transfers/adjustments/counts (warehouse-scoped)
```

- **Result shape** (`SearchResult`): `type, entityId, title, subtitle, code, status, warehouseId?, route, rank`.
  Types: PRODUCT, PRODUCT_VARIANT, SUPPLIER, WAREHOUSE, LOCATION, GOODS_RECEIPT, RELEASE, TRANSFER,
  ADJUSTMENT, PHYSICAL_COUNT.
- **Deterministic v1 ranking** (no Elasticsearch/fuzzy infra): `0` exact code/barcode → `1` code prefix
  → `2` name contains → `3` reference/description contains. Results dedupe by `(type, entityId)` keeping
  the best rank, then sort by rank then title.
- **Scope** (reusing the proven rules): always organization-isolated; **warehouse-bound** entities
  (warehouses, locations, documents) are restricted to the user's warehouse scope, while the shared
  catalog (products/suppliers) is org-wide.
- **Lifecycle:** master-data hits are ACTIVE-only (inactive/archived excluded); **documents are
  searchable in any status**, so completed/cancelled history stays findable.
- **Endpoint:** `GET /api/search?q=&limit=` → `SearchResult[]` (requires `inventory.view`).

## Web UI
- **Search** (Overview → Search): one focused input; debounced queries; a ranked results list with a
  type chip, title, subtitle + code, and status badge; ↑/↓ to move and Enter to open; each row links to
  the entity's route.

## Tests
- **e2e** (`global-search.e2e-spec.ts`, 6): exact SKU outranks name-contains; exact barcode resolves
  first; organization isolation; warehouse scope enforced for warehouse-bound entities (catalog stays
  org-wide); inactive/archived excluded; completed/historical documents still searchable.

## Next
**2A.2B — Scanner UX**: camera / hardware-scanner / manual input on top of the existing
`BarcodeResolver`, with a compact identity panel and a diagnostic mode for failed scans.

# Phase 10 — Receiving (first end-to-end vertical slice)

**Status: ✅ Complete and verified (backend + UI).** Roadmap step 10. This is the first "thin slice
both" delivery: a document workflow *and* its web screen, wired to the ledger.

## Backend
- Entities: `goods_receipts` + `goods_receipt_items` (`ReceiptStatus`: DRAFT → RECEIVING →
  FOR_INSPECTION → PARTIALLY_RECEIVED / COMPLETED / CANCELLED).
- `ReceivingService`: create draft, edit draft, list (scope-filtered), get, **post**, cancel.
  Posting calls `InventoryPostingService.receipt()` → `PURCHASE_RECEIPT` movements with a stable
  idempotency key (`goods_receipt:<id>`), then closes the receipt COMPLETED or PARTIALLY_RECEIVED.
- Endpoints under `/api/receiving`; reads `inventory.view`, writes `inventory.receive`;
  warehouse-scope enforced. Receipt numbers `GR-000001` from a per-org sequence.
- Receiving needs no approval (per the product decision, approvals apply to releases/transfers).

## Web UI (Next.js)
- **Auth-guarded app shell** (`app/(app)/layout.tsx`): sidebar nav (Overview / Catalog / Warehouse),
  sign-out, redirect-to-login when unauthenticated.
- Pages: **Dashboard** (KPIs: SKUs, warehouses, on-hand, valuation), **Stock Overview** (balances
  table), **Products** (catalog table), **Receiving** (list), **Receiving → New** (interactive form:
  warehouse/supplier/lines → "Receive & post to stock" or "Save as draft").
- API client extended (`lib/api.ts`) with products, warehouses, suppliers, balances, receiving.

## Verified
- Build (api + web) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **36 e2e** ✅ (4 new receiving tests:
  create+post raises stock, idempotent re-post, partial receipt, edit-after-post rejected).
- **Live browser walkthrough:** logged in → New receipt (Samsung 1TB SSD ×50 @ 2950 into MAIN) →
  "Receive & post" → Stock Overview shows on-hand 50, avg cost 2950, value 147,500; receipt
  GR-000001 listed as COMPLETED.

## Migration
`goods_receiving` (goods_receipts + goods_receipt_items).

## Next
Continue the document layer as vertical slices: **Releases** (with Draft → Approve → Post, per the
approval decision) and **Transfers** (approval + the in-transit lifecycle), each with its UI screen.

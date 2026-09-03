# Supplier Performance — Metric Definitions (2D.4)

A read-model analytics capability over existing operational records. **No metric is invented**: where a
required input is not captured, the metric is excluded from the denominator and its **coverage** is surfaced
instead of a misleading number.

## Data source & scope

- **Posted operational records only.** A goods receipt contributes only when `postedAt IS NOT NULL`
  (status `COMPLETED` or `PARTIALLY_RECEIVED`). `DRAFT`, `RECEIVING`, `FOR_INSPECTION`, and `CANCELLED`
  receipts never contaminate performance.
- Attribution is by `GoodsReceipt.supplierId` (receipts without a supplier are excluded).
- **Period** filters on the receiving business date (`receivingDate`) within `[periodStart, periodEnd]`.
- Optional **product** and **warehouse** filters; **org isolation** and the caller's **warehouse scope** are
  always enforced.

## Enabling fields (optional capture, added in 2D.4A)

The receipt gained two nullable dates so lead-time and on-time can be computed *where recorded* — never
guessed:

- `GoodsReceipt.orderDate` — when the order/request was placed.
- `GoodsReceipt.expectedDeliveryDate` — the date the supplier promised.

Receipts that omit them are excluded from those metrics' denominators; adoption shows up as coverage.

## The four core metrics + quality

### 1. Fill rate
```
fillRatePct = Σ receivedQty / Σ expectedQty × 100     (per supplier, over lines where expectedQty > 0)
```
Lines with `expectedQty = 0` (blind receipts) are excluded from the denominator. Over-delivery can exceed
100%; the **score** caps at 100. **Coverage** = lines with `expectedQty > 0` ÷ all lines.

### 2. On-time delivery
```
onTimeDeliveryPct = count(receivingDate ≤ expectedDeliveryDate) / count(receipts WITH expectedDeliveryDate) × 100
```
Receipts **without** an expected delivery date are excluded from the denominator — never silently counted as
early or late. **Coverage** = receipts with `expectedDeliveryDate` ÷ all receipts.

### 3. Lead time
```
averageLeadTimeDays = avg(receivingDate − orderDate)   (over receipts where orderDate is set)
```
Labelled **"Order-to-receipt lead time (from recorded order date)"** — there is no purchase-order document in
the system, so this uses the recorded `orderDate`, and only where present. **Coverage** = receipts with
`orderDate` ÷ all receipts. The quoted benchmark is `Supplier.leadTimeDays` (or `SupplierProduct.leadTimeDays`).

### 4. Price performance
```
averageUnitCost = Σ (receivedQty × unitCost) / Σ receivedQty                (quantity-weighted actual)
referenceCost   = SupplierProduct.cost for (supplier, product)              (commercial benchmark, not WAC)
priceVariancePct = (averageUnitCost − referenceCost) / referenceCost × 100  (per product, weighted up)
```
Compared against the supplier's own **quoted/reference cost** (`SupplierProduct.cost`), **not** the inventory
WAC (WAC is a valuation concept, not a commercial benchmark). Lines whose (supplier, product) has no
reference cost (`> 0`) are excluded. Positive variance = paid above quote. **Coverage** = received quantity
with a reference cost ÷ all received quantity.

### 5. Quality — return/reject rate
```
returnRatePct = Σ rejectedQty / Σ (receivedQty + rejectedQty) × 100
```
Uses `GoodsReceiptItem.rejectedQty` — the quantity rejected/returned to the supplier **at receipt**, which is
the only supplier-**attributable** return quantity in the current model (reverse-logistics `InventoryReturn`
records carry no supplier link, so a supplier-attributed post-receipt return rate is deferred until returns
capture a supplier). Always available from posted receipts, so **coverage = 100%**.

## Overall performance score (transparent, deterministic)

Each metric maps to a 0–100 sub-score:

| Sub-score | Definition | Benchmark |
|---|---|---|
| Fill-rate | `clamp(fillRatePct, 0, 100)` | — |
| On-time | `onTimeDeliveryPct` | — |
| Lead-time | `clamp(100 × quotedLeadTime / averageLeadTimeDays, 0, 100)` | `Supplier.leadTimeDays > 0` |
| Price | `clamp(100 − priceVariancePct, 0, 100)` | `SupplierProduct.cost` |
| Quality | `clamp(100 − returnRatePct, 0, 100)` | — |

```
performanceScore = Σ (subScore × weight)  /  Σ (weight of AVAILABLE sub-scores)
```

Default weights (v1, org-configurable in 2D.4B): fill-rate **0.25**, on-time **0.20**, lead-time **0.20**,
price **0.20**, quality **0.15**.

- A metric with **no coverage** for a supplier (or no benchmark, for lead-time/price) is **dropped and the
  remaining weights renormalize** — a missing metric never silently becomes a zero sub-score.
- The score is fully explainable: the response returns every sub-score and the weights used, so "72/100" is
  always traceable to its components and back to the posted receipts. No AI/opaque scoring.

## Coverage reporting

Every response carries per-supplier and org-level coverage for on-time, lead-time, and price (e.g.
`On-time coverage: 68%`, `Price coverage: 82%`), so a sparse-input score is never mistaken for a precise one.

## Slices

- **2D.4A — Read model:** these definitions; the analytics service + `GET /analytics/suppliers`; period /
  product / warehouse filters; multi-supplier comparison; coverage; the transparent default-weighted score;
  a comparison table UI.
- **2D.4B — Scorecards + trends:** org-configurable weights; period-over-period trends; supplier/product
  breakdown; preferred-supplier comparison (same metric definitions).
- **2D.4C — UX:** supplier scorecard, comparison dashboard, charts/trends, drill-down to receipts/returns.

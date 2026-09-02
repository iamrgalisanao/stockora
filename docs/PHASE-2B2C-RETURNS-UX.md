# Phase 2B.2C — Returns UX + Visibility

**Status: ✅ Complete.** Final slice of 2B.2. Returns are now fully operable and traceable from the
application, and quarantined stock is visible and reconciled on Stock Overview. This **completes 2B.2
Returns + Disposition and Phase 2B.** Governed by [ADR 0006](adr/0006-returns-disposition.md) — no new
rules, presentation only.

## Screens
- **/returns** — list with filters: status, type, warehouse, free-text (return # / SKU), source
  reference, created-date range, and a **"Has quarantine"** toggle (returns still holding stock). Columns
  include Received and **Remaining quarantine**.
- **/returns/new** — create (type, warehouse, source reference, reason, notes, lines), with **Create &
  receive** or **Save as draft**.
- **/returns/[id]** — Summary · Lines · Disposition · History:
  - **Lines** show the physical split per line: Received / Restocked / Damaged / Ret. supplier / Disposed
    / **Remaining quarantine** (the API's `receivedQuantity − Σ dispositions`, never UI-maintained).
  - **Disposition drawer** (opens per line only when remaining > 0) — Outcome, Quantity, Reason, Notes,
    and a **client-generated idempotency key**, with the current remaining shown before submit. It offers
    only the outcomes the viewer is authorized for (RESTOCK/DAMAGED need `return.inspect`;
    RETURN_TO_SUPPLIER/DISPOSE need `return.dispose`), and the two destructive outcomes require a
    confirmation naming product, quantity, and outcome.
  - **History** renders the disposition timeline semantically ("20 received into quarantine → 8 restocked
    → 3 damaged → … → N remain in quarantine").
  - DRAFT returns show Receive / Cancel; received returns are read-only except for dispositions.
- **Stock Overview** — added a **Quarantined** drill-down beside Reserved (and a Damaged column). Clicking
  a `Quarantined` figure lists the composing return lines and asserts **Σ remaining = balance quarantined**
  (the same reconciliation the Reserved drill-down does).

## Backend added for the surface
- `GET /returns/quarantine-breakdown?productId&warehouseId[&variantId]` → the active return lines
  composing a balance's `quarantined` bucket (org- and warehouse-scoped).
- List filters extended: `sourceReference`, `from`/`to` (created), `hasQuarantine` (⟺ status ∈
  {RECEIVED, PARTIALLY_DISPOSED}).

## Fix found during browser verification
`.drawer` had no `z-index` while `.drawer-backdrop` was `z-index:50`, so the backdrop painted over the
drawer and swallowed every click — the disposition drawer was unusable. Gave `.drawer` `z-index:51`.

## Tests
- **e2e** (`return-visibility.e2e-spec.ts`, 7): quarantine drill-down sums to `StockBalance.quarantined`;
  reflects remaining after partial disposition and excludes completed returns; org-scoped; `hasQuarantine`
  filter; type + source-reference filters; disposition history matches the immutable records; completed
  return readable after product archival. Browser-verified: list + filters, detail breakdown, live
  disposition update, destructive-outcome guards, and the quarantine drill-down reconciliation.
  **34 unit + 188 e2e green.**

## Definition of done
> An authorized operator can create and receive returns, inspect quarantined quantities, execute permitted
> dispositions, and trace the resulting stock state from both the return document and Stock Overview, with
> quarantine totals reconciling to the ledger-backed balance. — met.

## Next
**Phase 2C — Traceability**, beginning with **Batch / Lot Tracking** (before Expiry / FEFO).

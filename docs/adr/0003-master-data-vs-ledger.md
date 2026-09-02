# ADR 0003 — Master data describes; the ledger records

**Status:** Accepted · **Date:** 2026-09-02

> **Master data describes what *may* participate in inventory operations; the ledger records what
> *actually* happened. Master-data lifecycle changes must never alter historical inventory transactions.**

Consequences:
- Renaming a SKU, changing a product's unit, deactivating a supplier, or archiving a warehouse
  **never** rewrites, reprices, or deletes posted movements. History is immutable (ADR 0001 #1).
- Master data uses a **3-state lifecycle** `status` (see below); records referenced by history are
  **archived/deactivated, never physically deleted**.
- Reports over history remain valid even after the referenced master data is archived.

## Lifecycle status model (replaces `isActive` on master entities)
`EntityStatus`: **ACTIVE** (operational, appears in selectors, usable in new transactions) ·
**INACTIVE** (temporarily hidden from selectors, reactivatable, history intact) · **ARCHIVED** (retired,
hidden from operational workflows, history valid, not reactivatable via normal UI).

- `status` is the single authoritative lifecycle field. Do **not** keep `isActive` alongside it.
  Metadata only: `statusChangedAt`, `archivedAt?`, `archivedById?`.
- Migration: `isActive=true → ACTIVE`, `isActive=false → INACTIVE`, then drop `isActive` (per entity as
  its management UI is built).
- Transitions: `ACTIVE ⇄ INACTIVE`, `ACTIVE/INACTIVE → ARCHIVED`. `ARCHIVED → ACTIVE` is a **privileged,
  audited restore**, not a normal edit.
- **Product archive rule (Phase 2):** allow INACTIVE with stock/history; **block ARCHIVE while on-hand > 0**
  and while referenced by open reservations/receipts/releases/transfers. Operational eligibility ≠ inventory existence.

## Application-command shape (no formal bus)
Master-data mutations are expressed as identifiable, testable business actions — `CreateProduct`,
`UpdateProduct`, `ChangeProductStatus`, `AssignBarcode`, `AddVariant`, `UpdateInventoryPolicy` — not raw
ORM saves. Fits the incremental command/query separation (ADR 0002).

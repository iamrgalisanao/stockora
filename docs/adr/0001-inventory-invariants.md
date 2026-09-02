# ADR 0001 — Inventory Invariants (non-negotiable)

**Status:** Accepted · **Date:** 2026-09-02

These rules are the product's core guarantees. They must not be weakened for convenience; any change
requires a new ADR that supersedes this one. New features are designed *around* them.

| # | Invariant | Enforcement today | Notes |
|---|---|---|---|
| 1 | Ledger entries are **immutable** (no UPDATE/DELETE after post) | ✅ append-only `inventory_movements` | corrections = reversal + replacement |
| 2 | **Every** inventory change creates a ledger movement | ✅ all posting via `InventoryPostingService` | no direct balance writes as the primary mechanism |
| 3 | Balances are **reconstructable** from the ledger | ✅ `reconcile()` sums deltas == projection | verified by e2e |
| 4 | A transaction **cannot drive available negative** unless an explicit policy allows it | ✅ negative guard + `override.negative` perm | override is audited |
| 5 | A serial exists in **exactly one active physical position** | ⏳ 2D (serial tracking) | DB constraint + app validation |
| 6 | Lot-tracked products **require a lot** on movements | ⏳ 2C (batch) | enforced when batch lands |
| 7 | Serialized products **require serial allocation** | ⏳ 2D | |
| 8 | Every posted document is **idempotent** | ✅ unique idempotency key per command | receiving/release/transfer/adjustment/count |
| 9 | Posting is **atomic** (all-or-nothing) | ✅ one DB transaction + row lock | |
| 10 | **Approval and posting are separate** actions | ✅ releases/transfers/adjustments | 2nd approver for high-value adjustments |
| 11 | Posted documents **cannot be edited** | ✅ status guards | |
| 12 | Corrections use **reversal / adjustment** transactions | ✅ `reverseMovement` | preserves history |

Additional standing rules adopted with Phase 2:
- **`available` is a calculated quantity**, never independently mutable: `available = on_hand − reserved − quarantined`.
- **Optional capabilities are config-driven** (batch, expiry, serial, reservations) per-org / per-product — the core engine never assumes one industry.

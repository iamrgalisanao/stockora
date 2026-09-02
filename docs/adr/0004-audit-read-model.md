# ADR 0004 — Audit as a read model (2A.1F)

## Status
Accepted — 2026-09-02.

## Context
Every master-data domain (2A.1A–E) now emits consistent audit facts
(`*.created/updated/status_changed/moved/linked`). We need one searchable investigation surface —
"who changed what, when, and where" — without turning audit into another domain that owns business
events.

## Decision
The audit subsystem is a **read model**. Domains keep emitting facts via `AuditService.record`; the
explorer only **searches, correlates, filters, and presents** them. It never owns or reinterprets
business state.

### Record shape (additions this slice)
- **`correlationId`** — groups every record produced by one logical operation. Established
  per-request via an `AsyncLocalStorage` context set by a global interceptor (after the auth guard),
  and overridable by a caller-supplied `X-Correlation-Id` header. Zero changes to the ~40 existing
  `record()` call sites; anything a request writes is automatically correlated. This is the foundation
  the future outbox/domain-events work builds on.
- **`source`** (`AuditSource`: USER / SYSTEM / IMPORT / API / INTEGRATION / SCHEDULED_JOB) —
  distinguishes the *initiator kind* from the human *actor*, reserved now so future non-human events
  aren't mislabeled as "a person clicked a button".
- **`actorDisplayName`** — a snapshot of who acted, captured at write time, so history still names the
  actor after a user is renamed or deleted. The UI never depends on a live `User` join for identity.
- **`entityDisplay`** — a snapshot of the entity's human identity (sku/code) for display without a join;
  archived entities still read meaningfully.
- **`warehouseId`** — an optional "where", so warehouse-scoped users can see their warehouses' history.

### Change metadata & sensitive data
Updates store a small `{ from, to }` diff (derived from the old/new snapshots), not entire before/after
entities. `AuditService` **redacts protected values at write time** (keys matching
pass/token/secret/credential/authorization/api-key/private-key/otp/pin → `[REDACTED]`) and **caps
oversized payloads** (>8 KB → `{ _truncated: true }`). An audit record describes *what changed*; it is
never a second uncontrolled copy of the database.

### Access & scope
Reads require the dedicated **`audit.view`** permission (now granted to org admins, admins, auditors,
and — newly — warehouse managers). Warehouse scoping is enforced: a scoped user sees **only records
tagged with a warehouse in their scope**, never org-wide (null-warehouse) records; a cross-scope
`warehouseId` filter returns empty rather than leaking. Entity-history drawers read the *same* records
through the same scoped query.

### Pagination & indexes
Server-side **cursor (keyset) pagination** from day one — `(createdAt desc, id desc)` with the cursor
encoding both, so paging is stable even when many rows share a timestamp. Investigation-shaped indexes:
`(org, createdAt)`, `(org, entityType, entityId, createdAt)`, `(org, userId, createdAt)`,
`(org, action, createdAt)`, `(org, warehouseId, createdAt)`, `(correlationId)`. Metadata is not indexed.

## Consequences
- The explorer is a thin, generic surface; adding a new audited domain needs no explorer changes.
- Semantic summaries ("Product SSD-1 archived", "Location BIN-03 moved") are computed at the
  presentation layer from the generic record — internal event names stay canonical but hidden.
- Not in scope (deliberately): exports, retention policies, SIEM integration, anomaly detection,
  notifications. Correlation currently comes from the request boundary; richer causation arrives with
  the outbox/domain-events work.

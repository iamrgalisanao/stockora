# Phase 2A.1F — Audit Explorer (backend + UI)

**Status: ✅ Complete.** Final 2A.1 slice. A single searchable investigation surface over the audit
facts every master-data domain already emits. The subsystem stays a **read model** — domains emit;
the explorer only searches, correlates, filters, and presents. Design per
[ADR 0004](adr/0004-audit-read-model.md).

## Backend
- **Enriched `audit_logs`** (additive migration): `correlationId`, `source` (`AuditSource`),
  `actorDisplayName` + `entityDisplay` snapshots, and `warehouseId`; plus investigation-shaped indexes
  (org+time, org+entity+time, org+actor+time, org+action+time, org+warehouse+time, correlation).
- **Request context** (`AsyncLocalStorage` + global interceptor) stamps every audit record a request
  writes with one `correlationId` and the actor snapshot — **zero changes to existing `record()` call
  sites**. A caller-supplied `X-Correlation-Id` header is honored for multi-request operations.
- **Redaction at write time** — protected keys (pass/token/secret/credential/authorization/api-key/…)
  become `[REDACTED]`; payloads over 8 KB collapse to `{ _truncated: true }`.
- **`AuditService.search`** — org-isolated, warehouse-scoped, cursor (keyset) paginated, with filters:
  date range, actor, action, entity type/id, warehouse, and free-text `q`. `correlation(id)` returns
  every record of one operation; `forEntity(type, id)` powers the entity History drawers off the same
  query. Change diffs (`{ from, to }`) are derived from the stored snapshots.
- **Permission + scope:** `audit.view` required (now also granted to **Warehouse Manager**); scoped
  users see only their warehouses' records, and a cross-scope warehouse filter returns empty.
- Endpoints: `GET /api/audit?<filters>&cursor=&limit=` → `AuditPage`; `GET /api/audit/correlation/:id`.

## Web UI
- **Audit Explorer** (Administration → Audit Explorer): filter bar (date range, entity type, warehouse,
  action, entity id, actor id, free text), a results table (**Time / Actor / Event / Warehouse**) with
  plain-language summaries, cursor "Load more", and a **Details drawer** — *Summary*, *Changes*,
  *Context* (entity, warehouse, source, correlation), and *Related events* (the correlated operation).
- **Semantic summaries** everywhere ("Product SSD-1 archived", "Location BIN-03 moved",
  "Supplier ACME updated") — users never read raw event names. Reused in every entity History drawer.

## Contract changes
`AuditEntryResponse` becomes the rich, generic shape (`occurredAt`, `actorId`, `actorDisplayName`,
`source`, `entityDisplay`, `warehouseId`, `correlationId`, `changes`). New `AUDIT_SOURCES` /
`AuditSource`, `AuditPage`, `AuditFilter`. Domains that are warehouse-scoped now tag `warehouseId` +
`entityDisplay` on their audit facts (warehouses, locations, policies, receipts, products, suppliers).

## Tests
- **Unit** (`audit.service.spec.ts`, 6): redaction of nested protected fields, oversize truncation,
  context inheritance (correlation/actor/display), change diffing, cross-scope filter → empty,
  cursor emission.
- **e2e** (`audit-explorer.e2e-spec.ts`, 8): permission enforced, org isolation, warehouse scope,
  entity/action/free-text filters, actor + date-range filters, stable cursor pagination (no dupes),
  archived-entity identity + actor snapshot survival, and correlated entries queryable together.
- **29 unit + 102 e2e green.**

## Deferred (intentionally)
Exports, retention policies, SIEM integration, anomaly detection, notifications. Richer causation
(beyond the request boundary) arrives with the outbox/domain-events work in a later phase.

---
**2A.1 (master-data operational readiness) is now complete.** Next: **2A.2 — Global Search + Barcode
Scanner UX**, building on the existing `BarcodeResolver`.

# Phase 2C.2C — Expiry UX + Alerts Foundation

**Status: ✅ Complete.** Final slice of 2C.2 ([ADR 0008](adr/0008-expiry-fefo.md)). Visibility + event-fact
only — no notification delivery, no new inventory semantics. **This completes 2C.2 Expiry + FEFO.**

## Expiry dashboard
`GET /lots/expiry-dashboard` → per-**(lot, warehouse)** rows with on hand / available / expiry date /
**days remaining** (business-date) / derived **expiryState**, sorted soonest-first. Filters: product/SKU
(`q`), warehouse, `expiryState`, `withinDays`, `hasStock`. Expired lots stay highly visible (they are
excluded from allocation, not from view). Web page `/lots/expiry` with a state tally and a "Run expiry
scan" action.

## Badges (two independent dimensions)
Shared `<ExpiryBadge>` renders **Expired / Expiring in Nd / Healthy / No expiry** on the lot explorer, lot
detail, and dashboard — kept visually separate from the lifecycle badge (ACTIVE/CLOSED) and the
Migrated/Unspecified origin badge, so condition and lifecycle are never conflated.

## FEFO preview UX
On **/releases/new**, a batch-tracked line shows a **Preview FEFO** action that calls the advisory plan
endpoint and displays the canonical allocation (e.g. `YG-EARLY ×40 (exp …), YG-MID ×10 (exp …)`),
attaching those allocations to the line for create → post. On **/releases/[id]** the post action surfaces
the two FEFO paths explicitly rather than as raw errors: a non-FEFO selection **prompts for an override
reason** and resubmits (ADR 0008 §6); a stale plan (**409**) shows *"Stock changed since this allocation
was generated. Refresh the FEFO plan."*

## Alert facts (foundation, not notifications)
`LotExpiryFact` (ADR 0008 §10) — an idempotent record that *a condition became true*, **not** an audit
entry and **not** a notification. `POST /lots/expiry-scan` detects `LOT_EXPIRING_SOON` / `LOT_EXPIRED`
across stocked lots and upserts **one fact per (lot, warehouse, eventType)** crossing — a repeat scan is a
no-op. `GET /lots/expiry-facts` queries them (payload: eventType, warehouse, product, variant, lot,
expiryDate, daysRemaining, detectedAt). No email/chat coupling; a future outbox can publish these
unchanged.

## Tests
- **e2e** (`expiry-dashboard.e2e-spec.ts`, 4): dashboard derived state + business-date days-remaining +
  state/withinDays filters + org isolation; expired physical stock stays visible; facts emitted once and
  not duplicated on repeated scans; facts queryable by type with the expected payload. **34 unit + 233 e2e
  green.** Browser-verified: the expiry dashboard (all four states, badges, days-left, warehouse
  breakdown), lot badges, and the FEFO preview on a release (canonical plan, expired excluded).

## Definition of done
> An operator can see which stocked lots are healthy, nearing expiry, or expired; preview and apply FEFO
> allocations during release; understand stale or overridden allocation decisions; and the system exposes
> idempotent expiry-condition facts without coupling them to notification channels. — met. **2C.2 Expiry +
> FEFO is complete.**

## Next
**2C.3 — Cycle Counting**: the lot-aware physical-count engine is already in place (2C.1B); only the
scheduling / ABC-class layer remains.

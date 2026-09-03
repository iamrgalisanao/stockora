# Phase 2D.2A — Notification Core + In-App Inbox

**Status: ✅ Complete.** First slice of 2D.2 ([ADR 0011](adr/0011-notifications.md)). Reliable domain events
become scoped, user-facing in-app notifications with per-user read/dismiss — **no external channels.**

## Rules → notifications (built by an outbox consumer, never in domain code)
`NotificationConsumer` subscribes to `LotExpiringSoon` / `LotExpired` / `CycleCountCompleted`; a
`NotificationRuleEngine` maps each event → *should notify? / who? / severity / title+message / entity link*
with **explicit rules** (no DSL):

| Event | Recipients | Severity |
|---|---|---|
| LotExpiringSoon | Warehouse + Inventory Manager of the affected warehouse | WARNING |
| LotExpired | Warehouse + Inventory Manager of the affected warehouse | CRITICAL |
| CycleCountCompleted | assignee + Warehouse Manager | INFO |

Routing honors **org + warehouse scope** and only **ACTIVE** members (a manager scoped to another warehouse,
a non-manager role, an admin's broad access, or a disabled member are all correctly excluded). Title/message
are **snapshotted** at creation; `entityType`/`entityId` stay live so opening navigates to the current page.

## Model + idempotency
`Notification` (one per business fact per rule) + `NotificationRecipient` (fan-out with independent
`readAt`/`dismissedAt`). `UNIQUE(eventId, ruleKey)` makes creation idempotent — the relay's per-consumer
receipt is the first guard, the unique constraint the backstop — so an outbox replay or a multi-consumer
relay retry never duplicates a notification. An event with no matching rule produces nothing. `NotificationDelivery`
/ `NotificationPreference` (external channels) are deferred to 2D.2B.

## In-app inbox
Auth-only, personal (every query scoped to the caller's `userId` + org):
`GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/read-all` ·
`POST /notifications/:id/read` · `POST /notifications/:id/dismiss`. Read/dismiss touch only the caller's own
recipient row — one user's read never affects another's. Web `/notifications` inbox: severity-styled cards
(INFO/WARNING/CRITICAL), NEW badge, Open (→ lot / cycle-count task), Mark read, Dismiss, Mark-all-read,
unread-only filter.

## Tests
- **e2e** (`notifications.e2e-spec.ts`, 8): correct recipients + severity for each rule with role/warehouse/
  org scoping (managers only, not admin, not other-warehouse, not staff); LotExpired CRITICAL + snapshot +
  live entity id; per-user read/dismiss independence + accurate unread count; CycleCountCompleted →
  assignee + manager INFO; outbox replay no duplicate; inactive member excluded; no-rule no-op + cross-org
  isolation; second-consumer failure doesn't duplicate. **34 unit + 301 e2e green.** Browser-verified the
  inbox (a manager sees a CRITICAL "Lot expired" and a WARNING "Lot expiring soon", delivered end-to-end by
  the live poller).
- Hardening: the outbox poller is now disabled under any Jest worker (`JEST_WORKER_ID`), removing a
  cross-spec flake where a stray live poller could drain another spec's events.

## Definition of done (2D.2A)
> Reliable domain events can be transformed idempotently into scoped, user-facing in-app notifications for
> the correct recipients, with independent per-user read/dismiss state and no coupling to outbound delivery
> providers. — met.

## Next
**2D.2B — External Delivery Framework + Email:** `NotificationDelivery` + a dispatcher with retries, a
channel-adapter contract, `NotificationPreference`, and the first outbound channel (EMAIL).

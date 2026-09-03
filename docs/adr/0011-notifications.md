# ADR 0011 — Notifications (Phase 2D.2)

**Status:** Accepted · **Date:** 2026-09-03 · **Related:** [0010 Transactional Outbox](0010-transactional-outbox.md), [0008 Expiry](0008-expiry-fefo.md), [0009 Cycle Counting](0009-cycle-counting.md)

## Context

2D.1 gave us reliable domain-fact delivery through the transactional outbox to idempotent consumers. 2D.2
adds the layer that turns those facts into things people see — **without coupling the domain to any channel**.

## Guiding principle

> **Domain events describe what happened; notification rules decide who should know; delivery channels
> decide how they are informed.** These three concerns stay separate.

## Core decisions

**1. Notifications are built by an outbox consumer, never inside domain code.** A `NotificationConsumer`
subscribes to domain events; a `NotificationRuleEngine` maps an event → *should notify? / who? / severity /
title+message / entity link*. Domain services never call the notification layer.

**2. Model separates the user-facing notification from per-recipient state and (later) channel delivery.**
```
Notification            — one per business fact per rule (the semantic notification)
  - organizationId, eventId, ruleKey, type, title, message, severity, entityType?, entityId?, warehouseId?, createdAt
NotificationRecipient   — fan-out to users; independent read/dismiss state
  - notificationId, userId, readAt?, dismissedAt?
NotificationDelivery    — (2D.2B) one row per outbound channel attempt
  - notificationId, recipientId, channel, status, attemptCount, availableAt, sentAt?, lastError?
```
One business fact → one semantic notification → many recipients → (later) many channel deliveries, without
duplicating the domain meaning.

**3. Severity is a notification concept, not an event concept.** `INFO | WARNING | CRITICAL`, assigned by the
rule (e.g. `LotExpired` → CRITICAL, `LotExpiringSoon` → WARNING, `CycleCountCompleted` → INFO).

**4. Explicit rules first — no rule DSL.** 2D.2A ships hard-coded rules:
```
LotExpiringSoon   → Warehouse Manager + Inventory Manager, affected warehouse → WARNING
LotExpired        → Warehouse Manager + Inventory Manager, affected warehouse → CRITICAL
CycleCountCompleted → assignee + Warehouse Manager, affected warehouse        → INFO
```
`ReorderRequired`, `ApprovalRequested`, `ReturnDispositionPosted`, … plug into the same engine later.

**5. Routing honors organization AND warehouse scope.** Recipients are active members whose role matches the
rule and whose warehouse scope covers the event's warehouse (empty scope = all warehouses). Broad app access
does **not** by itself make someone a recipient — only an explicit product rule does. Cross-org leakage is
impossible (recipients are resolved within the event's org).

**6. Text is snapshotted at creation; entity IDs stay live.** `title`/`message` are frozen when the
notification is created (they reflect what was true then); `entityType`/`entityId` remain stable so opening
the notification navigates to the current entity page.

**7. Idempotent creation.** `UNIQUE(eventId, ruleKey)` — replaying the outbox consumer (or a multi-consumer
relay retry) never creates a duplicate notification; the relay's per-consumer receipt is the first guard, the
unique constraint the backstop. An event with no matching rule safely produces nothing.

**8. In-app is the first channel, and a `NotificationRecipient` row IS its delivery.** A database inbox needs
no retry queue to be visible. External channels (2D.2B+) add `NotificationDelivery` rows behind a dispatcher;
`PUBLISHED`-style channel retries live there, never in the domain outbox.

**9. Preferences separate in-app visibility from outbound subscriptions.** Critical operational in-app
notifications cannot be globally opted out (a manager must not be able to hide expired-inventory alerts);
outbound channels (2D.2B+) are user-controllable via `NotificationPreference(userId, notificationType,
channel, enabled)`. Read/dismiss is always supported in-app.

**10. Inactive recipients.** Exclude inactive/deactivated members when creating *new* notifications; retain
historical recipient rows already created (they remain part of the record).

**Explicitly out of scope for 2D.2:** digests, quiet hours, escalation chains, templating languages, and
arbitrary rule builders.

## Slices

- **2D.2A — Notification Core + In-App Inbox:** this ADR; `Notification` + `NotificationRecipient`; explicit
  routing rules; the outbox `NotificationConsumer` (idempotent creation, scoped recipients); inbox APIs
  (list / unread-count / read / read-all / dismiss) + a minimal inbox UI. **No external delivery.**
- **2D.2B — External Delivery Framework + Email:** `NotificationDelivery`; a dispatcher with retries; a
  channel-adapter contract; `NotificationPreference`; the first outbound channel = **EMAIL**.
- **2D.2C — Notification UX + Webhook:** richer notification center + unread badge; preferences UI; delivery
  status visibility; the second outbound channel = **WEBHOOK**.

## Mandatory invariants (2D.2A, tested)

`LotExpiringSoon`/`LotExpired`/`CycleCountCompleted` create notifications for the correct recipients with the
expected severity; cross-org users never receive one; a warehouse-scoped rule notifies only eligible
warehouse recipients; outbox replay and multi-consumer relay retry never duplicate a notification; title/
message/entity are snapshotted; unread count is accurate; read/dismiss affect only the current user's
recipient row (one user's read never marks another's); an inactive member is excluded from new notifications
(historical rows retained); in-app creation has no email/webhook side effect; an event with no matching rule
produces nothing.

## Definition of done (2D.2A)

> Reliable domain events can be transformed idempotently into scoped, user-facing in-app notifications for
> the correct recipients, with independent per-user read/dismiss state and no coupling to outbound delivery
> providers.

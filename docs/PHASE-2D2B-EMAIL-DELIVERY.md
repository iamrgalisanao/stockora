# Phase 2D.2B — External Delivery Framework + Email

**Status: ✅ Complete.** Second slice of 2D.2 ([ADR 0011](adr/0011-notifications.md)). Opted-in recipients
receive notification **email** through a pluggable, retrying delivery framework — outbound failures never
touch the in-app notification or the domain outbox.

## Strict opt-in
`NotificationPreference(userId, notificationType, channel, enabled)` — **no row ⇒ disabled**. When a
notification is created, the notification consumer (same transaction) queues a `NotificationDelivery(PENDING)`
**only** for recipients who explicitly enabled EMAIL for that type — CRITICAL included (severity never
overrides preference). `GET`/`PUT /notification-preferences` manage a user's own preferences.

## Model
`NotificationDelivery` — one logical delivery per **(recipient, channel)** (`UNIQUE`), so retries live on the
row, never a new one. Lifecycle `PENDING → PROCESSING → SENT | FAILED | DEAD_LETTER | SKIPPED`
(`SKIPPED` = a queued delivery became non-sendable at send time). `attemptCount`, `availableAt`,
`leaseExpiresAt`, `sentAt`, `deadLetteredAt`, `lastError`, `providerMessageId`.

## Pluggable channel adapter
```
NotificationChannelAdapter { channel; send(renderedMessage) → { providerMessageId? } }
```
`ChannelAdapterRegistry` keys adapters by channel (last registration wins → config swaps the transport).
`ConsoleEmailAdapter` is the default (logs + records the message; no provider, no secrets); a real
`SmtpEmailAdapter` / `ProviderEmailAdapter` slots in behind the same contract via
`NOTIFICATION_EMAIL_TRANSPORT`. `NotificationTemplateRenderer` centralizes subject/text/HTML with a deep
link back into the app when the entity has a route — no templating DSL.

## Dispatcher (same reliability shape as the outbox relay, at the channel level)
`NotificationDeliveryService.dispatchPending()` claims a batch with `FOR UPDATE SKIP LOCKED` + a lease
(crash recovery via expired leases), then per delivery: `attemptCount++`, **re-check** eligibility (active
member + preference still enabled → else `SKIPPED`), render + `adapter.send` → `SENT` (with
`providerMessageId`); on throw → `FAILED` with exponential backoff, then `DEAD_LETTER` after `maxAttempts`.
Once the adapter accepts the message it is `SENT` (open/bounce tracking is a later concern). A failed email
never blocks other deliveries. A thin poller drives it (disabled under any test runner). Env-configurable
batch/lease/attempts/backoff. `GET /notification-deliveries` (`audit.view`, org-scoped) gives admin
diagnostics with sanitized errors and no message bodies.

## Separation preserved
Channel-level retries live entirely in the delivery layer — the **domain outbox** and the **in-app
notification** are untouched by any outbound failure (a dead-lettered email leaves the notification + its
recipient intact and readable).

## Tests
- **e2e** (`notification-delivery.e2e-spec.ts`, 9): no-pref → no delivery (in-app still created); opt-in →
  queued → dispatched → SENT with the console adapter recording subject/body + deep link; CRITICAL still
  needs opt-in; per-user + per-type preference scoping; replay doesn't duplicate the delivery; transient
  failure → backoff → DEAD_LETTER with one bad email never blocking others; disabled-recipient → SKIPPED;
  expired-lease recovery + concurrent dispatchers never double-send (attemptCount 1); org-scoped admin
  diagnostics. **34 unit + 310 e2e green.**
- Test-infra: e2e now runs serially (`maxWorkers: 1`) — the suite shares one database and several specs
  drive the outbox relay + async consumers, so parallel workers contended on shared tables; serial execution
  makes it deterministic.

## Definition of done (2D.2B)
> Explicitly opted-in recipients can receive notification emails through a pluggable delivery framework with
> channel-level retry, dead-letter, and observability, while outbound failures never affect the in-app
> notification or the domain outbox. — met.

## Next
**2D.2C — Notification UX + Webhook:** notification center + unread badge; preferences UI; delivery-status
visibility; the second outbound channel (WEBHOOK).

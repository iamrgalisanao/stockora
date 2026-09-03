# Phase 2D.2C — Notification UX + Webhook

**Status: ✅ Complete.** Final slice of 2D.2 ([ADR 0011](adr/0011-notifications.md)). The notification UX
(inbox unread badge, preferences, delivery status) plus a second outbound channel — an **org-level webhook
integration**. **This completes 2D.2 Notifications.**

## Webhook is an org integration, not a personal channel
`OrganizationWebhookConfig` (one per org: url, signingSecret?, enabled) + `WebhookSubscription(org, type,
enabled)` — the org chooses *"send LotExpired to our webhook"*, distinct from a user's *"email me about
LotExpired"*. Admin API `GET/PUT /notification-webhook` and `PUT /notification-webhook/subscriptions`
(`settings.manage`); the **signing secret is write-only** — responses expose only `hasSigningSecret`.

## Generalized delivery model
`NotificationDelivery` now belongs to the **Notification** (`notificationId`, `organizationId`), with
`notificationRecipientId` **optional** — set for per-recipient channels (EMAIL), null for org channels
(WEBHOOK). The notification consumer, in the same transaction as the notification, queues EMAIL deliveries
for opted-in recipients **and** one WEBHOOK delivery when the org is enabled + subscribed to the type — so
webhook dedupe rides the same transactional idempotency.

## Signed, versioned webhook payload
`WebhookEventPayload` carries `schemaVersion`, `deliveryId`, `eventId`, notification id/type/severity,
`occurredAt`, org, warehouse, `entity {type,id}`, title, message. Headers: `X-Inventory-Event-Id`,
`X-Inventory-Delivery-Id`, and — when a secret is set — `X-Inventory-Signature: sha256=<HMAC>` over the
**exact serialized body**. `ConsoleWebhookAdapter` is the default transport (records the request, no network
egress); a real HTTP transport registers behind `NOTIFICATION_WEBHOOK_TRANSPORT=http`. The dispatcher sends
WEBHOOK with the same claim/lease/retry/dead-letter semantics as email, re-checking config+subscription at
send time (→ SKIPPED if disabled); a failed webhook never blocks other deliveries or touches the in-app
notification.

## UX
- **Unread badge** on the Notifications nav link (light poll).
- **Inbox** shows each notification's own **email delivery state** (queued / sending / sent / retrying /
  failed) in modest wording — no provider internals.
- **Preferences** (`/notifications/preferences`): per-type In-app (On, or **On 🔒** for critical, which can't
  be disabled) + Email opt-in toggles.
- **Webhook Integration** admin (`/admin/webhooks`): endpoint, signing secret (write-only), enabled, and
  per-type event subscriptions.

## Tests
- **e2e** (`notification-webhook.e2e-spec.ts`, 6): org-scoped config with a never-returned secret; no delivery
  when disabled/unsubscribed and exactly one when enabled+subscribed (org-level, no recipient); signed,
  versioned payload sent via the console adapter with a deterministic HMAC and no network; replay doesn't
  duplicate; failure → retry → dead-letter without touching the in-app notification; admin diagnostics
  include WEBHOOK. **34 unit + 316 e2e green.** All three UI surfaces browser-verified end-to-end (a manager
  saw the unread badge, `Email: sent` on a CRITICAL, the locked critical preference, and the webhook admin).
- Reliability fix: the outbox relay and delivery dispatcher now compare against the **database clock**
  (`now()`) when claiming, not a client timestamp — eliminating a client/DB clock-skew flake that could leave
  eligible rows unclaimed. (This superseded the temporary serial-e2e mitigation noted in 2D.2B; the e2e suite
  runs parallel again and is stable.)

## Definition of done (2D.2C / 2D.2)
> Users can see and manage their in-app notifications and personal email preferences, while administrators can
> configure an organization-level webhook integration with type subscriptions and signed, retryable delivery,
> without coupling either outbound channel to domain events directly. — met. **2D.2 Notifications is
> complete.**

## Next
**2D.3 — Serial Tracking**: unit-level serial identity for high-value goods, building on the lot-aware
inventory grain and traceability UX.

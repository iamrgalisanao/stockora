/**
 * Notification contracts (Phase 2D.2, ADR 0011). A Notification is one semantic user-facing fact per
 * (event, rule); per-user read/dismiss state lives on the recipient. Severity is a notification concept.
 */

export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/** A notification as seen by one recipient (notification fields + that user's read/dismiss state). */
export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  entityType: string | null;
  entityId: string | null;
  warehouseId: string | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  emailStatus?: NotificationDeliveryStatus | null; // this user's EMAIL delivery state, if one was queued
}

/** Notification types that carry routing rules (used by the preferences + subscriptions UIs). */
export const NOTIFICATION_TYPES = ['LotExpiringSoon', 'LotExpired', 'CycleCountCompleted'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  LotExpiringSoon: 'Lot expiring soon',
  LotExpired: 'Lot expired',
  CycleCountCompleted: 'Cycle count completed',
};
/** Types whose in-app notification is CRITICAL and cannot be opted out of in-app (ADR 0011 §9). */
export const CRITICAL_IN_APP_TYPES: NotificationType[] = ['LotExpired'];

export interface UnreadCountResponse {
  unread: number;
}

// --- External delivery (2D.2B) ---

export const NOTIFICATION_CHANNELS = ['EMAIL', 'WEBHOOK'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD_LETTER', 'SKIPPED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/** A user's outbound-channel preference for a notification type. No row ⇒ disabled (strict opt-in). */
export interface NotificationPreferenceResponse {
  notificationType: string;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Org webhook integration (2D.2C). The signing secret is NEVER returned — only whether one is set. */
export interface WebhookSubscriptionResponse {
  notificationType: string;
  enabled: boolean;
}
export interface OrganizationWebhookConfigResponse {
  url: string | null;
  enabled: boolean;
  hasSigningSecret: boolean;
  subscriptions: WebhookSubscriptionResponse[];
}

/** The versioned webhook payload (also the shape integrators receive). */
export interface WebhookEventPayload {
  schemaVersion: number;
  deliveryId: string;
  eventId: string;
  id: string; // notification id
  type: string;
  severity: NotificationSeverity;
  occurredAt: string;
  organizationId: string;
  warehouseId: string | null;
  entity: { type: string; id: string } | null;
  title: string;
  message: string;
}

/** Admin delivery-diagnostics row (2D.2B/C). Sanitized last error; no message body. */
export interface NotificationDeliveryListItem {
  id: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  notificationType: string;
  recipientUserId: string | null; // null for org-level channels (WEBHOOK)
  availableAt: string;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

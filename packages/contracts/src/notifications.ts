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
}

export interface UnreadCountResponse {
  unread: number;
}

// --- External delivery (2D.2B) ---

export const NOTIFICATION_CHANNELS = ['EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD_LETTER', 'SKIPPED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/** A user's outbound-channel preference for a notification type. No row ⇒ disabled (strict opt-in). */
export interface NotificationPreferenceResponse {
  notificationType: string;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Admin delivery-diagnostics row (2D.2B). Sanitized last error; no message body. */
export interface NotificationDeliveryListItem {
  id: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  notificationType: string;
  recipientUserId: string;
  availableAt: string;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

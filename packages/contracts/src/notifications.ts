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

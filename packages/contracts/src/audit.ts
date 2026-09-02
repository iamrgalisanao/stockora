/**
 * Audit read-model contract (2A.1F). The audit subsystem is a READ MODEL: domains emit
 * facts; the explorer only searches, correlates, filters, and presents them.
 */

/** What KIND of initiator caused an event — reserved now so future non-human events aren't mislabeled. */
export const AUDIT_SOURCES = ['USER', 'SYSTEM', 'IMPORT', 'API', 'INTEGRATION', 'SCHEDULED_JOB'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

/** A single field-level change, `{ from, to }`, with protected values already redacted. */
export interface AuditChange {
  from: unknown;
  to: unknown;
}

/** Stable, generic shape for one audit entry (entity history + global explorer share it). */
export interface AuditEntryResponse {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorDisplayName: string | null; // snapshot — survives user rename/deletion
  source: AuditSource;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityDisplay: string | null; // snapshot of the entity's human identity (sku/code)
  organizationId: string | null;
  warehouseId: string | null;
  correlationId: string | null;
  /** Field-level diff for update/status events; null when the action isn't a change. */
  changes: Record<string, AuditChange> | null;
  reference: string | null;
}

/** Cursor-paginated result — audit logs get large, so pagination is server-side from day one. */
export interface AuditPage {
  entries: AuditEntryResponse[];
  nextCursor: string | null;
}

/** Explorer filters (all optional). `q` is a free-text contains across action/entity/actor. */
export interface AuditFilter {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  warehouseId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

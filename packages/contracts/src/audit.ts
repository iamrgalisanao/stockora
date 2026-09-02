/** Audit-log read contract (Phase 2A — entity history + later the global explorer). */
export interface AuditEntryResponse {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  userId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reference: string | null;
  createdAt: string;
}

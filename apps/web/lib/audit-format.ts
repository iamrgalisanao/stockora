import type { AuditEntryResponse } from '@iw/contracts';

const ENTITY_LABEL: Record<string, string> = {
  warehouse: 'Warehouse',
  location: 'Location',
  product: 'Product',
  variant: 'Variant',
  inventory_policy: 'Policy',
  supplier: 'Supplier',
  supplier_product: 'Supplier link',
  goods_receipt: 'Receipt',
  organization: 'Organization',
  brand: 'Brand',
  category: 'Category',
  unit: 'Unit',
  barcode: 'Barcode',
  adjustment_reason: 'Adjustment reason',
};

function humanize(s: string): string {
  return s.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function entityLabel(entityType: string | null): string {
  if (!entityType) return 'Record';
  return ENTITY_LABEL[entityType] ?? humanize(entityType);
}

/** A plain-language sentence for a log entry, so users never read raw event names. */
export function auditSummary(e: AuditEntryResponse): string {
  const label = entityLabel(e.entityType);
  const who = e.entityDisplay ?? (e.entityId ? e.entityId.slice(0, 8) : '');
  const verb = e.action.split('.').slice(1).join('.') || e.action;

  if (verb === 'status_changed' && e.changes?.status) {
    const { from, to } = e.changes.status;
    if (to === 'ARCHIVED') return `${label} ${who} archived`;
    if (to === 'ACTIVE' && from === 'INACTIVE') return `${label} ${who} reactivated`;
    if (to === 'INACTIVE') return `${label} ${who} deactivated`;
    return `${label} ${who} ${from} → ${to}`;
  }
  switch (verb) {
    case 'created':
      return `${label} ${who} created`;
    case 'updated':
      return `${label} ${who} updated`;
    case 'moved':
      return `${label} ${who} moved`;
    case 'linked':
      return `${label} ${who} linked`;
    default:
      return `${humanize(e.action)}${who ? ` — ${who}` : ''}`;
  }
}

export function auditActor(e: AuditEntryResponse): string {
  if (e.actorDisplayName) return e.actorDisplayName;
  if (e.source !== 'USER') return humanize(e.source);
  return e.actorId ? e.actorId.slice(0, 8) : 'Unknown';
}

'use client';

import type { LotExpiryState } from '@iw/contracts';

const MAP: Record<LotExpiryState, { cls: string; label: string }> = {
  EXPIRED: { cls: 'danger', label: 'Expired' },
  EXPIRING_SOON: { cls: 'warn', label: 'Expiring soon' },
  HEALTHY: { cls: 'ok', label: 'Healthy' },
  NO_EXPIRY: { cls: 'muted', label: 'No expiry' },
};

/** Expiry badge — a separate dimension from the lot lifecycle badge (ACTIVE/CLOSED). */
export function ExpiryBadge({ state, daysRemaining }: { state: LotExpiryState; daysRemaining?: number | null }) {
  const m = MAP[state];
  const label = state === 'EXPIRING_SOON' && daysRemaining != null ? `Expiring in ${daysRemaining}d` : m.label;
  return <span className={`badge ${m.cls}`}>{label}</span>;
}

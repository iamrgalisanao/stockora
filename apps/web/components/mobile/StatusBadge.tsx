'use client';

import type { PendingCommandState } from '@iw/contracts';

/**
 * The three operator-facing states (2D.6B, ADR 0014). Captured work is NEVER shown as a plain success:
 * until the server has the command it is ⏳ Pending sync; a settled server receipt is ✓ Synced; anything
 * needing a human is ⚠ Needs attention.
 */
export type MobileStatus = 'synced' | 'pending' | 'attention';

export function statusFromCommand(state: PendingCommandState, mayHaveReachedServer?: boolean): MobileStatus {
  if (state === 'SYNCED') return 'synced';
  if (state === 'FAILED' || state === 'CONFLICT' || state === 'REJECTED') return 'attention';
  // QUEUED / SYNCING / BLOCKED / LOCAL_DRAFT — including SUBMISSION_UNKNOWN — are all still pending.
  void mayHaveReachedServer;
  return 'pending';
}

const LABEL: Record<MobileStatus, string> = { synced: '✓ Synced', pending: '⏳ Pending sync', attention: '⚠ Needs attention' };
const KLASS: Record<MobileStatus, string> = { synced: 'ok', pending: 'warn', attention: 'bad' };

export function StatusBadge({ status, text }: { status: MobileStatus; text?: string }) {
  return <span className={`m-pill ${KLASS[status]}`}>{text ?? LABEL[status]}</span>;
}

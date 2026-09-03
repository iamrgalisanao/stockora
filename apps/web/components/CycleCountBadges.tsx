'use client';

import type { ABCClass, CycleCountTaskStatus } from '@iw/contracts';

const ABC_CLS: Record<ABCClass, string> = { A: 'danger', B: 'warn', C: 'ok', UNCLASSIFIED: 'muted' };
const STATUS_CLS: Record<CycleCountTaskStatus, string> = {
  PENDING: 'muted', ASSIGNED: 'warn', IN_PROGRESS: 'warn', COMPLETED: 'ok', CANCELLED: 'muted',
};

/** ABC counting-priority class — a planning attribute (A counted most often). */
export function AbcBadge({ abcClass }: { abcClass: ABCClass }) {
  return <span className={`badge ${ABC_CLS[abcClass]}`}>{abcClass === 'UNCLASSIFIED' ? 'Unclassified' : `ABC ${abcClass}`}</span>;
}

/** Persisted task lifecycle status. */
export function StatusBadge({ status }: { status: CycleCountTaskStatus }) {
  return <span className={`badge ${STATUS_CLS[status]}`}>{status.replace(/_/g, ' ')}</span>;
}

/** Derived timing — kept visually distinct from the persisted status (ADR 0009 §5: OVERDUE is derived). */
export function TimingBadge({ overdue }: { overdue: boolean }) {
  return overdue ? <span className="badge danger">OVERDUE</span> : null;
}

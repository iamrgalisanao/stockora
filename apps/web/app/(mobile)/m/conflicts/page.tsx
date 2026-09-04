'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MobileResolution, PendingCommand } from '@iw/contracts';
import { discardCommand, listConflicts, submitCommand } from '../../../../lib/mobile';
import { MobileHeader } from '../../../../components/mobile/MobileHeader';
import { StatusBadge, statusFromCommand } from '../../../../components/mobile/StatusBadge';

const TYPE_LABEL: Record<string, string> = {
  RECEIVE: 'Receive', RELEASE_PICK: 'Pick', TRANSFER_DISPATCH: 'Transfer dispatch',
  TRANSFER_RECEIVE: 'Transfer receive', COUNT_SUBMIT: 'Count', RETURN_RECEIVE: 'Return',
};
// Which workflow screen to send the operator to for a re-capture resolution.
const WORKFLOW_ROUTE: Record<string, string> = {
  RECEIVE: '/m/receive', RELEASE_PICK: '/m/pick', TRANSFER_DISPATCH: '/m/transfer',
  TRANSFER_RECEIVE: '/m/transfer', COUNT_SUBMIT: '/m/count', RETURN_RECEIVE: '/m/return',
};
const RESOLUTION_LABEL: Record<MobileResolution, string> = {
  REFRESH: 'Refresh', RESCAN: 'Rescan', REALLOCATE: 'Reallocate', REMOVE_ITEM: 'Remove item',
  DISCARD_LOCAL_COMMAND: 'Discard command', RETRY: 'Retry', SUPERVISOR_REVIEW: 'Supervisor review', REAUTHENTICATE: 'Re-authenticate',
};

/** Compact captured-value summary from a command payload (serials / quantities). */
function capturedSummary(p: PendingCommand): string {
  const payload = p.payload as Record<string, any> | undefined;
  const lines = (payload?.lines ?? payload?.entries) as Array<Record<string, any>> | undefined;
  if (!lines?.length) return '—';
  return lines.map((l) => {
    if (l.serialNumbers?.length) return l.serialNumbers.join(', ');
    if (l.quantity !== undefined) return `qty ${l.quantity}`;
    if (l.countedQty !== undefined) return `count ${l.countedQty}`;
    if (l.receivedQuantity !== undefined) return `qty ${l.receivedQuantity}`;
    return '·';
  }).join(' · ');
}

/**
 * Conflict Inbox (2D.6C, ADR 0014 §6). Every entry shows the document, the captured value, the current server
 * condition, the reason, and a recommended action. Actions are explicit and safe — Retry, Discard, or a
 * re-capture on the workflow screen. There is deliberately NO "force / use cached / overwrite" action.
 */
export default function ConflictsPage() {
  const [items, setItems] = useState<PendingCommand[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => setItems(await listConflicts().catch(() => [])), []);
  useEffect(() => { refresh(); }, [refresh]);

  const retry = useCallback(async (c: PendingCommand) => {
    setBusy(c.commandId);
    try { await submitCommand({ ...c, state: 'QUEUED' }); await refresh(); } finally { setBusy(null); }
  }, [refresh]);
  const discard = useCallback(async (c: PendingCommand) => {
    setBusy(c.commandId);
    try { await discardCommand(c.commandId); await refresh(); } finally { setBusy(null); }
  }, [refresh]);

  return (
    <div>
      <MobileHeader title="Conflicts" back />
      {items.length === 0 && (
        <div className="m-banner info">
          No conflicts. When queued work meets changed server state, it appears here — never silently merged or
          reallocated.
        </div>
      )}
      {items.map((c) => {
        const r = c.receipt;
        const isRejected = c.state === 'REJECTED';
        const route = WORKFLOW_ROUTE[c.commandType];
        const recapture = r?.resolution && ['RESCAN', 'REALLOCATE', 'REFRESH', 'REMOVE_ITEM'].includes(r.resolution);
        return (
          <div className="m-card" key={c.commandId}>
            <div className="m-row" style={{ paddingTop: 0 }}>
              <span className="k"><b>{TYPE_LABEL[c.commandType] ?? c.commandType}</b></span>
              <span className="v"><StatusBadge status={statusFromCommand(c.state)} text={isRejected ? '⚠ Rejected' : '⚠ Conflict'} /></span>
            </div>
            <div className="m-row"><span className="k">Captured</span><span className="v m-mono">{capturedSummary(c)}</span></div>
            {r?.currentState && <div className="m-row"><span className="k">Server now</span><span className="v m-mono">{JSON.stringify(r.currentState)}</span></div>}
            <div className="m-row"><span className="k">Reason</span><span className="v">{r?.code ?? '—'}</span></div>
            {r?.message && <div className="m-sub" style={{ margin: '2px 0 0' }}>{r.message}</div>}
            {r?.resolution && <div className="m-sub" style={{ margin: '4px 0 0' }}>Recommended: <b>{RESOLUTION_LABEL[r.resolution]}</b></div>}
            <div className="m-btn-row">
              {recapture && route && <Link href={route} className="m-btn secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>{RESOLUTION_LABEL[r!.resolution!]}</Link>}
              {!isRejected && r?.resolution !== 'SUPERVISOR_REVIEW' && <button className="m-btn secondary" disabled={busy === c.commandId} onClick={() => retry(c)}>Retry</button>}
              <button className="m-btn secondary" disabled={busy === c.commandId} onClick={() => discard(c)}>Discard</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

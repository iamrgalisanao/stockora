'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MobileCommandType,
  MobileWorkItem,
  MobileWorkLine,
  MobileWorkSession,
  MobileWorkType,
  PendingCommand,
} from '@iw/contracts';
import {
  buildCommand,
  enqueueCommand,
  getDeviceId,
  getIdentity,
  loadWorklist,
  openSession,
  saveSession,
  submitCommand,
  updateLineProgress,
  type OperatorIdentity,
} from '../../lib/mobile';
import { ScannerControl } from './ScannerControl';
import { StatusBadge, statusFromCommand } from './StatusBadge';

const TITLE: Record<MobileWorkType, string> = {
  receiving: 'Receive', releases: 'Pick', transfers: 'Transfer', counts: 'Count', returns: 'Return',
};

function commandTypeFor(item: MobileWorkItem): MobileCommandType {
  switch (item.workType) {
    case 'receiving': return 'RECEIVE';
    case 'releases': return 'RELEASE_PICK';
    case 'counts': return 'COUNT_SUBMIT';
    case 'returns': return 'RETURN_RECEIVE';
    case 'transfers': return item.subAction === 'receive' ? 'TRANSFER_RECEIVE' : 'TRANSFER_DISPATCH';
  }
}

/** True when a line has enough captured to be included and is internally valid. */
function lineComplete(item: MobileWorkItem, line: MobileWorkLine, session: MobileWorkSession): boolean {
  const p = session.localProgress[line.lineId] ?? { lineId: line.lineId };
  const scanned = p.serialNumbers?.length ?? 0;
  if (item.workType === 'counts') {
    if (line.tracking.serialized) return true; // observed set (even empty) is a valid count; variance computed on sync
    return p.quantity !== undefined; // a number must be entered, even under a blind count
  }
  if (item.workType === 'transfers' && item.subAction === 'receive') {
    return line.tracking.serialized ? scanned === (line.targetQty ?? 0) : (p.quantity ?? line.targetQty ?? 0) > 0;
  }
  if (line.tracking.serialized) return scanned > 0 && scanned === (line.targetQty ?? 0); // exact-count gate
  if ((p.quantity ?? 0) <= 0) return false;
  if (line.tracking.requireLot && !p.lotId && !p.batchNumber) return false; // batch identity required before executable
  return true;
}

/** Whether the whole session can be submitted. */
function canSubmit(item: MobileWorkItem, session: MobileWorkSession): boolean {
  if (item.workType === 'counts') return item.lines.every((l) => lineComplete(item, l, session));
  if (item.workType === 'transfers' && item.subAction === 'receive') return item.lines.every((l) => lineComplete(item, l, session));
  // Other flows allow partial capture: at least one complete line, and no line half-captured invalidly.
  const anyComplete = item.lines.some((l) => lineComplete(item, l, session));
  const noInvalid = item.lines.every((l) => {
    const p = session.localProgress[l.lineId] ?? { lineId: l.lineId };
    const scanned = p.serialNumbers?.length ?? 0;
    if (l.tracking.serialized) return scanned === 0 || scanned === (l.targetQty ?? 0); // no partial serial set
    if ((p.quantity ?? 0) > 0 && l.tracking.requireLot) return !!(p.lotId || p.batchNumber);
    return true;
  });
  return anyComplete && noInvalid;
}

function buildPayload(item: MobileWorkItem, session: MobileWorkSession): Record<string, unknown> {
  const prog = (id: string) => session.localProgress[id] ?? { lineId: id };
  switch (item.workType) {
    case 'receiving':
      return {
        lines: item.lines.map((l) => prog(l.lineId)).filter((p) => (p.quantity ?? 0) > 0 || (p.serialNumbers?.length ?? 0) > 0)
          .map((p) => ({ lineId: p.lineId, quantity: p.quantity ?? (p.serialNumbers?.length ?? 0), serialNumbers: p.serialNumbers, batchNumber: p.batchNumber, lotId: p.lotId, expiryDate: p.expiryDate })),
      };
    case 'releases':
      return {
        lines: item.lines.map((l) => prog(l.lineId)).filter((p) => (p.quantity ?? 0) > 0 || (p.serialNumbers?.length ?? 0) > 0)
          .map((p) => ({ lineId: p.lineId, quantity: p.quantity ?? (p.serialNumbers?.length ?? 0), serialNumbers: p.serialNumbers, lotAllocations: p.lotId ? [{ lotId: p.lotId, quantity: p.quantity ?? 0 }] : undefined })),
      };
    case 'transfers':
      if (item.subAction === 'receive') return { confirm: true };
      return { lines: item.lines.map((l) => prog(l.lineId)).map((p) => ({ itemId: p.lineId, serialNumbers: p.serialNumbers })) };
    case 'counts':
      return { entries: item.lines.map((l) => { const p = prog(l.lineId); return { itemId: l.lineId, countedQty: l.tracking.serialized ? undefined : p.quantity, observedSerials: l.tracking.serialized ? p.serialNumbers : undefined }; }) };
    case 'returns':
      return { lines: item.lines.map((l) => prog(l.lineId)).filter((p) => (p.quantity ?? 0) > 0).map((p) => ({ lineId: p.lineId, receivedQuantity: p.quantity ?? 0 })) };
  }
}

export function WorkflowRunner({ workType }: { workType: MobileWorkType }) {
  const [items, setItems] = useState<MobileWorkItem[]>([]);
  const [source, setSource] = useState<'live' | 'cache'>('live');
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<OperatorIdentity | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [selected, setSelected] = useState<{ item: MobileWorkItem; session: MobileWorkSession } | null>(null);
  const [result, setResult] = useState<PendingCommand | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await loadWorklist(workType);
    setItems(r.items);
    setSource(r.source);
    setLoading(false);
  }, [workType]);

  useEffect(() => {
    getDeviceId().then(setDeviceId).catch(() => {});
    getIdentity().then(setIdentity).catch(() => {});
    refresh();
  }, [refresh]);

  const open = useCallback(async (item: MobileWorkItem) => {
    if (!identity) return;
    const session = await openSession(item, identity.userId);
    setResult(null);
    setSelected({ item, session });
  }, [identity]);

  const onCapture = useCallback(async (lineId: string, patch: Parameters<typeof updateLineProgress>[2]) => {
    if (!selected) return;
    const session = await updateLineProgress(selected.session, lineId, patch);
    setSelected({ item: selected.item, session });
  }, [selected]);

  const submit = useCallback(async () => {
    if (!selected || !identity || !deviceId) return;
    setSubmitting(true);
    try {
      const { item, session } = selected;
      // One session -> one command. If already produced, reuse it (stable idempotencyKey on retry).
      let command: PendingCommand;
      if (session.commandId) {
        command = buildCommand({
          deviceId, organizationId: identity.organizationId, warehouseId: item.warehouseId, userId: identity.userId,
          commandType: commandTypeFor(item), aggregateId: item.documentId, expectedVersion: item.version,
          payload: buildPayload(item, session),
        });
        command = { ...command, commandId: session.commandId };
      } else {
        command = buildCommand({
          deviceId, organizationId: identity.organizationId, warehouseId: item.warehouseId, userId: identity.userId,
          commandType: commandTypeFor(item), aggregateId: item.documentId, expectedVersion: item.version,
          payload: buildPayload(item, session),
        });
        await saveSession({ ...session, state: 'SUBMITTED', commandId: command.commandId });
      }
      await enqueueCommand(command); // QUEUED — shown PENDING, never SUCCESS
      const after = await submitCommand(command); // online: submit through; offline: stays queued
      setResult(after);
    } finally {
      setSubmitting(false);
    }
  }, [selected, identity, deviceId]);

  if (loading) return <p className="m-sub">Loading work…</p>;

  // ---- capture view ----
  if (selected) {
    const { item, session } = selected;
    const submittable = canSubmit(item, session) && !result;
    return (
      <div>
        <button className="m-link" onClick={() => { setSelected(null); setResult(null); refresh(); }}>← Back to list</button>
        <p className="m-title" style={{ marginTop: 8 }}>{TITLE[workType]} · {item.reference}</p>
        <p className="m-sub">{item.warehouseCode} · {item.status}{item.subAction ? ` · ${item.subAction}` : ''}{item.blind ? ' · blind count' : ''}</p>

        {result && (
          <div className={`m-banner ${result.state === 'SYNCED' ? 'info' : ''}`}>
            <StatusBadge status={statusFromCommand(result.state, result.mayHaveReachedServer)} />{' '}
            {result.state === 'SYNCED'
              ? 'Submitted to the server. Nothing on-hand changes until the sync engine applies it.'
              : result.mayHaveReachedServer
                ? 'Sent, but the response was lost. It is safely queued and will retry with the same key — no double-apply.'
                : result.state === 'FAILED'
                  ? `Needs attention: ${result.lastError ?? 'rejected'}`
                  : 'Captured offline and queued. It will sync when the server is reachable.'}
          </div>
        )}

        {item.lines.map((line) => (
          <LineCapture key={line.lineId} item={item} line={line} session={session} onCapture={onCapture} disabled={!!result} />
        ))}

        {!result && (
          <button className="m-btn" disabled={!submittable || submitting} onClick={submit}>
            {submitting ? 'Submitting…' : 'Submit / Queue'}
          </button>
        )}
        {result && (
          <button className="m-btn secondary" onClick={() => { setSelected(null); setResult(null); refresh(); }}>Done</button>
        )}
      </div>
    );
  }

  // ---- list view ----
  return (
    <div>
      <div className="m-list-head">
        <p className="m-title">{TITLE[workType]}</p>
        <button className="m-link" onClick={refresh}>Refresh</button>
      </div>
      {source === 'cache' && <div className="m-banner">Showing cached work — you appear to be offline. Server revalidation required before anything is committed.</div>}
      {items.length === 0 && <p className="m-sub">No {TITLE[workType].toLowerCase()} work assigned right now.</p>}
      {items.map((item) => (
        <button key={`${item.documentId}:${item.subAction ?? ''}`} className="m-card m-work-row" onClick={() => open(item)}>
          <div>
            <div className="m-work-ref">{item.reference}{item.subAction ? ` · ${item.subAction}` : ''}</div>
            <div className="m-sub" style={{ margin: 0 }}>{item.warehouseCode} · {item.lines.length} line(s) · {item.status}</div>
            {item.claim && <div className="m-claim">Claimed by {item.claim.claimedByName} · {item.claim.deviceId}</div>}
          </div>
          <span className="m-chev">›</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LineCapture({ item, line, session, onCapture, disabled }: {
  item: MobileWorkItem;
  line: MobileWorkLine;
  session: MobileWorkSession;
  onCapture: (lineId: string, patch: Parameters<typeof updateLineProgress>[2]) => void;
  disabled: boolean;
}) {
  const p = session.localProgress[line.lineId] ?? { lineId: line.lineId };
  const serials = p.serialNumbers ?? [];
  const eligible = line.eligibleSerials;

  const addSerial = (raw: string) => {
    const code = raw.trim();
    if (!code || serials.includes(code)) return; // duplicate suppression
    onCapture(line.lineId, { serialNumbers: [...serials, code] });
  };
  const removeSerial = (sn: string) => onCapture(line.lineId, { serialNumbers: serials.filter((s) => s !== sn) });

  const target = line.targetQty;
  const complete = lineComplete(item, line, session);

  // Serial eligibility hints (advisory — the server is authoritative on sync).
  const unexpected = eligible ? serials.filter((s) => !eligible.includes(s)) : [];
  const missing = eligible ? eligible.filter((s) => !serials.includes(s)) : [];

  return (
    <div className={`m-card ${complete ? 'm-line-done' : ''}`}>
      <div className="m-row" style={{ paddingTop: 0 }}>
        <span className="k"><b>{line.sku}</b><br /><span className="m-sub" style={{ margin: 0 }}>{line.name}</span></span>
        <span className="v">
          {target !== undefined ? <>Need <b>{target}</b></> : <span className="m-pill neutral">blind</span>}
        </span>
      </div>

      {line.tracking.serialized ? (
        <div>
          <div className="m-sub" style={{ margin: '4px 0' }}>
            Serials {serials.length}{target !== undefined ? ` / ${target}` : ''} scanned
            {eligible && <span> · {eligible.length} eligible cached <span className="m-pill neutral">revalidation required</span></span>}
          </div>
          {!disabled && <ScannerControl onScan={addSerial} placeholder="Scan serial" autoFocus={false} />}
          <div className="m-serials">
            {serials.map((sn) => (
              <span key={sn} className={`m-serial ${eligible && !eligible.includes(sn) ? 'bad' : ''}`}>
                {sn}{!disabled && <button className="m-x" onClick={() => removeSerial(sn)}>×</button>}
              </span>
            ))}
          </div>
          {unexpected.length > 0 && <p className="m-sub" style={{ color: '#fda4af', margin: '4px 0 0' }}>⚠ {unexpected.length} not in the cached eligible set — server will verify.</p>}
          {item.subAction === 'receive' && missing.length > 0 && <p className="m-sub" style={{ margin: '4px 0 0' }}>Missing: {missing.join(', ')} — no substitution allowed.</p>}
        </div>
      ) : (
        <div className="m-scan-row" style={{ marginTop: 6 }}>
          <input
            className="m-input" type="number" inputMode="decimal" min={0} disabled={disabled}
            placeholder={item.workType === 'counts' ? 'Counted qty' : 'Quantity'}
            value={p.quantity ?? ''}
            onChange={(e) => onCapture(line.lineId, { quantity: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          {line.tracking.requireLot && (
            <input
              className="m-input" disabled={disabled} placeholder="Lot / batch"
              value={p.batchNumber ?? ''}
              onChange={(e) => onCapture(line.lineId, { batchNumber: e.target.value || undefined })}
            />
          )}
        </div>
      )}

      {line.suggestedAllocation && line.suggestedAllocation.length > 0 && (
        <p className="m-sub" style={{ margin: '6px 0 0' }}>
          Cached allocation: {line.suggestedAllocation.map((a) => `${a.quantity}×${a.lotCode ?? a.lotId.slice(0, 6)}`).join(', ')} <span className="m-pill neutral">server revalidation required</span>
        </p>
      )}
    </div>
  );
}

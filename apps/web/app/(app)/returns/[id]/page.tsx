'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type {
  DispositionType, ReturnLineResponse, ReturnResponse, ReturnStatus,
} from '@iw/contracts';
import { api } from '../../../../lib/api';
import { SerialPicker } from '../../../../components/SerialPicker';

const badgeClass = (s: ReturnStatus) =>
  s === 'RECEIVED' || s === 'PARTIALLY_DISPOSED' ? 'ok'
    : s === 'COMPLETED' ? '' : s === 'CANCELLED' ? 'danger' : 'warn';
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
const DESTRUCTIVE: DispositionType[] = ['RETURN_TO_SUPPLIER', 'DISPOSE'];
const LABEL: Record<DispositionType, string> = {
  RESTOCK: 'Restock', DAMAGED: 'Damaged', RETURN_TO_SUPPLIER: 'Return to supplier', DISPOSE: 'Dispose',
};

const sumByType = (l: ReturnLineResponse, t: DispositionType) =>
  l.dispositions.filter((d) => d.type === t).reduce((a, d) => a + Number(d.quantity), 0);

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<ReturnResponse | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ line: ReturnLineResponse } | null>(null);

  const load = useCallback(() => {
    api.returns.get(id).then(setR).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.me().then((u) => setPerms(u.permissions)).catch(() => {}); }, []);

  const canInspect = perms.includes('return.inspect');
  const canDispose = perms.includes('return.dispose');
  const canReceive = perms.includes('return.receive');
  const canCreate = perms.includes('return.create');
  const allowedOutcomes = useMemo<DispositionType[]>(() => [
    ...(canInspect ? (['RESTOCK', 'DAMAGED'] as DispositionType[]) : []),
    ...(canDispose ? (['RETURN_TO_SUPPLIER', 'DISPOSE'] as DispositionType[]) : []),
  ], [canInspect, canDispose]);

  async function run(fn: () => Promise<ReturnResponse>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true); setError(null);
    try { const res = await fn(); setR(res); toast.success(`Return ${res.status.replace(/_/g, ' ').toLowerCase()}`); } catch (e) { const m = e instanceof Error ? e.message : 'Action failed'; setError(m); toast.error(m); }
    finally { setBusy(false); }
  }

  if (error && !r) return <div className="error">{error}</div>;
  if (!r) return <div className="card muted">Loading…</div>;

  const active = r.status === 'RECEIVED' || r.status === 'PARTIALLY_DISPOSED';
  const isDraft = r.status === 'DRAFT';

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{r.returnNo} <span className={`badge ${badgeClass(r.status)}`}>{r.status}</span> <span className="muted" style={{ fontSize: 14 }}>{r.type}</span></h1>
        <Link href="/returns" className="btn secondary">← All returns</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 24px' }}>
          <div className="kv"><div className="k">Warehouse</div><div className="v">{r.warehouseCode}</div></div>
          <div className="kv"><div className="k">Source reference</div><div className="v">{r.sourceReference ?? '—'}</div></div>
          <div className="kv"><div className="k">Reason</div><div className="v">{r.reason ?? '—'}</div></div>
          <div className="kv"><div className="k">Created</div><div className="v">{fmt(r.createdAt)}</div></div>
          <div className="kv"><div className="k">Received</div><div className="v">{fmt(r.receivedAt)}</div></div>
          <div className="kv"><div className="k">Completed</div><div className="v">{fmt(r.completedAt)}</div></div>
        </div>
        {r.notes && <p className="muted" style={{ marginTop: 10 }}>{r.notes}</p>}
      </div>

      {isDraft && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {canReceive && <button className="btn" disabled={busy} onClick={() => run(() => api.returns.receive(r.id, {}), 'Receive this return into quarantine?')}>Receive into quarantine</button>}
          {canCreate && <button className="btn secondary" disabled={busy} onClick={() => run(() => api.returns.cancel(r.id), 'Cancel this draft return?')}>Cancel</button>}
        </div>
      )}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Product</th><th className="num">Received</th><th className="num">Restocked</th><th className="num">Damaged</th>
              <th className="num">Ret. supplier</th><th className="num">Disposed</th><th className="num">Remaining quarantine</th>
              {active && <th />}
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => {
              const remaining = Number(l.remainingQuarantine);
              return (
                <tr key={l.id}>
                  <td>{l.productSku} — {l.productName}</td>
                  <td className="num">{l.receivedQuantity}</td>
                  <td className="num">{sumByType(l, 'RESTOCK') || '—'}</td>
                  <td className="num">{sumByType(l, 'DAMAGED') || '—'}</td>
                  <td className="num">{sumByType(l, 'RETURN_TO_SUPPLIER') || '—'}</td>
                  <td className="num">{sumByType(l, 'DISPOSE') || '—'}</td>
                  <td className="num"><strong>{l.remainingQuarantine}</strong></td>
                  {active && (
                    <td>
                      {remaining > 0 && allowedOutcomes.length > 0
                        ? <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => setDrawer({ line: l })}>Dispose…</button>
                        : null}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <HistoryCard r={r} />

      {drawer && (
        <DispositionDrawer
          line={drawer.line}
          warehouseId={r.warehouseId}
          outcomes={allowedOutcomes}
          onClose={() => setDrawer(null)}
          onSubmit={async (body, confirmMsg) => {
            await run(() => api.returns.dispose(r.id, body), confirmMsg);
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}

function HistoryCard({ r }: { r: ReturnResponse }) {
  const events: Array<{ at: string; text: string }> = [];
  if (r.receivedAt) {
    const received = r.lines.reduce((a, l) => a + Number(l.receivedQuantity), 0);
    events.push({ at: r.receivedAt, text: `${received} unit(s) received into quarantine` });
  }
  for (const l of r.lines) {
    for (const d of l.dispositions) {
      events.push({ at: d.performedAt, text: `${d.quantity} × ${l.productSku} — ${LABEL[d.type]}${d.reason ? ` (${d.reason})` : ''}` });
    }
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const remaining = r.lines.reduce((a, l) => a + Number(l.remainingQuarantine), 0);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <strong>History</strong>
      {events.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Nothing posted yet.</p> : (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.9 }}>
          {events.map((e, i) => (
            <li key={i}><span>{e.text}</span> <span className="muted" style={{ fontSize: 12 }}>· {new Date(e.at).toLocaleString()}</span></li>
          ))}
          {remaining > 0 && <li className="muted">{remaining} unit(s) remain in quarantine</li>}
        </ul>
      )}
    </div>
  );
}

function DispositionDrawer({
  line, warehouseId, outcomes, onClose, onSubmit,
}: {
  line: ReturnLineResponse;
  warehouseId: string;
  outcomes: DispositionType[];
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>, confirmMsg?: string) => Promise<void>;
}) {
  const [type, setType] = useState<DispositionType>(outcomes[0]!);
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setClosing(true);
    window.setTimeout(onClose, 300);
  };
  const [quantity, setQuantity] = useState('');
  const [serials, setSerials] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // A client-generated key makes an accidental double-submit a no-op on the server.
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`));
  const remaining = Number(line.remainingQuarantine);
  const serialized = line.serialNumbers.length > 0; // a serialized line captured serials at intake

  function submit() {
    setErr(null);
    const qty = serialized ? serials.length : Number(quantity);
    if (!(qty > 0)) return setErr(serialized ? 'Select at least one serial to dispose.' : 'Enter a quantity greater than zero.');
    if (qty > remaining) return setErr(`Only ${remaining} remain in quarantine.`);
    const confirmMsg = DESTRUCTIVE.includes(type)
      ? `${LABEL[type]}: ${qty} × ${line.productSku} (${line.productName}).\nThis physically removes stock and cannot be undone. Continue?`
      : undefined;
    void onSubmit({ lineId: line.id, type, quantity: qty, ...(serialized ? { serialNumbers: serials } : {}), reason: reason.trim() || undefined, notes: notes.trim() || undefined, idempotencyKey }, confirmMsg);
  }

  return (
    <>
      <div className="drawer-backdrop" data-closing={closing || undefined} onClick={close} />
      <div className="drawer" data-closing={closing || undefined}>
        <div className="topbar"><h2 className="h1" style={{ fontSize: 18 }}>Disposition</h2><button className="btn secondary small" style={{ marginTop: 0 }} onClick={close}>✕</button></div>
        <p className="muted" style={{ marginTop: 0 }}>{line.productSku} — {line.productName}</p>
        <div className="kv"><div className="k">Remaining in quarantine</div><div className="v"><strong>{line.remainingQuarantine}</strong></div></div>

        {err && <div className="error">{err}</div>}

        <div style={{ marginTop: 12 }}>
          <label>Outcome</label>
          <select value={type} onChange={(e) => setType(e.target.value as DispositionType)}>
            {outcomes.map((o) => <option key={o} value={o}>{LABEL[o]}{DESTRUCTIVE.includes(o) ? ' (removes stock)' : ''}</option>)}
          </select>
        </div>
        {serialized ? (
          <div style={{ marginTop: 10 }}>
            <label>Serials to {LABEL[type].toLowerCase()}</label>
            <SerialPicker mode="select" status="QUARANTINED" productId={line.productId} warehouseId={warehouseId} requiredCount={remaining} value={serials} onChange={setSerials} />
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <label>Quantity</label>
            <input type="number" min="0" max={remaining} step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        )}
        <div style={{ marginTop: 10 }}><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div style={{ marginTop: 10 }}><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={submit}>Post disposition</button>
          <button className="btn secondary" onClick={close}>Cancel</button>
        </div>
      </div>
    </>
  );
}

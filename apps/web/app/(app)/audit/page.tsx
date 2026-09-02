'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditEntryResponse, AuditFilter, WarehouseResponse } from '@iw/contracts';
import { api } from '../../../lib/api';
import { auditActor, auditSummary, entityLabel } from '../../../lib/audit-format';

const ENTITY_TYPES = [
  '', 'warehouse', 'location', 'product', 'variant', 'inventory_policy',
  'supplier', 'supplier_product', 'goods_receipt', 'brand', 'category', 'unit', 'barcode',
];

const emptyFilter: AuditFilter = { from: '', to: '', actorId: '', action: '', entityType: '', entityId: '', warehouseId: '', q: '' };

export default function AuditExplorerPage() {
  const [draft, setDraft] = useState<AuditFilter>(emptyFilter);
  const [applied, setApplied] = useState<AuditFilter>(emptyFilter);
  const [rows, setRows] = useState<AuditEntryResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [selected, setSelected] = useState<AuditEntryResponse | null>(null);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);

  const load = useCallback((filter: AuditFilter, nextCursor: string | null, append: boolean) => {
    setLoading(true); setError(null);
    api.audit
      .search({ ...filter, cursor: nextCursor ?? undefined, limit: 25 })
      .then((page) => {
        setRows((prev) => (append ? [...prev, ...page.entries] : page.entries));
        setCursor(page.nextCursor);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(applied, null, false); }, [applied, load]);

  const set = <K extends keyof AuditFilter>(k: K, v: AuditFilter[K]) => setDraft((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Audit Explorer</h1>
        <span className="muted">{rows.length} event(s) loaded</span>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div><label>From</label><input type="date" value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} /></div>
          <div><label>To</label><input type="date" value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} /></div>
          <div><label>Entity type</label>
            <select value={draft.entityType ?? ''} onChange={(e) => set('entityType', e.target.value)}>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t ? entityLabel(t) : 'Any'}</option>)}
            </select>
          </div>
          <div><label>Warehouse</label>
            <select value={draft.warehouseId ?? ''} onChange={(e) => set('warehouseId', e.target.value)}>
              <option value="">Any</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </div>
          <div><label>Action</label><input value={draft.action ?? ''} onChange={(e) => set('action', e.target.value)} placeholder="e.g. product.status_changed" /></div>
          <div><label>Entity ID</label><input value={draft.entityId ?? ''} onChange={(e) => set('entityId', e.target.value)} placeholder="uuid" /></div>
          <div><label>Actor ID</label><input value={draft.actorId ?? ''} onChange={(e) => set('actorId', e.target.value)} placeholder="uuid" /></div>
          <div><label>Search</label><input value={draft.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="free text" /></div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" disabled={loading} onClick={() => setApplied({ ...draft })}>Search</button>
          <button className="btn secondary" disabled={loading} onClick={() => { setDraft(emptyFilter); setApplied({ ...emptyFilter }); }}>Reset</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th>Time</th><th>Actor</th><th>Event</th><th>Warehouse</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.occurredAt).toLocaleString()}</td>
                <td>{auditActor(r)}{r.source !== 'USER' && <span className="badge warn" style={{ marginLeft: 6 }}>{r.source}</span>}</td>
                <td>{auditSummary(r)}</td>
                <td>{warehouses.find((w) => w.id === r.warehouseId)?.code ?? '—'}</td>
                <td><button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => setSelected(r)}>Details</button></td>
              </tr>
            ))}
            {rows.length === 0 && !loading && <tr><td colSpan={5} className="muted">No matching audit events.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        {cursor && <button className="btn secondary" disabled={loading} onClick={() => load(applied, cursor, true)}>{loading ? 'Loading…' : 'Load more'}</button>}
        {!cursor && rows.length > 0 && <span className="muted">End of results.</span>}
      </div>

      {selected && <DetailsDrawer entry={selected} onClose={() => setSelected(null)} warehouses={warehouses} />}
    </div>
  );
}

function DetailsDrawer({ entry, onClose, warehouses }: { entry: AuditEntryResponse; onClose: () => void; warehouses: WarehouseResponse[] }) {
  const [related, setRelated] = useState<AuditEntryResponse[] | null>(null);
  useEffect(() => {
    if (entry.correlationId) api.audit.correlation(entry.correlationId).then(setRelated).catch(() => setRelated([]));
    else setRelated([]);
  }, [entry.correlationId]);

  const changes = entry.changes ? Object.entries(entry.changes) : [];
  const whCode = warehouses.find((w) => w.id === entry.warehouseId)?.code ?? entry.warehouseId ?? '—';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 460, maxWidth: '100%', height: '100%', overflowY: 'auto', borderRadius: 0, margin: 0 }}>
        <div className="topbar">
          <h2 className="h1" style={{ fontSize: 18 }}>Event details</h2>
          <button className="btn secondary small" onClick={onClose}>Close</button>
        </div>

        <h3 style={{ marginTop: 8 }}>Summary</h3>
        <div>{auditSummary(entry)}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {new Date(entry.occurredAt).toLocaleString()} · {auditActor(entry)} · <code>{entry.action}</code>
        </div>

        <h3 style={{ marginTop: 16 }}>Changes</h3>
        {changes.length === 0 ? <div className="muted">No field-level changes.</div> : (
          <table className="grid"><thead><tr><th>Field</th><th>From</th><th>To</th></tr></thead>
            <tbody>{changes.map(([k, c]) => (
              <tr key={k}><td>{k}</td><td className="muted">{fmt(c.from)}</td><td>{fmt(c.to)}</td></tr>
            ))}</tbody>
          </table>
        )}

        <h3 style={{ marginTop: 16 }}>Context</h3>
        <table className="grid"><tbody>
          <tr><td className="muted">Entity</td><td>{entityLabel(entry.entityType)} {entry.entityDisplay ?? ''}</td></tr>
          <tr><td className="muted">Entity ID</td><td><code style={{ fontSize: 11 }}>{entry.entityId ?? '—'}</code></td></tr>
          <tr><td className="muted">Warehouse</td><td>{whCode}</td></tr>
          <tr><td className="muted">Source</td><td>{entry.source}</td></tr>
          <tr><td className="muted">Reference</td><td>{entry.reference ?? '—'}</td></tr>
          <tr><td className="muted">Correlation</td><td><code style={{ fontSize: 11 }}>{entry.correlationId ?? '—'}</code></td></tr>
        </tbody></table>

        <h3 style={{ marginTop: 16 }}>Related events</h3>
        {related === null ? <div className="muted">Loading…</div> : related.length <= 1 ? (
          <div className="muted">This event stands alone.</div>
        ) : (
          <table className="grid"><thead><tr><th>Time</th><th>Event</th></tr></thead>
            <tbody>{related.map((r) => (
              <tr key={r.id} style={{ fontWeight: r.id === entry.id ? 700 : 400 }}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.occurredAt).toLocaleTimeString()}</td>
                <td>{auditSummary(r)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

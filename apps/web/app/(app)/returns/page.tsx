'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ReturnResponse, ReturnStatus, WarehouseResponse } from '@iw/contracts';
import { RETURN_STATUSES, RETURN_TYPES } from '@iw/contracts';
import { api } from '../../../lib/api';

const badgeClass = (s: ReturnStatus) =>
  s === 'RECEIVED' || s === 'PARTIALLY_DISPOSED' ? 'ok'
    : s === 'COMPLETED' ? '' : s === 'CANCELLED' ? 'danger' : 'warn';

function totals(r: ReturnResponse) {
  let received = 0, remaining = 0;
  for (const l of r.lines) { received += Number(l.receivedQuantity); remaining += Number(l.remainingQuarantine); }
  return { received, remaining };
}

export default function ReturnsPage() {
  const [rows, setRows] = useState<ReturnResponse[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasQuarantine, setHasQuarantine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.returns
        .list({
          status, type, warehouseId, q: q.trim(), sourceReference: sourceReference.trim(),
          from: from ? new Date(from).toISOString() : '', to: to ? new Date(to).toISOString() : '',
          hasQuarantine: hasQuarantine ? 'true' : '',
        })
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [status, type, warehouseId, q, sourceReference, from, to, hasQuarantine]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Returns</h1>
        <Link href="/returns/new" className="btn" style={{ marginTop: 0 }}>+ New return</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'end' }}>
          <div><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {RETURN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any</option>
              {RETURN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Any</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </div>
          <div><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="return # or SKU" /></div>
          <div><label>Source reference</label><input value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="RMA / order ref" /></div>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={hasQuarantine} onChange={(e) => setHasQuarantine(e.target.checked)} /> Has quarantine
          </label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : rows.length === 0 ? <div className="card muted">No returns.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Return #</th><th>Type</th><th>Warehouse</th><th>Source ref</th><th>Status</th>
                <th className="num">Received</th><th className="num">Remaining quarantine</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = totals(r);
                return (
                  <tr key={r.id}>
                    <td><Link href={`/returns/${r.id}`}>{r.returnNo}</Link></td>
                    <td>{r.type}</td>
                    <td>{r.warehouseCode}</td>
                    <td>{r.sourceReference ?? '—'}</td>
                    <td><span className={`badge ${badgeClass(r.status)}`}>{r.status}</span></td>
                    <td className="num">{t.received}</td>
                    <td className="num">{t.remaining}</td>
                    <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

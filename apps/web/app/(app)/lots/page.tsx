'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { LotResponse, LotStatus, WarehouseResponse } from '@iw/contracts';
import { LOT_STATUSES } from '@iw/contracts';
import { api } from '../../../lib/api';

const statusBadge = (s: LotStatus) => (s === 'ACTIVE' ? 'ok' : s === 'CLOSED' ? 'muted' : 'warn');
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

export default function LotsPage() {
  const [rows, setRows] = useState<LotResponse[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [hasStock, setHasStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.lots.list({ q: q.trim(), status, warehouseId, hasStock: hasStock ? 'true' : '' })
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, status, warehouseId, hasStock]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Lots</h1>
        <span className="muted">{rows.length} lots</span>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'end' }}>
          <div><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="lot # or SKU" /></div>
          <div><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {LOT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Any</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={hasStock} onChange={(e) => setHasStock(e.target.checked)} /> Has stock
          </label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : rows.length === 0 ? <div className="card muted">No lots.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Lot #</th><th>Product</th><th>Status</th><th>Manufactured</th><th>Expiry</th>
                <th className="num">On hand</th><th className="num">Quarantined</th><th className="num">Damaged</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/lots/${l.id}`}>{l.lotNumber}</Link>
                    {l.origin === 'LEGACY_MIGRATION' && <span className="badge warn" style={{ marginLeft: 6 }} title="Reconstructed from pre-tracking stock">Migrated</span>}
                  </td>
                  <td>{l.productSku} — {l.productName}</td>
                  <td><span className={`badge ${statusBadge(l.status)}`}>{l.status}</span></td>
                  <td>{fmtDate(l.manufacturedAt)}</td>
                  <td>{fmtDate(l.expiryDate)}</td>
                  <td className="num">{l.onHand}</td>
                  <td className="num">{l.quarantined}</td>
                  <td className="num">{l.damaged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

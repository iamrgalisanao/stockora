'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ExpiryDashboardRow, LotExpiryState, WarehouseResponse } from '@iw/contracts';
import { LOT_EXPIRY_STATES } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { ExpiryBadge } from '../../../../components/ExpiryBadge';

export default function ExpiryDashboardPage() {
  const [rows, setRows] = useState<ExpiryDashboardRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expiryState, setExpiryState] = useState('');
  const [withinDays, setWithinDays] = useState('');
  const [hasStock, setHasStock] = useState(true);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.lots.expiryDashboard({ q: q.trim(), warehouseId, expiryState, withinDays, hasStock: hasStock ? 'true' : '' })
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, warehouseId, expiryState, withinDays, hasStock]);

  async function runScan() {
    setScanMsg(null);
    try {
      const r = await api.lots.expiryScan();
      setScanMsg(`Detection complete — ${r.expired} expired, ${r.expiringSoon} expiring-soon fact(s) recorded.`);
    } catch (e) { setScanMsg(e instanceof Error ? e.message : 'Scan failed'); }
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => { acc[r.expiryState] = (acc[r.expiryState] ?? 0) + 1; return acc; }, {});

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Expiry</h1>
        <button className="btn secondary" style={{ marginTop: 0 }} onClick={runScan}>Run expiry scan</button>
      </div>
      {scanMsg && <div className="card muted" style={{ marginBottom: 12 }}>{scanMsg}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, alignItems: 'end' }}>
          <div><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="lot # or SKU" /></div>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Any</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </div>
          <div><label>Expiry state</label>
            <select value={expiryState} onChange={(e) => setExpiryState(e.target.value)}>
              <option value="">Any</option>
              {LOT_EXPIRY_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Within days</label><input type="number" min="0" value={withinDays} onChange={(e) => setWithinDays(e.target.value)} placeholder="e.g. 30" /></div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={hasStock} onChange={(e) => setHasStock(e.target.checked)} /> Has stock
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {(['EXPIRED', 'EXPIRING_SOON', 'HEALTHY', 'NO_EXPIRY'] as LotExpiryState[]).map((s) => `${s}: ${counts[s] ?? 0}`).join(' · ')}
        </p>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : rows.length === 0 ? <div className="card muted">No lots match.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Lot</th><th>Product</th><th>Warehouse</th>
                <th className="num">On hand</th><th className="num">Available</th>
                <th>Expiry</th><th className="num">Days left</th><th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.lotId}-${r.warehouseId}`}>
                  <td><Link href={`/lots/${r.lotId}`}>{r.lotNumber}</Link></td>
                  <td>{r.productSku} — {r.productName}</td>
                  <td>{r.warehouseCode}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num">{r.available}</td>
                  <td>{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '—'}</td>
                  <td className="num">{r.daysRemaining ?? '—'}</td>
                  <td><ExpiryBadge state={r.expiryState} daysRemaining={r.daysRemaining} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

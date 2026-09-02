'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ReservationResponse, ReservationStatus, WarehouseResponse } from '@iw/contracts';
import { RESERVATION_STATUSES } from '@iw/contracts';
import { api } from '../../../lib/api';

const badgeClass = (s: ReservationStatus) =>
  s === 'RESERVED' || s === 'PARTIALLY_CONSUMED' ? 'ok'
    : s === 'CONSUMED' ? '' : s === 'EXPIRED' ? 'danger' : 'warn';

function lineTotals(r: ReservationResponse) {
  let reserved = 0, consumed = 0;
  for (const l of r.lines) { reserved += Number(l.quantity); consumed += Number(l.consumedQuantity); }
  return { reserved, consumed, remaining: reserved - consumed };
}

export default function ReservationsPage() {
  const [rows, setRows] = useState<ReservationResponse[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.reservations
        .list({ status, warehouseId, sourceType: source, q: q.trim(), expiringSoon: expiringSoon ? 'true' : '' })
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [status, warehouseId, source, q, expiringSoon]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Reservations</h1>
        <Link href="/reservations/new" className="btn" style={{ marginTop: 0 }}>+ New reservation</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, alignItems: 'end' }}>
          <div><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Any</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </div>
          <div><label>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Any</option>
              <option value="MANUAL">MANUAL</option>
              <option value="INTERNAL_REQUEST">INTERNAL_REQUEST</option>
              <option value="EXTERNAL">EXTERNAL</option>
            </select>
          </div>
          <div><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="reservation # or SKU" /></div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={expiringSoon} onChange={(e) => setExpiringSoon(e.target.checked)} /> Expiring soon
          </label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : rows.length === 0 ? <div className="card muted">No reservations.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Reservation #</th><th>Source</th><th>Warehouse</th><th>Status</th>
                <th className="num">Reserved</th><th className="num">Consumed</th><th className="num">Remaining</th><th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = lineTotals(r);
                return (
                  <tr key={r.id}>
                    <td><Link href={`/reservations/${r.id}`}>{r.reservationNo}</Link></td>
                    <td>{r.sourceType}</td>
                    <td>{r.warehouseCode}</td>
                    <td><span className={`badge ${badgeClass(r.status)}`}>{r.status}</span></td>
                    <td className="num">{t.reserved}</td>
                    <td className="num">{t.consumed}</td>
                    <td className="num">{t.remaining}</td>
                    <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '—'}</td>
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

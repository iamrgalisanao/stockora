'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { POSITION_FILTERS, type InventoryPositionRow, type PositionFilter, type WarehouseResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { ExpiryBadge } from '../../../../components/ExpiryBadge';

const FILTER_LABELS: Record<PositionFilter, string> = {
  AVAILABLE: 'Available > 0',
  UNAVAILABLE: 'Unavailable',
  FULLY_RESERVED: 'Fully reserved',
  QUARANTINED: 'Quarantined',
  IN_TRANSIT_ONLY: 'In transit only',
  NEGATIVE_ANOMALY: 'Negative / anomaly',
  EXPIRED_LOT: 'Expired lot stock',
};
const n = (s: string) => Number(s);
const sum = (rows: InventoryPositionRow[], k: keyof InventoryPositionRow) => rows.reduce((a, r) => a + n(r[k] as string), 0);

export default function InventoryPositionPage() {
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<PositionFilter | ''>('');
  const [view, setView] = useState<'position' | 'availability'>('position');
  const [rows, setRows] = useState<InventoryPositionRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.positions({ warehouseId, q: q.trim(), filter })
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [warehouseId, q, filter]);

  // Group rows by product for the roll-up view.
  const groups = useMemo(() => {
    const m = new Map<string, InventoryPositionRow[]>();
    for (const r of rows) { const k = r.productId; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.values()].sort((a, b) => a[0]!.productSku.localeCompare(b[0]!.productSku));
  }, [rows]);

  const toggle = (id: string) => setExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Inventory Position</h1>
        <div className="toolbar" style={{ gap: 6, marginTop: 0 }}>
          <button className={`btn ${view === 'position' ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setView('position')}>Position</button>
          <button className={`btn ${view === 'availability' ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setView('availability')}>Availability lens</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 2fr', gap: 10, alignItems: 'end' }}>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All (my scope)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, product or lot #" /></div>
        </div>
        <div className="toolbar" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button className={`btn ${filter === '' ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setFilter('')}>All</button>
          {POSITION_FILTERS.map((f) => (
            <button key={f} className={`btn ${filter === f ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setFilter(f)}>{FILTER_LABELS[f]}</button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div>
        : rows.length === 0 ? <div className="card muted">No stock positions match.</div>
        : view === 'position' ? (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Product / Warehouse / Lot</th>
                <th className="num">On hand</th><th className="num">Reserved</th><th className="num">Quarantined</th>
                <th className="num">Damaged</th><th className="num">In transit</th><th className="num">Available</th><th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const head = g[0]!;
                const open = expanded.has(head.productId);
                return (
                  <Fragment key={head.productId}>
                    <tr style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => toggle(head.productId)}>
                      <td>{open ? '▾' : '▸'} {head.productSku} — {head.productName}</td>
                      <td className="num">{sum(g, 'onHand')}</td><td className="num">{sum(g, 'reserved')}</td><td className="num">{sum(g, 'quarantined')}</td>
                      <td className="num">{sum(g, 'damaged')}</td><td className="num">{sum(g, 'inTransit')}</td><td className="num">{sum(g, 'available')}</td><td></td>
                    </tr>
                    {open && g.sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode) || (a.lotNumber ?? '').localeCompare(b.lotNumber ?? '')).map((r) => (
                      <tr key={`${r.warehouseId}-${r.lotId ?? 'nil'}`} className="muted">
                        <td style={{ paddingLeft: 28 }}>
                          {r.warehouseCode}
                          {r.lotId ? <> · <Link href={`/lots/${r.lotId}`}>{r.lotNumber}</Link> {r.expiryState !== 'NO_EXPIRY' && <ExpiryBadge state={r.expiryState} />}</> : ''}
                        </td>
                        <td className="num">{r.onHand}</td><td className="num">{r.reserved}</td><td className="num">{r.quarantined}</td>
                        <td className="num">{r.damaged}</td><td className="num">{r.inTransit}</td><td className="num">{r.available}</td>
                        <td></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Product</th><th>Warehouse</th><th>Lot</th>
                <th className="num">Available</th><th className="num">Reserved</th><th className="num">Inbound</th>
                <th className="num">Quarantined</th><th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.productId}-${r.warehouseId}-${r.lotId ?? 'nil'}`}>
                  <td>{r.productSku} — {r.productName}</td>
                  <td>{r.warehouseCode}</td>
                  <td>{r.lotId ? <Link href={`/lots/${r.lotId}`}>{r.lotNumber}</Link> : <span className="muted">—</span>}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{r.available}</td>
                  <td className="num">{n(r.reserved) > 0 ? <Link href="/reservations">{r.reserved}</Link> : r.reserved}</td>
                  <td className="num">{n(r.inTransit) > 0 ? <Link href="/transfers">{r.inTransit}</Link> : r.inTransit}</td>
                  <td className="num">{n(r.quarantined) > 0 ? <Link href="/returns">{r.quarantined}</Link> : r.quarantined}</td>
                  <td>{r.lotId && r.expiryState !== 'NO_EXPIRY' ? <ExpiryBadge state={r.expiryState} /> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Inbound (in-transit) is context only — it is not counted as available. Reserved → reservations, quarantined → returns, in-transit → transfers.
          </p>
        </div>
      )}
    </div>
  );
}

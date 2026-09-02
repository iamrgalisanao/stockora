'use client';

import { useEffect, useState } from 'react';
import type { StockStatus, StockStatusRow } from '@iw/contracts';
import { api } from '../../../../lib/api';

const FILTERS: Array<StockStatus | 'ALL'> = ['ALL', 'OUT', 'LOW', 'OVERSTOCK', 'OK'];
const badge = (s: string) => (s === 'OUT' ? 'danger' : s === 'LOW' ? 'warn' : s === 'OVERSTOCK' ? 'warn' : 'ok');

export default function StockStatusReportPage() {
  const [filter, setFilter] = useState<StockStatus | 'ALL'>('ALL');
  const [rows, setRows] = useState<StockStatusRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .reports.stockStatus(filter === 'ALL' ? undefined : filter)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [filter]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Stock Status</h1>
        <div className="toolbar">
          {FILTERS.map((f) => (
            <button key={f} className={`btn ${f === filter ? '' : 'secondary'} small`} onClick={() => setFilter(f)} style={{ marginTop: 0 }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>SKU</th><th>Product</th>
              <th className="num">On hand</th><th className="num">Available</th>
              <th className="num">Reorder pt</th><th className="num">Max</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>{r.sku}</td>
                <td>{r.name}</td>
                <td className="num">{r.onHand}</td>
                <td className="num">{r.available}</td>
                <td className="num">{r.reorderPoint}</td>
                <td className="num">{r.maxStock}</td>
                <td><span className={`badge ${badge(r.status)}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

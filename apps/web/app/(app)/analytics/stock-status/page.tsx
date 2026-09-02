'use client';

import { useEffect, useState } from 'react';
import type { ReorderAssessment, ReorderState } from '@iw/contracts';
import { api } from '../../../../lib/api';

const FILTERS: Array<ReorderState | 'ALL'> = [
  'ALL',
  'OUT_OF_STOCK',
  'REORDER_REQUIRED',
  'INBOUND_COVERED',
  'LOW_STOCK',
  'OVERSTOCK',
  'OK',
];
const LABEL: Record<ReorderState | 'ALL', string> = {
  ALL: 'All',
  OUT_OF_STOCK: 'Out',
  REORDER_REQUIRED: 'Reorder',
  INBOUND_COVERED: 'Inbound',
  LOW_STOCK: 'Low',
  OVERSTOCK: 'Over',
  OK: 'OK',
};
const badge = (s: ReorderState) =>
  s === 'OUT_OF_STOCK' || s === 'REORDER_REQUIRED'
    ? 'danger'
    : s === 'LOW_STOCK' || s === 'OVERSTOCK' || s === 'INBOUND_COVERED'
      ? 'warn'
      : 'ok';

export default function StockStatusReportPage() {
  const [filter, setFilter] = useState<ReorderState | 'ALL'>('ALL');
  const [rows, setRows] = useState<ReorderAssessment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reports
      .stockStatus(filter === 'ALL' ? undefined : filter)
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
              {LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>SKU</th><th>Product</th><th>Warehouse</th>
              <th className="num">On hand</th><th className="num">Available</th><th className="num">In transit</th>
              <th className="num">Reorder pt</th><th className="num">Max</th><th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.warehouseId}|${r.productId}|${r.variantId ?? ''}`}>
                <td>{r.productSku}</td>
                <td>{r.productName}</td>
                <td>{r.warehouseCode}</td>
                <td className="num">{r.onHand}</td>
                <td className="num">{r.available}</td>
                <td className="num">{r.inTransit}</td>
                <td className="num">{r.reorderPoint}</td>
                <td className="num">{r.maxStock ?? '—'}</td>
                <td><span className={`badge ${badge(r.state)}`}>{r.state}</span></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">No items — add inventory policies to a product to see stock status here.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

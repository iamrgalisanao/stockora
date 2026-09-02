'use client';

import { useEffect, useState } from 'react';
import type { DeadStockRow } from '@iw/contracts';
import { api } from '../../../../lib/api';

const DAY_OPTIONS = [30, 60, 90, 180];

export default function DeadStockReportPage() {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<DeadStockRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .reports.deadStock(days)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [days]);

  const hasValue = rows.some((r) => r.value !== undefined);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Dead Stock</h1>
        <div className="toolbar">
          <span className="muted">No issues in</span>
          {DAY_OPTIONS.map((d) => (
            <button key={d} className={`btn ${d === days ? '' : 'secondary'} small`} onClick={() => setDays(d)} style={{ marginTop: 0 }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {rows.length === 0 ? (
        <div className="card muted">No dead stock for this window — everything on hand has moved recently.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Product</th><th className="num">On hand</th>
                {hasValue && <th className="num">Value</th>}
                <th>Last issued</th><th className="num">Days idle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td>{r.sku}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.onHand}</td>
                  {hasValue && <td className="num">{r.value}</td>}
                  <td>{r.lastOutboundAt ? new Date(r.lastOutboundAt).toLocaleDateString() : 'Never'}</td>
                  <td className="num">{r.daysSinceOutbound ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

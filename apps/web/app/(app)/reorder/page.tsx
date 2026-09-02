'use client';

import { useEffect, useState } from 'react';
import type { ReorderRecommendation } from '@iw/contracts';
import { api } from '../../../lib/api';

export default function ReorderPage() {
  const [rows, setRows] = useState<ReorderRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .reorder()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const hasCost = rows.some((r) => r.estimatedCost !== undefined);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Reorder Recommendations</h1>
        <span className="muted">{rows.length} item(s) at or below reorder point</span>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card muted">Nothing needs reordering — all tracked products are above their reorder point.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num">Available</th>
                <th className="num">Incoming</th>
                <th className="num">Reorder pt</th>
                <th className="num">Suggested</th>
                <th>Preferred supplier</th>
                <th className="num">Lead (d)</th>
                {hasCost && <th className="num">Est. cost</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td>{r.sku}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num"><span className={`badge ${Number(r.available) <= 0 ? 'danger' : 'warn'}`}>{r.available}</span></td>
                  <td className="num">{r.incoming}</td>
                  <td className="num">{r.reorderPoint}</td>
                  <td className="num"><strong>{r.suggestedQty}</strong> {r.uomCode}</td>
                  <td>{r.preferredSupplierName ?? '—'}</td>
                  <td className="num">{r.leadTimeDays}</td>
                  {hasCost && <td className="num">{r.estimatedCost}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

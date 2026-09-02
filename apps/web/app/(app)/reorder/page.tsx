'use client';

import { useEffect, useState } from 'react';
import type { ReorderAssessment } from '@iw/contracts';
import { api } from '../../../lib/api';

export default function ReorderPage() {
  const [rows, setRows] = useState<ReorderAssessment[]>([]);
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
        <span className="muted">{rows.length} item(s) needing an order</span>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card muted">
          Nothing needs reordering — every warehouse policy is above its reorder point or covered by inbound stock.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th className="num">On hand</th>
                <th className="num">Available</th>
                <th className="num">In transit</th>
                <th className="num">Reorder pt</th>
                <th className="num">Recommended</th>
                <th>Preferred supplier</th>
                {hasCost && <th className="num">Est. cost</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.warehouseId}|${r.productId}|${r.variantId ?? ''}`}>
                  <td>{r.productSku}</td>
                  <td>{r.productName}</td>
                  <td>{r.warehouseCode}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num"><span className={`badge ${Number(r.available) <= 0 ? 'danger' : 'warn'}`}>{r.available}</span></td>
                  <td className="num">{r.inTransit}</td>
                  <td className="num">{r.reorderPoint}</td>
                  <td className="num"><strong>{r.recommendedQuantity}</strong> {r.uomCode}</td>
                  <td>{r.preferredSupplierName ?? '—'}</td>
                  {hasCost && <td className="num">{r.estimatedCost ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

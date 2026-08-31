'use client';

import { useEffect, useState } from 'react';
import type { BalanceResponse } from '@iw/contracts';
import { api } from '../../../lib/api';

export default function InventoryPage() {
  const [balances, setBalances] = useState<BalanceResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .balances()
      .then(setBalances)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const hasCost = balances.some((b) => b.avgCost !== undefined);
  const hasValue = balances.some((b) => b.value !== undefined);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Stock Overview</h1>
        <span className="muted">{balances.length} balance records</span>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : balances.length === 0 ? (
        <div className="card muted">No stock yet. Post a goods receipt from Receiving to bring inventory in.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th className="num">On hand</th>
                <th className="num">Reserved</th>
                <th className="num">In transit</th>
                <th className="num">Available</th>
                {hasCost && <th className="num">Avg cost</th>}
                {hasValue && <th className="num">Value</th>}
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => (
                <tr key={`${b.productId}-${b.warehouseId}-${i}`}>
                  <td>{b.productSku}</td>
                  <td>{b.productName}</td>
                  <td>{b.warehouseCode}</td>
                  <td className="num">{b.onHand}</td>
                  <td className="num">{b.reserved}</td>
                  <td className="num">{b.inTransit}</td>
                  <td className="num">{b.available}</td>
                  {hasCost && <td className="num">{b.avgCost}</td>}
                  {hasValue && <td className="num">{b.value}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

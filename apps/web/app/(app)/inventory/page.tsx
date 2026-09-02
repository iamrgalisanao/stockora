'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { BalanceResponse, ReservedBreakdownRow } from '@iw/contracts';
import { api } from '../../../lib/api';

const NIL = '00000000-0000-0000-0000-000000000000';

export default function InventoryPage() {
  const [balances, setBalances] = useState<BalanceResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, ReservedBreakdownRow[] | 'loading' | 'error'>>({});

  useEffect(() => {
    api
      .balances()
      .then(setBalances)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const hasCost = balances.some((b) => b.avgCost !== undefined);
  const hasValue = balances.some((b) => b.value !== undefined);

  function toggleDrill(key: string, b: BalanceResponse) {
    if (openKey === key) { setOpenKey(null); return; }
    setOpenKey(key);
    if (!breakdown[key]) {
      setBreakdown((m) => ({ ...m, [key]: 'loading' }));
      const variantId = b.variantId && b.variantId !== NIL ? b.variantId : undefined;
      api.reservations
        .reservedBreakdown(b.productId, b.warehouseId, variantId)
        .then((rows) => setBreakdown((m) => ({ ...m, [key]: rows })))
        .catch(() => setBreakdown((m) => ({ ...m, [key]: 'error' })));
    }
  }

  const colSpan = 8 + (hasCost ? 1 : 0) + (hasValue ? 1 : 0);

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
                <th className="num">Quarantined</th>
                <th className="num">In transit</th>
                <th className="num">Available</th>
                {hasCost && <th className="num">Avg cost</th>}
                {hasValue && <th className="num">Value</th>}
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => {
                const key = `${b.productId}-${b.variantId ?? 'nil'}-${b.warehouseId}-${i}`;
                const reserved = Number(b.reserved);
                const rows = breakdown[key];
                return (
                  <Fragment key={key}>
                    <tr>
                      <td>{b.productSku}</td>
                      <td>{b.productName}</td>
                      <td>{b.warehouseCode}</td>
                      <td className="num">{b.onHand}</td>
                      <td className="num">
                        {reserved > 0 ? (
                          <button className="linklike" onClick={() => toggleDrill(key, b)}>
                            {b.reserved} {openKey === key ? '▾' : '▸'}
                          </button>
                        ) : b.reserved}
                      </td>
                      <td className="num">{b.quarantined}</td>
                      <td className="num">{b.inTransit}</td>
                      <td className="num">{b.available}</td>
                      {hasCost && <td className="num">{b.avgCost}</td>}
                      {hasValue && <td className="num">{b.value}</td>}
                    </tr>
                    {openKey === key && (
                      <tr>
                        <td colSpan={colSpan} style={{ background: 'var(--panel)' }}>
                          {rows === 'loading' ? <span className="muted">Loading reservations…</span>
                            : rows === 'error' ? <span className="error" style={{ margin: 0 }}>Failed to load breakdown.</span>
                            : !rows || rows.length === 0 ? <span className="muted">No active reservation lines.</span>
                            : <ReservedDetail rows={rows} balanceReserved={reserved} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReservedDetail({ rows, balanceReserved }: { rows: ReservedBreakdownRow[]; balanceReserved: number }) {
  const sum = rows.reduce((acc, r) => acc + Number(r.remaining), 0);
  const balanced = Math.abs(sum - balanceReserved) < 1e-9;
  return (
    <div>
      <table className="grid" style={{ margin: '4px 0' }}>
        <thead>
          <tr><th>Reservation #</th><th>Status</th><th className="num">Remaining</th><th>Expires</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lineId}>
              <td><Link href={`/reservations/${r.reservationId}`}>{r.reservationNo}</Link></td>
              <td>{r.status}</td>
              <td className="num">{r.remaining}</td>
              <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 12 }}>
        Sum of remaining = {sum} {balanced ? '✓ matches balance reserved' : `⚠ balance reserved is ${balanceReserved}`}
      </div>
    </div>
  );
}

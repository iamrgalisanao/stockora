'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { BalanceResponse, QuarantineBreakdownRow, ReservedBreakdownRow } from '@iw/contracts';
import { api } from '../../../lib/api';

const NIL = '00000000-0000-0000-0000-000000000000';
type Cell<T> = T[] | 'loading' | 'error' | undefined;

export default function InventoryPage() {
  const [balances, setBalances] = useState<BalanceResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null); // `${rowKey}:reserved` | `${rowKey}:quarantine`
  const [reserved, setReserved] = useState<Record<string, Cell<ReservedBreakdownRow>>>({});
  const [quarantine, setQuarantine] = useState<Record<string, Cell<QuarantineBreakdownRow>>>({});

  useEffect(() => {
    api.balances().then(setBalances)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const hasCost = balances.some((b) => b.avgCost !== undefined);
  const hasValue = balances.some((b) => b.value !== undefined);
  const colSpan = 9 + (hasCost ? 1 : 0) + (hasValue ? 1 : 0);

  function toggle(kind: 'reserved' | 'quarantine', rowKey: string, b: BalanceResponse) {
    const full = `${rowKey}:${kind}`;
    if (openKey === full) { setOpenKey(null); return; }
    setOpenKey(full);
    const variantId = b.variantId && b.variantId !== NIL ? b.variantId : undefined;
    if (kind === 'reserved' && !reserved[rowKey]) {
      setReserved((m) => ({ ...m, [rowKey]: 'loading' }));
      api.reservations.reservedBreakdown(b.productId, b.warehouseId, variantId)
        .then((rows) => setReserved((m) => ({ ...m, [rowKey]: rows })))
        .catch(() => setReserved((m) => ({ ...m, [rowKey]: 'error' })));
    }
    if (kind === 'quarantine' && !quarantine[rowKey]) {
      setQuarantine((m) => ({ ...m, [rowKey]: 'loading' }));
      api.returns.quarantineBreakdown(b.productId, b.warehouseId, variantId)
        .then((rows) => setQuarantine((m) => ({ ...m, [rowKey]: rows })))
        .catch(() => setQuarantine((m) => ({ ...m, [rowKey]: 'error' })));
    }
  }

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
                <th>SKU</th><th>Product</th><th>Warehouse</th>
                <th className="num">On hand</th><th className="num">Reserved</th><th className="num">Quarantined</th>
                <th className="num">Damaged</th><th className="num">In transit</th><th className="num">Available</th>
                {hasCost && <th className="num">Avg cost</th>}
                {hasValue && <th className="num">Value</th>}
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => {
                const rowKey = `${b.productId}-${b.variantId ?? 'nil'}-${b.warehouseId}-${i}`;
                const nReserved = Number(b.reserved);
                const nQuar = Number(b.quarantined);
                return (
                  <Fragment key={rowKey}>
                    <tr>
                      <td>{b.productSku}</td>
                      <td>{b.productName}</td>
                      <td>{b.warehouseCode}</td>
                      <td className="num">{b.onHand}</td>
                      <td className="num">
                        {nReserved > 0
                          ? <button className="linklike" onClick={() => toggle('reserved', rowKey, b)}>{b.reserved} {openKey === `${rowKey}:reserved` ? '▾' : '▸'}</button>
                          : b.reserved}
                      </td>
                      <td className="num">
                        {nQuar > 0
                          ? <button className="linklike" onClick={() => toggle('quarantine', rowKey, b)}>{b.quarantined} {openKey === `${rowKey}:quarantine` ? '▾' : '▸'}</button>
                          : b.quarantined}
                      </td>
                      <td className="num">{b.damaged}</td>
                      <td className="num">{b.inTransit}</td>
                      <td className="num">{b.available}</td>
                      {hasCost && <td className="num">{b.avgCost}</td>}
                      {hasValue && <td className="num">{b.value}</td>}
                    </tr>
                    {openKey === `${rowKey}:reserved` && (
                      <tr><td colSpan={colSpan} style={{ background: 'var(--panel)' }}>
                        <DrillCell state={reserved[rowKey]} empty="No active reservation lines.">
                          {(rows) => <ReservedDetail rows={rows} balance={nReserved} />}
                        </DrillCell>
                      </td></tr>
                    )}
                    {openKey === `${rowKey}:quarantine` && (
                      <tr><td colSpan={colSpan} style={{ background: 'var(--panel)' }}>
                        <DrillCell state={quarantine[rowKey]} empty="No active quarantined return lines.">
                          {(rows) => <QuarantineDetail rows={rows} balance={nQuar} />}
                        </DrillCell>
                      </td></tr>
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

function DrillCell<T>({ state, empty, children }: { state: Cell<T>; empty: string; children: (rows: T[]) => ReactNode }) {
  if (state === 'loading') return <span className="muted">Loading…</span>;
  if (state === 'error') return <span className="error" style={{ margin: 0 }}>Failed to load breakdown.</span>;
  if (!state || state.length === 0) return <span className="muted">{empty}</span>;
  return <>{children(state)}</>;
}

function ReconcileNote({ sum, balance, label }: { sum: number; balance: number; label: string }) {
  const ok = Math.abs(sum - balance) < 1e-9;
  return (
    <div className="muted" style={{ fontSize: 12 }}>
      Sum of remaining = {sum} {ok ? `✓ matches balance ${label}` : `⚠ balance ${label} is ${balance}`}
    </div>
  );
}

function ReservedDetail({ rows, balance }: { rows: ReservedBreakdownRow[]; balance: number }) {
  const sum = rows.reduce((a, r) => a + Number(r.remaining), 0);
  return (
    <div>
      <table className="grid" style={{ margin: '4px 0' }}>
        <thead><tr><th>Reservation #</th><th>Status</th><th className="num">Remaining</th><th>Expires</th></tr></thead>
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
      <ReconcileNote sum={sum} balance={balance} label="reserved" />
    </div>
  );
}

function QuarantineDetail({ rows, balance }: { rows: QuarantineBreakdownRow[]; balance: number }) {
  const sum = rows.reduce((a, r) => a + Number(r.remaining), 0);
  return (
    <div>
      <table className="grid" style={{ margin: '4px 0' }}>
        <thead><tr><th>Return #</th><th>Type</th><th>Status</th><th className="num">Remaining</th><th>Received</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lineId}>
              <td><Link href={`/returns/${r.returnId}`}>{r.returnNo}</Link></td>
              <td>{r.type}</td>
              <td>{r.status}</td>
              <td className="num">{r.remaining}</td>
              <td>{r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReconcileNote sum={sum} balance={balance} label="quarantined" />
    </div>
  );
}

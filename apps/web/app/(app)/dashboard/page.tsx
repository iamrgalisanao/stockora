'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuthenticatedUser, DashboardSummary } from '@iw/contracts';
import { api } from '../../../lib/api';

export default function DashboardPage() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [s, setS] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.me(), api.dashboard()])
      .then(([me, summary]) => {
        setUser(me);
        setS(summary);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="card error">{error}</div>;
  if (!user || !s) return <div className="card muted">Loading…</div>;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Dashboard</h1>
        <span className="muted">{user.organizationName} · {user.roleName}</span>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Products (SKUs)" value={String(s.totalSkus)} />
        <Kpi label="On hand" value={Number(s.totalOnHand).toLocaleString()} />
        <Kpi label="Available" value={Number(s.totalAvailable).toLocaleString()} />
        <Kpi label="Inventory value" value={s.inventoryValue !== undefined ? Number(s.inventoryValue).toLocaleString(undefined, { style: 'currency', currency: 'PHP' }) : '—'} />
      </div>

      <div className="muted" style={{ margin: '20px 0 8px' }}>Needs attention</div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Exception label="To reorder" value={s.reorderCount} href="/reorder" tone={s.reorderCount > 0 ? 'warn' : 'ok'} />
        <Exception label="Low stock" value={s.lowStockCount} tone={s.lowStockCount > 0 ? 'warn' : 'ok'} />
        <Exception label="Out of stock" value={s.outOfStockCount} tone={s.outOfStockCount > 0 ? 'danger' : 'ok'} />
      </div>

      <div className="muted" style={{ margin: '20px 0 8px' }}>Pending documents</div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <Exception label="Receipts" value={s.pending.receipts} href="/receiving" />
        <Exception label="Releases" value={s.pending.releases} href="/releases" />
        <Exception label="Transfers" value={s.pending.transfers} href="/transfers" />
        <Exception label="Adjustments" value={s.pending.adjustments} href="/adjustments" />
        <Exception label="Counts" value={s.pending.counts} href="/counts" />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="muted" style={{ marginBottom: 8 }}>Recent movements</div>
        {s.recentMovements.length === 0 ? (
          <div className="muted">No movements yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>Txn</th><th>Type</th><th>SKU</th><th>Warehouse</th><th className="num">Qty</th><th>When</th></tr>
              </thead>
              <tbody>
                {s.recentMovements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.txnNumber}</td>
                    <td>{m.movementType.replace(/_/g, ' ')}</td>
                    <td>{m.productSku}</td>
                    <td>{m.warehouseCode}</td>
                    <td className="num">{m.quantity}</td>
                    <td>{new Date(m.postedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function Exception({ label, value, href, tone = 'muted' }: { label: string; value: number; href?: string; tone?: 'ok' | 'warn' | 'danger' | 'muted' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? '#e6b800' : tone === 'ok' ? 'var(--accent-2)' : 'var(--text)';
  const inner = (
    <div className="card" style={{ cursor: href ? 'pointer' : 'default' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color }}>{value}</div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}

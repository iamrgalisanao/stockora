'use client';

import { useEffect, useState, type ReactNode } from 'react';
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

  const onHand = num(s.totalOnHand);
  const available = num(s.totalAvailable);
  const reserved = num(s.totalReserved);
  const inTransit = num(s.totalInTransit);
  const compoTotal = Math.max(available + reserved + inTransit, 1);
  const availPct = onHand > 0 ? Math.min(100, Math.round((available / onHand) * 100)) : 0;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Dashboard</h1>
        <span className="muted">{user.organizationName} · {user.roleName}</span>
      </div>

      {/* Headline metrics */}
      <div className="dash-grid">
        <Metric accent="#7b53ff" icon="tag" label="Products · SKUs" sparkId="skus" variant="a"
          value={s.totalSkus.toLocaleString()} sub="Active catalog items" />
        <Metric accent="#4ea8f5" icon="boxes" label="On hand" sparkId="onhand" variant="b"
          value={onHand.toLocaleString()}
          sub={<><b>{reserved.toLocaleString()}</b> reserved · <b>{inTransit.toLocaleString()}</b> in transit</>} />
        <Metric accent="#3fbfa3" icon="gauge" label="Available" sparkId="avail" variant="a"
          value={available.toLocaleString()} sub={`${availPct}% of on-hand sellable`} />
        <Metric accent="#e2b24d" icon="coin" label="Inventory value" sparkId="value" variant="b"
          value={s.inventoryValue !== undefined ? peso(s.inventoryValue) : '—'}
          sub={s.inventoryValue !== undefined ? 'At current valuation' : 'Requires valuation access'} />
      </div>

      {/* Stock composition — real distribution across states */}
      <div className="section-eyebrow">Stock composition</div>
      <div className="card compo">
        <div className="bar">
          <span className="seg-avail" style={{ width: `${(available / compoTotal) * 100}%` }} />
          <span className="seg-resv" style={{ width: `${(reserved / compoTotal) * 100}%` }} />
          <span className="seg-transit" style={{ width: `${(inTransit / compoTotal) * 100}%` }} />
        </div>
        <div className="legend">
          <div className="leg" style={{ minWidth: 160 }}><span className="k" style={{ background: '#3fbfa3' }} /><span className="t">Available</span><span className="v">{available.toLocaleString()}</span></div>
          <div className="leg" style={{ minWidth: 160 }}><span className="k" style={{ background: '#4ea8f5' }} /><span className="t">Reserved</span><span className="v">{reserved.toLocaleString()}</span></div>
          <div className="leg" style={{ minWidth: 160 }}><span className="k" style={{ background: '#e2b24d' }} /><span className="t">In transit</span><span className="v">{inTransit.toLocaleString()}</span></div>
        </div>
      </div>

      {/* Needs attention */}
      <div className="section-eyebrow">Needs attention</div>
      <div className="dash-grid attn">
        <Attention label="To reorder" value={s.reorderCount} href="/reorder" tone={s.reorderCount > 0 ? 'warn' : 'ok'} />
        <Attention label="Low stock" value={s.lowStockCount} href="/analytics/stock-status" tone={s.lowStockCount > 0 ? 'warn' : 'ok'} />
        <Attention label="Out of stock" value={s.outOfStockCount} href="/analytics/stock-status" tone={s.outOfStockCount > 0 ? 'danger' : 'ok'} />
      </div>

      {/* Pending documents */}
      <div className="section-eyebrow">Pending documents</div>
      <div className="pending-strip">
        <Pending label="Receipts" value={s.pending.receipts} href="/receiving" />
        <Pending label="Releases" value={s.pending.releases} href="/releases" />
        <Pending label="Transfers" value={s.pending.transfers} href="/transfers" />
        <Pending label="Adjustments" value={s.pending.adjustments} href="/adjustments" />
        <Pending label="Counts" value={s.pending.counts} href="/counts" />
      </div>

      {/* Recent movements */}
      <div className="section-eyebrow">Recent movements</div>
      <div className="card" style={{ padding: 0 }}>
        {s.recentMovements.length === 0 ? (
          <div className="muted" style={{ padding: 24 }}>No movements yet.</div>
        ) : (
          <div className="table-wrap" style={{ border: 0, boxShadow: 'none', borderRadius: 16 }}>
            <table className="grid">
              <thead>
                <tr><th>Txn</th><th>Movement</th><th>SKU</th><th>Warehouse</th><th className="num">Qty</th><th>When</th></tr>
              </thead>
              <tbody>
                {s.recentMovements.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: 'var(--f-mono)', color: 'var(--muted)' }}>{m.txnNumber}</td>
                    <td><span className={`mv ${direction(m.movementType)}`}>{m.movementType.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td>{m.productSku}</td>
                    <td>{m.warehouseCode}</td>
                    <td className="num">{Number(m.quantity).toLocaleString()}</td>
                    <td style={{ color: 'var(--muted)' }}>{timeAgo(m.postedAt)}</td>
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

/** Distinct accent glyph per headline metric (matches the sidebar icon language). */
const METRIC_ICONS: Record<string, string> = {
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  boxes: '<path d="M3 8 12 4l9 4-9 4-9-4Z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
  gauge: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-3"/><circle cx="12" cy="15" r="1"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M14 10c0-1.1-.9-1.6-2-1.6s-2 .5-2 1.6.9 1.5 2 1.5 2 .5 2 1.5-.9 1.6-2 1.6-2-.5-2-1.6"/>',
};

function MetricIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: METRIC_ICONS[name] ?? '' }} />
  );
}

/**
 * Ambient accent flourish along the card floor. Deliberately decorative — the
 * dashboard is a live snapshot with no per-metric time series, so this asserts
 * no data points (no axis, ticks, or values); it is brand texture, not a chart.
 */
function Spark({ id, variant }: { id: string; variant: 'a' | 'b' }) {
  const line = variant === 'b'
    ? 'M0 34 C 45 22 80 40 120 30 S 200 40 240 24 S 285 18 300 22'
    : 'M0 40 C 40 30 72 44 110 32 S 195 18 235 30 S 288 20 300 24';
  return (
    <svg className="spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.30" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L300 60 L0 60 Z`} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ accent, icon, label, value, sub, sparkId, variant }: {
  accent: string; icon: string; label: string; value: ReactNode; sub: ReactNode; sparkId: string; variant: 'a' | 'b';
}) {
  return (
    <div className="card metric" style={{ ['--m' as string]: accent }}>
      <div className="metric-head">
        <span className="lbl">{label}</span>
        <span className="metric-ico"><MetricIcon name={icon} /></span>
      </div>
      <div className="val">{value}</div>
      <div className="sub">{sub}</div>
      <Spark id={sparkId} variant={variant} />
    </div>
  );
}

function Attention({ label, value, href, tone }: { label: string; value: number; href: string; tone: 'ok' | 'warn' | 'danger' }) {
  return (
    <Link href={href} className={`card attn-card ${tone}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value.toLocaleString()}</div>
      <span className="go">›</span>
    </Link>
  );
}

function Pending({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="pending-chip">
      <span className={`n ${value === 0 ? 'zero' : ''}`}>{value}</span>
      <span className="t">{label}</span>
    </Link>
  );
}

function num(v: string | number | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function peso(v: string): string {
  return num(v).toLocaleString(undefined, { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
}
/** Presentational direction hint from the movement type (cosmetic only). */
function direction(type: string): 'in' | 'out' | '' {
  const t = type.toUpperCase();
  if (/(RECEIPT|_IN\b|RETURN_RECEIPT|ADJUSTMENT_IN)/.test(t)) return 'in';
  if (/(RELEASE|_OUT\b|SALES|DAMAGE|DISPOSE|ADJUSTMENT_OUT)/.test(t)) return 'out';
  return '';
}
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

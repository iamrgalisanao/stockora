'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { MetricTrend, SupplierScorecardResponse } from '@iw/contracts';
import { api } from '../../../../../lib/api';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);
const scoreClass = (s: number | null) => (s === null ? '' : s >= 85 ? 'ok' : s >= 60 ? 'warn' : 'danger');

// Direction-aware delta: a numeric rise is not always "good".
function deltaView(t: MetricTrend) {
  if (t.delta === null) return { text: '—', cls: 'muted' };
  const improved = t.higherIsBetter ? t.delta > 0 : t.delta < 0;
  const arrow = t.delta > 0 ? '↑' : t.delta < 0 ? '↓' : '→';
  const cls = t.delta === 0 ? 'muted' : improved ? 'ok' : 'danger';
  const val = `${t.delta > 0 ? '+' : ''}${t.delta}${t.key === 'leadTime' ? 'd' : t.key === 'score' ? '' : '%'}`;
  return { text: `${arrow} ${val}`, cls };
}

export default function SupplierScorecardPage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [data, setData] = useState<SupplierScorecardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.supplierScorecard(id, { from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString() })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id, from, to]);

  const s = data?.supplier;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{s ? `${s.supplierCode} — ${s.supplierName}` : 'Supplier scorecard'}</h1>
        <Link className="btn secondary small" href="/suppliers/performance">← Comparison</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end', maxWidth: 360 }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {data && s && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, marginBottom: 12 }}>
            <div className="card" style={{ textAlign: 'center', minWidth: 180 }}>
              <div className="muted" style={{ fontSize: 12 }}>Overall score</div>
              <div style={{ fontSize: 44, fontWeight: 800 }}><span className={`badge ${scoreClass(s.performanceScore)}`}>{s.performanceScore ?? '—'}</span></div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                {s.receiptsCount} receipt(s) · {s.linesCount} line(s) · {s.sampleLabel.replace('_', ' ').toLowerCase()}
              </div>
            </div>
            <div className="card">
              <strong style={{ fontSize: 13 }}>Trend vs prior equal-length period</strong>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                {new Date(data.previousPeriod.start).toLocaleDateString()}–{new Date(data.previousPeriod.end).toLocaleDateString()} → {new Date(data.period.start).toLocaleDateString()}–{new Date(data.period.end).toLocaleDateString()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {data.trends.map((t) => {
                  const d = deltaView(t);
                  return (
                    <div key={t.key} style={{ border: '1px solid var(--line,#ddd)', borderRadius: 8, padding: 8 }}>
                      <div className="muted" style={{ fontSize: 11 }}>{t.label}</div>
                      <div style={{ fontWeight: 700 }}>{fmt(t.current, t.key === 'leadTime' ? 'd' : t.key === 'score' ? '' : '%')}</div>
                      <div className={d.cls} style={{ fontSize: 12 }}>{d.text} <span className="muted">vs {fmt(t.previous, t.key === 'leadTime' ? 'd' : t.key === 'score' ? '' : '%')}</span></div>
                      {(t.currentCoveragePct < 100 || t.previousCoveragePct < 100) && (
                        <div className="muted" style={{ fontSize: 10 }}>coverage {t.currentCoveragePct}% (was {t.previousCoveragePct}%)</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>Score components</strong>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="grid">
                <thead><tr><th>Metric</th><th className="num">Raw</th><th className="num">Sub-score</th><th className="num">Configured wt.</th><th className="num">Applied wt.</th></tr></thead>
                <tbody>
                  {s.components.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td className="num">{c.rawMetric ?? '—'}</td>
                      <td className="num">{c.subScore ?? <span className="muted">n/a</span>}</td>
                      <td className="num">{c.configuredWeight}</td>
                      <td className="num">{c.appliedWeight === 0 ? <span className="muted">dropped</span> : c.appliedWeight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <strong style={{ fontSize: 13 }}>By product</strong>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="grid">
                <thead><tr><th>Product</th><th className="num">Score</th><th className="num">Fill</th><th className="num">On-time</th><th className="num">Price var.</th><th className="num">Reject</th><th className="num">Received</th></tr></thead>
                <tbody>
                  {data.products.map((r) => (
                    <tr key={r.productId ?? r.supplierId}>
                      <td>{r.productSku} — {r.productName}</td>
                      <td className="num"><span className={`badge ${scoreClass(r.performanceScore)}`}>{r.performanceScore ?? '—'}</span></td>
                      <td className="num">{fmt(r.fillRatePct, '%')}</td>
                      <td className="num">{fmt(r.onTimeDeliveryPct, '%')}</td>
                      <td className="num">{r.priceVariancePct === null ? '—' : `${r.priceVariancePct > 0 ? '+' : ''}${r.priceVariancePct}%`}</td>
                      <td className="num">{r.returnRatePct}%</td>
                      <td className="num">{r.receivedQuantity}</td>
                    </tr>
                  ))}
                  {data.products.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 16 }}>No product data in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

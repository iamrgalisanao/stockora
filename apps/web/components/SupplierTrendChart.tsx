'use client';

import type { SupplierTrendSeriesResponse, SupplierTrendBucket } from '@iw/contracts';

const W = 280;
const H = 96;
const PAD = { l: 6, r: 6, t: 10, b: 14 };

type MetricKey = 'score' | 'fillRate' | 'onTime' | 'leadTime' | 'price' | 'quality';
const pick: Record<MetricKey, { get: (b: SupplierTrendBucket) => number | null; cov: (b: SupplierTrendBucket) => number; suffix: string }> = {
  score: { get: (b) => b.performanceScore, cov: () => 100, suffix: '' },
  fillRate: { get: (b) => b.fillRatePct, cov: (b) => b.coverage.fillRatePct, suffix: '%' },
  onTime: { get: (b) => b.onTimeDeliveryPct, cov: (b) => b.coverage.onTimePct, suffix: '%' },
  leadTime: { get: (b) => b.averageLeadTimeDays, cov: (b) => b.coverage.leadTimePct, suffix: 'd' },
  price: { get: (b) => b.priceVariancePct, cov: (b) => b.coverage.pricePct, suffix: '%' },
  quality: { get: (b) => b.returnRatePct, cov: () => 100, suffix: '%' },
};

function Chart({ series, metricKey, label, higherIsBetter }: { series: SupplierTrendSeriesResponse; metricKey: MetricKey; label: string; higherIsBetter: boolean }) {
  const cfg = pick[metricKey];
  const buckets = series.buckets;
  const vals = buckets.map(cfg.get);
  const present = vals.filter((v): v is number => v !== null);
  const min = present.length ? Math.min(...present) : 0;
  const max = present.length ? Math.max(...present) : 1;
  const span = max - min || 1;
  const n = buckets.length;
  const x = (i: number) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / span);
  const yCov = (c: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - c / 100);

  // Value polyline (break on nulls) + coverage faint line.
  const segments: string[] = [];
  let cur: string[] = [];
  vals.forEach((v, i) => {
    if (v === null) { if (cur.length) { segments.push(cur.join(' ')); cur = []; } return; }
    cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));
  const covLine = buckets.map((b, i) => `${x(i).toFixed(1)},${yCov(cfg.cov(b)).toFixed(1)}`).join(' ');
  const last = [...vals].reverse().find((v) => v !== null) ?? null;

  return (
    <div style={{ border: '1px solid var(--line,#ddd)', borderRadius: 8, padding: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{last === null ? '—' : `${last}${cfg.suffix}`}</span>
      </div>
      <div className="muted" style={{ fontSize: 10 }}>{higherIsBetter ? 'higher is better' : 'lower is better'}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ marginTop: 2 }}>
        {/* coverage (measurement quality) — faint */}
        <polyline points={covLine} fill="none" stroke="var(--ink-faint,#9aa)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        {/* value line + points */}
        {segments.map((s, i) => <polyline key={i} points={s} fill="none" stroke="var(--accent,#2e6e68)" strokeWidth="2" />)}
        {vals.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="var(--accent,#2e6e68)" />)}
      </svg>
    </div>
  );
}

export function SupplierTrendChart({ series }: { series: SupplierTrendSeriesResponse }) {
  const dir = Object.fromEntries(series.metrics.map((m) => [m.key, m.higherIsBetter]));
  const charts: Array<{ key: MetricKey; label: string }> = [
    { key: 'score', label: 'Overall score' },
    { key: 'fillRate', label: 'Fill rate' },
    { key: 'onTime', label: 'On-time delivery' },
    { key: 'leadTime', label: 'Lead time' },
    { key: 'price', label: 'Price variance' },
    { key: 'quality', label: 'Reject rate' },
  ];
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {series.granularity.toLowerCase()} buckets · dashed line = data coverage (measurement quality)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
        {charts.map((c) => <Chart key={c.key} series={series} metricKey={c.key} label={c.label} higherIsBetter={!!dir[c.key]} />)}
      </div>
    </div>
  );
}

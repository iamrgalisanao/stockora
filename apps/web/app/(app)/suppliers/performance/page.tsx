'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  PreferredSupplierComparisonResponse, ProductResponse, SupplierAnalyticsPolicyResponse,
  SupplierPerformanceResponse, WarehouseResponse,
} from '@iw/contracts';
import { api } from '../../../../lib/api';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const scoreClass = (s: number | null) => (s === null ? '' : s >= 85 ? 'ok' : s >= 60 ? 'warn' : 'danger');

export default function SupplierAnalyticsPage() {
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [data, setData] = useState<SupplierPerformanceResponse | null>(null);
  const [weights, setWeights] = useState<SupplierAnalyticsPolicyResponse | null>(null);
  const [weightMsg, setWeightMsg] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<PreferredSupplierComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);
  useEffect(() => { api.supplierWeights().then(setWeights).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      const range = { from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString(), warehouseId, productId };
      Promise.all([
        api.supplierPerformance(range).then(setData),
        api.preferredSupplierComparison({ from: range.from, to: range.to, warehouseId }).then(setPreferred).catch(() => setPreferred(null)),
      ])
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [from, to, warehouseId, productId, reloadKey]);

  const rows = useMemo(() => data?.suppliers ?? [], [data]);

  async function saveWeights() {
    if (!weights) return;
    setWeightMsg(null);
    try {
      const saved = await api.saveSupplierWeights({ fillRate: weights.fillRate, onTime: weights.onTime, leadTime: weights.leadTime, price: weights.price, quality: weights.quality });
      setWeights(saved);
      setWeightMsg('Saved — scores recalculated.');
      setReloadKey((k) => k + 1);
    } catch (e) {
      setWeightMsg(e instanceof Error ? e.message : 'Could not save weights');
    }
  }

  return (
    <div>
      <div className="topbar"><h1 className="h1">Supplier Analytics</h1></div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'end' }}>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All (my scope)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div><label>Product</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">All products</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
        </div>
        {data && (
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Metric coverage across these suppliers — on-time <strong>{data.coverage.onTimePct}%</strong> ·
            lead-time <strong>{data.coverage.leadTimePct}%</strong> · price <strong>{data.coverage.pricePct}%</strong>.
            Scores are weighted over the metrics each supplier actually has data for.
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Supplier</th>
                <th className="num">Score</th>
                <th className="num">Fill rate</th>
                <th className="num">On-time</th>
                <th className="num">Lead time</th>
                <th className="num">Price var.</th>
                <th className="num">Return rate</th>
                <th className="num">Receipts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.supplierId}>
                  <td><Link href={`/suppliers/performance/${r.supplierId}`}>{r.supplierCode} — {r.supplierName}</Link>{r.isPreferred ? <span className="badge ok" style={{ marginLeft: 6 }}>Preferred</span> : null} <span className="muted" style={{ fontSize: 10 }}>{r.sampleLabel.replace('_SAMPLE', '').toLowerCase()}</span></td>
                  <td className="num"><span className={`badge ${scoreClass(r.performanceScore)}`}>{r.performanceScore ?? '—'}</span></td>
                  <td className="num">{pct(r.fillRatePct)}</td>
                  <td className="num">{pct(r.onTimeDeliveryPct)}</td>
                  <td className="num">{r.averageLeadTimeDays === null ? '—' : `${r.averageLeadTimeDays}d`}</td>
                  <td className="num">{r.priceVariancePct === null ? '—' : `${r.priceVariancePct > 0 ? '+' : ''}${r.priceVariancePct}%`}</td>
                  <td className="num">{r.returnRatePct}%</td>
                  <td className="num">{r.receiptsCount}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>No posted receipts from suppliers in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Loading…</div>}
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Metrics use posted receipts only. A “—” means the metric had no data for that supplier in the period
          (it is excluded from the score, never counted as zero). Price is compared to each supplier’s quoted
          cost, not inventory WAC. Click a supplier for its scorecard, trends, and product breakdown.
        </p>
      </div>

      {/* Org score weights — relative; renormalized over the metrics each supplier has data for. */}
      {weights && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Score weights</strong>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            {weights.configured ? 'Organization-configured' : 'Built-in defaults'} · relative — need not sum to 1.
          </span>
          <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {(['fillRate', 'onTime', 'leadTime', 'price', 'quality'] as const).map((k) => (
              <div key={k}>
                <label style={{ fontSize: 12, textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</label>
                <input type="number" min="0" step="0.05" style={{ width: 90 }} value={weights[k]}
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
              </div>
            ))}
            <button className="btn" onClick={saveWeights}>Save weights</button>
          </div>
          {weightMsg && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{weightMsg}</div>}
        </div>
      )}

      {/* Advisory preferred-vs-observed comparison (never rewrites the stored preference). */}
      {preferred && preferred.rows.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Preferred supplier vs best observed</strong>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>Advisory — based on the operational preferred supplier per product/warehouse.</span>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="grid">
              <thead><tr><th>Product</th><th>Warehouse</th><th>Preferred</th><th className="num">Preferred score</th><th>Best observed</th><th className="num">Best score</th><th className="num">Δ</th></tr></thead>
              <tbody>
                {preferred.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.productSku}</td>
                    <td>{r.warehouseCode}</td>
                    <td>{r.preferredSupplierName}</td>
                    <td className="num">{r.preferredScore ?? '—'}</td>
                    <td>{r.bestSupplierName ?? '—'}</td>
                    <td className="num">{r.bestScore ?? '—'}</td>
                    <td className="num">{r.difference === null ? '—' : <span className={r.difference > 0 ? 'badge warn' : 'badge ok'}>{r.difference > 0 ? `+${r.difference}` : r.difference}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            A positive Δ means a qualified alternative outperformed the preferred supplier over this period.
            This is advisory only — it never changes the stored preferred supplier.
          </p>
        </div>
      )}
    </div>
  );
}

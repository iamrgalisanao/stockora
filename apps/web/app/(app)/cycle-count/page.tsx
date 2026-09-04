'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuthenticatedUser, CycleCountMetrics, WarehouseResponse } from '@iw/contracts';
import { api } from '../../../lib/api';

function Tile({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const inner = (
    <div className="card" style={{ margin: 0 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link> : inner;
}

export default function CycleCountDashboard() {
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [metrics, setMetrics] = useState<CycleCountMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.warehouses(), api.me()])
      .then(([w, u]) => {
        setWarehouses(w);
        setUser(u);
        const def = w.find((x) => x.isDefault) ?? w[0];
        if (def) setWarehouseId(def.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const load = useCallback(() => {
    if (!warehouseId) return;
    api.cycleCount.metrics(warehouseId)
      .then(setMetrics)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load metrics'));
  }, [warehouseId]);
  useEffect(load, [load]);

  const can = (p: string) => user?.permissions.includes(p as never) ?? false;
  const wq = warehouseId ? `?warehouseId=${warehouseId}` : '';

  async function act(fn: () => Promise<unknown>, done: (r: any) => string) {
    setBusy(true); setError(null); setMsg(null);
    try { const m = done(await fn()); setMsg(m); toast.success(m); load(); }
    catch (e) { const em = e instanceof Error ? e.message : 'Action failed'; setError(em); toast.error(em); }
    finally { setBusy(false); }
  }

  const m = metrics;
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Cycle Counting</h1>
        <Link className="btn secondary small" href={`/cycle-count/tasks${wq}`} style={{ marginTop: 0 }}>Open worklist</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'end', gap: 12 }}>
          <div style={{ minWidth: 240 }}>
            <label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          {can('cycle_count.classify') && (
            <button className="btn secondary" style={{ marginTop: 0 }} disabled={busy}
              onClick={() => act(() => api.cycleCount.classify(warehouseId), (r) => `Classified ${r.length} product(s) by movement velocity.`)}>
              Run ABC classification
            </button>
          )}
          {can('cycle_count.schedule') && (
            <button className="btn" style={{ marginTop: 0 }} disabled={busy}
              onClick={() => act(() => api.cycleCount.generate(warehouseId), (r) => `Generated ${r.length} due cycle-count task(s).`)}>
              Generate due tasks
            </button>
          )}
        </div>
        {msg && <div className="muted" style={{ marginTop: 10 }}>{msg}</div>}
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {!m ? <div className="card muted">Loading…</div> : (
        <>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Tile label="Due today" value={m.dueToday} href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=due`} />
            <Tile label="Overdue" value={m.overdue} href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=overdue`} />
            <Tile label="Assigned to me" value={m.assignedToMe} href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=mine`} />
            <Tile label="In progress" value={m.inProgress} href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=inprogress`} />
          </div>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12 }}>
            <Tile label="On-time coverage" value={pct(m.onTimeCoveragePct)} hint={`${m.completedOnTime}/${m.scheduledDueInPeriod} scheduled, on time`} />
            <Tile label="Count accuracy" value={pct(m.accuracyPct)} hint={`${m.postedCountsInPeriod} posted count(s)`} />
            <Tile label="Absolute variance" value={m.absoluteVarianceQty} hint="units, posted this period" />
            <Tile label="Variance value" value={m.varianceValue ?? '—'} hint={m.varianceValue ? 'net, this period' : 'requires cost.view'} />
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Period {new Date(m.periodFrom).toLocaleDateString()} – {new Date(m.periodTo).toLocaleDateString()} ·
              Completed this period: <strong>{m.completedThisPeriod}</strong> ·
              Coverage counts scheduled work only (ad-hoc &amp; recounts excluded).
            </div>
            <div className="toolbar" style={{ marginTop: 10, gap: 8 }}>
              <Link className="btn secondary small" href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=due`}>Due</Link>
              <Link className="btn secondary small" href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=overdue`}>Overdue</Link>
              <Link className="btn secondary small" href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=mine`}>My counts</Link>
              <Link className="btn secondary small" href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=inprogress`}>In progress</Link>
              <Link className="btn secondary small" href={`/cycle-count/tasks?warehouseId=${warehouseId}&view=completed`}>Completed</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

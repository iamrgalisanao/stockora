'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ABC_CLASSES, CYCLE_COUNT_SOURCES, CYCLE_COUNT_TASK_STATUSES,
  type AuthenticatedUser, type CycleCountTaskResponse, type WarehouseResponse,
} from '@iw/contracts';
import { api } from '../../../../lib/api';
import { AbcBadge, StatusBadge, TimingBadge } from '../../../../components/CycleCountBadges';

export default function CycleCountWorklist() {
  const params = useSearchParams();
  const view = params.get('view') ?? '';
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [rows, setRows] = useState<CycleCountTaskResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? '');
  const [status, setStatus] = useState(view === 'inprogress' ? 'IN_PROGRESS' : view === 'completed' ? 'COMPLETED' : '');
  const [abcClass, setAbcClass] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(view === 'overdue');
  const [mine, setMine] = useState(view === 'mine');
  const [dueNow, setDueNow] = useState(view === 'due');

  useEffect(() => {
    Promise.all([api.warehouses(), api.me()])
      .then(([w, u]) => {
        setWarehouses(w);
        setUser(u);
        if (!warehouseId) setWarehouseId((w.find((x) => x.isDefault) ?? w[0])?.id ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    const filters: Record<string, string> = {};
    if (warehouseId) filters.warehouseId = warehouseId;
    if (status) filters.status = status;
    if (abcClass) filters.abcClass = abcClass;
    if (source) filters.source = source;
    if (q.trim()) filters.q = q.trim();
    if (overdueOnly) filters.overdue = 'true';
    if (mine && user) filters.assignedToId = user.id;
    const t = setTimeout(() => {
      api.cycleCount.tasks(filters)
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [warehouseId, status, abcClass, source, q, overdueOnly, mine, user]);

  const shown = useMemo(() => {
    if (!dueNow) return rows;
    const now = Date.now();
    const active = new Set(['PENDING', 'ASSIGNED', 'IN_PROGRESS']);
    return rows.filter((r) => active.has(r.status) && new Date(r.dueAt).getTime() <= now);
  }, [rows, dueNow]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Cycle-count worklist</h1>
        <Link className="btn secondary small" href="/cycle-count" style={{ marginTop: 0 }}>Dashboard</Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'end' }}>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Any (my scope)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </div>
          <div><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {CYCLE_COUNT_TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div><label>ABC class</label>
            <select value={abcClass} onChange={(e) => setAbcClass(e.target.value)}>
              <option value="">Any</option>
              {ABC_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Any</option>
              {CYCLE_COUNT_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, product or lot #" /></div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={dueNow} onChange={(e) => setDueNow(e.target.checked)} /> Due now (active)</label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : shown.length === 0 ? <div className="card muted">No tasks match.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Product</th><th>Lot</th><th>Warehouse</th><th>ABC</th>
                <th>Status</th><th>Timing</th><th>Due</th><th>Assignee</th><th>Source</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/cycle-count/tasks/${r.id}`}>{r.productSku}</Link> — {r.productName}</td>
                  <td>{r.lotNumber ? <Link href={`/lots/${r.lotId}`}>{r.lotNumber}</Link> : <span className="muted">—</span>}</td>
                  <td>{r.warehouseCode}</td>
                  <td><AbcBadge abcClass={r.abcClass} /></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td><TimingBadge overdue={r.overdue} /></td>
                  <td>{new Date(r.dueAt).toLocaleDateString()}</td>
                  <td>{r.assignedToName ?? <span className="muted">—</span>}</td>
                  <td className="muted">{r.source.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

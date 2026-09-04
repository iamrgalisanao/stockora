'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { AuthenticatedUser, CycleCountTaskResponse, MembershipUserResponse } from '@iw/contracts';
import { api } from '../../../../../lib/api';
import { AbcBadge, StatusBadge, TimingBadge } from '../../../../../components/CycleCountBadges';

const ACTIVE = new Set(['PENDING', 'ASSIGNED', 'IN_PROGRESS']);

export default function CycleCountTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<CycleCountTaskResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [members, setMembers] = useState<MembershipUserResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.cycleCount.task(id), api.me()])
      .then(([t, u]) => { setTask(t); setUser(u); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(load, [load]);
  // Best-effort member list for assigning to others (needs user.manage; falls back to "Assign to me").
  useEffect(() => { api.members().then((m) => setMembers(m.filter((x) => x.status === 'ACTIVE'))).catch(() => {}); }, []);

  const can = (p: string) => user?.permissions.includes(p as never) ?? false;

  async function act(fn: () => Promise<CycleCountTaskResponse>) {
    setBusy(true); setError(null);
    try { const t = await fn(); setTask(t); toast.success(`Task ${t.status.replace(/_/g, ' ').toLowerCase()}`); }
    catch (e) { const m = e instanceof Error ? e.message : 'Action failed'; setError(m); toast.error(m); }
    finally { setBusy(false); }
  }

  async function startAndOpen() {
    setBusy(true); setError(null);
    try {
      const t = await api.cycleCount.start(id);
      setTask(t);
      toast.success('Count started');
      if (t.physicalCountId) router.push(`/counts/${t.physicalCountId}`);
    } catch (e) { const m = e instanceof Error ? e.message : 'Could not start the count'; setError(m); toast.error(m); setBusy(false); }
  }

  if (error && !task) return <div className="card error">{error}</div>;
  if (!task || !user) return <div className="card muted">Loading…</div>;

  const t = task;
  const freq = t.policyContext
    ? t.abcClass === 'A' ? t.policyContext.aFrequencyDays : t.abcClass === 'B' ? t.policyContext.bFrequencyDays : t.policyContext.cFrequencyDays
    : null;
  const why =
    t.source === 'SCHEDULED' && freq != null ? `ABC ${t.abcClass} · scheduled every ${freq} days`
    : t.source === 'RECOUNT' ? 'Recount of a previously completed task'
    : 'Ad-hoc count';

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{t.productSku}</h1>
        <Link className="btn secondary small" href="/cycle-count/tasks" style={{ marginTop: 0 }}>Back to worklist</Link>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <AbcBadge abcClass={t.abcClass} />
          <StatusBadge status={t.status} />
          <TimingBadge overdue={t.overdue} />
          <span className="muted">{t.productName}</span>
        </div>

        {/* Why this is being counted — context, not an arbitrary task. */}
        <div className="card" style={{ background: 'var(--card-2, #fafafa)', marginTop: 12 }}>
          <div style={{ fontWeight: 600 }}>{why}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Due {new Date(t.dueAt).toLocaleDateString()}{t.overdue ? ' — overdue' : ''}</div>
        </div>

        <dl className="kv" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', marginTop: 14 }}>
          <dt className="muted">Warehouse</dt><dd>{t.warehouseCode}</dd>
          <dt className="muted">Product</dt><dd>{t.productSku} — {t.productName}</dd>
          {t.lotId
            ? (<><dt className="muted">Lot</dt><dd><Link href={`/lots/${t.lotId}`}>{t.lotNumber}</Link></dd></>)
            : null /* non-batch task: no lot UI at all */}
          <dt className="muted">Timing</dt><dd>{t.overdue ? <span className="badge danger">OVERDUE</span> : 'On track'} <span className="muted" style={{ marginLeft: 8 }}>(status is {t.status.replace(/_/g, ' ')})</span></dd>
          <dt className="muted">Assignee</dt><dd>{t.assignedToName ?? <span className="muted">Unassigned</span>}</dd>
          <dt className="muted">Source</dt><dd>{t.source.replace(/_/g, ' ')}</dd>
          {t.policyContext && (<><dt className="muted">Policy snapshot</dt><dd className="muted" style={{ fontSize: 13 }}>{t.policyContext.strategy.replace(/_/g, ' ')} · A {t.policyContext.aFrequencyDays}d / B {t.policyContext.bFrequencyDays}d / C {t.policyContext.cFrequencyDays}d · lookback {t.policyContext.lookbackDays}d</dd></>)}
          <dt className="muted">Linked count</dt><dd>{t.physicalCountId ? <Link href={`/counts/${t.physicalCountId}`}>Open stock count</Link> : <span className="muted">Not started</span>}</dd>
        </dl>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
          {ACTIVE.has(t.status) && can('inventory.count') && (
            t.status === 'IN_PROGRESS' && t.physicalCountId
              ? <button className="btn" disabled={busy} onClick={() => router.push(`/counts/${t.physicalCountId}`)}>Continue count</button>
              : <button className="btn" disabled={busy} onClick={startAndOpen}>Start count</button>
          )}
          {t.status === 'COMPLETED' && (
            <>
              {t.physicalCountId && <Link className="btn secondary" href={`/counts/${t.physicalCountId}`} style={{ marginTop: 0 }}>View posted count</Link>}
              {can('cycle_count.schedule') && <button className="btn secondary" disabled={busy} onClick={() => act(() => api.cycleCount.recount(id))}>Recount</button>}
            </>
          )}
          {ACTIVE.has(t.status) && can('cycle_count.assign') && (
            <button className="btn secondary" disabled={busy} onClick={() => act(() => api.cycleCount.assign(id, user.id))}>Assign to me</button>
          )}
          {ACTIVE.has(t.status) && can('cycle_count.assign') && members.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) act(() => api.cycleCount.assign(id, e.target.value)); }}
              style={{ maxWidth: 220 }}
            >
              <option value="">Assign to…</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>
          )}
          {ACTIVE.has(t.status) && can('cycle_count.schedule') && (
            <button className="btn secondary" disabled={busy}
              onClick={() => { if (window.confirm(t.physicalCountId ? 'Cancel this task and its in-progress count?' : 'Cancel this task?')) act(() => api.cycleCount.cancel(id)); }}>
              Cancel task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser, OutboxEventListItem, OutboxHealthResponse } from '@iw/contracts';
import { api } from '../../../lib/api';

const STATUS_CLS: Record<string, string> = {
  PENDING: 'muted', PROCESSING: 'warn', PUBLISHED: 'ok', FAILED: 'warn', DEAD_LETTER: 'danger',
};

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function OutboxOpsPage() {
  const [health, setHealth] = useState<OutboxHealthResponse | null>(null);
  const [events, setEvents] = useState<OutboxEventListItem[]>([]);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.outbox.health(), api.outbox.events(50), api.me()])
      .then(([h, e, u]) => { setHealth(h); setEvents(e); setUser(u); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);
  useEffect(load, [load]);

  const canRetry = user?.permissions.includes('settings.manage' as never) ?? false;

  async function retry(id: string) {
    setBusy(true); setError(null);
    try { await api.outbox.retry(id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Retry failed'); }
    finally { setBusy(false); }
  }

  const h = health;
  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Outbox Operations</h1>
        <button className="btn secondary small" style={{ marginTop: 0 }} onClick={load}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}
      {!h ? <div className="card muted">Loading…</div> : (
        <>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Tile label="Pending" value={h.pending} />
            <Tile label="Retrying" value={h.retrying} />
            <Tile label="Processing" value={h.processing} hint={h.expiredLeaseCount > 0 ? `${h.expiredLeaseCount} lease(s) expired` : undefined} />
            <Tile label="Dead-letter" value={h.deadLetter} />
          </div>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
            <Tile label="Published" value={h.published} />
            <Tile label="Oldest pending" value={h.oldestPendingAgeSeconds == null ? '—' : `${h.oldestPendingAgeSeconds}s`} />
            <Tile label="Last published" value={h.lastPublishedAt ? new Date(h.lastPublishedAt).toLocaleString() : '—'} />
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 8 }}>Recent events</div>
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr><th>Time</th><th>Event type</th><th>Aggregate</th><th>Status</th><th className="num">Attempts</th><th>Correlation</th><th>Last error</th><th></th></tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{new Date(e.occurredAt).toLocaleString()}</td>
                      <td>{e.eventType}</td>
                      <td className="muted">{e.aggregateType} · {e.aggregateId.slice(0, 8)}</td>
                      <td><span className={`badge ${STATUS_CLS[e.status] ?? 'muted'}`}>{e.status.replace(/_/g, ' ')}</span></td>
                      <td className="num">{e.attemptCount}</td>
                      <td className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.correlationId ? e.correlationId.slice(0, 8) : '—'}</td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.lastError ?? ''}</td>
                      <td>
                        {(e.status === 'DEAD_LETTER' || e.status === 'FAILED') && canRetry && (
                          <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => retry(e.id)}>Retry</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 && <tr><td colSpan={8} className="muted">No events yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

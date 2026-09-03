'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NotificationResponse, NotificationSeverity } from '@iw/contracts';
import { api } from '../../../lib/api';

// User-facing email delivery state — modest wording, no provider internals.
const EMAIL_LABEL: Record<string, string> = { PENDING: 'Email: queued', PROCESSING: 'Email: sending', SENT: 'Email: sent', FAILED: 'Email: retrying', DEAD_LETTER: 'Email: failed', SKIPPED: 'Email: skipped' };

const SEV_CLS: Record<NotificationSeverity, string> = { INFO: 'muted', WARNING: 'warn', CRITICAL: 'danger' };
// Where each entity type opens to.
const LINK: Record<string, (id: string) => string> = {
  lot: (id) => `/lots/${id}`,
  cycle_count_task: (id) => `/cycle-count/tasks/${id}`,
};

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationResponse[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.notifications.list(unreadOnly)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [unreadOnly]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }

  function open(n: NotificationResponse) {
    if (!n.readAt) api.notifications.read(n.id).catch(() => {});
    const to = n.entityType && n.entityId ? LINK[n.entityType]?.(n.entityId) : undefined;
    if (to) router.push(to);
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Notifications</h1>
        <div className="toolbar" style={{ gap: 8, marginTop: 0 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
          <Link className="btn secondary small" href="/notifications/preferences" style={{ marginTop: 0 }}>Preferences</Link>
          <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => act(() => api.notifications.readAll())}>Mark all read</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : items.length === 0 ? <div className="card muted">No notifications.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((n) => (
            <div key={n.id} className="card" style={{ margin: 0, opacity: n.readAt ? 0.7 : 1, borderLeft: `3px solid var(--${n.severity === 'CRITICAL' ? 'danger' : n.severity === 'WARNING' ? 'warn' : 'line'}, #ccc)` }}>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <span className={`badge ${SEV_CLS[n.severity]}`}>{n.severity}</span>
                <strong style={{ cursor: n.entityId ? 'pointer' : 'default' }} onClick={() => open(n)}>{n.title}</strong>
                {!n.readAt && <span className="badge ok" style={{ fontSize: 10 }}>NEW</span>}
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: 4 }}>{n.message}</div>
              {n.emailStatus && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{EMAIL_LABEL[n.emailStatus] ?? `Email: ${n.emailStatus}`}</div>}
              <div className="toolbar" style={{ gap: 8, marginTop: 8 }}>
                {n.entityId && LINK[n.entityType ?? ''] && <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => open(n)}>Open</button>}
                {!n.readAt && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => act(() => api.notifications.read(n.id))}>Mark read</button>}
                <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => act(() => api.notifications.dismiss(n.id))}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, CRITICAL_IN_APP_TYPES, type NotificationPreferenceResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

export default function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<NotificationPreferenceResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.notifications.preferences().then(setPrefs).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const emailEnabled = (type: string) => prefs.some((p) => p.notificationType === type && p.channel === 'EMAIL' && p.enabled);

  async function toggleEmail(type: string, enabled: boolean) {
    setBusy(type); setError(null);
    try { await api.notifications.setPreference(type, 'EMAIL', enabled); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Notification Preferences</h1>
        <Link className="btn secondary small" href="/notifications" style={{ marginTop: 0 }}>Back to notifications</Link>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Critical operational alerts always appear in-app and cannot be turned off. Email is strictly opt-in.
      </p>
      {error && <div className="error">{error}</div>}
      {loading ? <div className="card muted">Loading…</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Notification</th><th>In-app</th><th>Email</th></tr></thead>
            <tbody>
              {NOTIFICATION_TYPES.map((type) => {
                const critical = CRITICAL_IN_APP_TYPES.includes(type);
                return (
                  <tr key={type}>
                    <td>{NOTIFICATION_TYPE_LABELS[type]}</td>
                    <td>{critical ? <span title="Cannot be disabled">On 🔒</span> : 'On'}</td>
                    <td>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" style={{ width: 'auto' }} disabled={busy === type} checked={emailEnabled(type)} onChange={(e) => toggleEmail(type, e.target.checked)} />
                        {emailEnabled(type) ? 'On' : 'Off'}
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

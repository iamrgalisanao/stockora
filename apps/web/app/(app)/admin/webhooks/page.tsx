'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useState } from 'react';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, type OrganizationWebhookConfigResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

export default function WebhookIntegrationPage() {
  const [config, setConfig] = useState<OrganizationWebhookConfigResponse | null>(null);
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.notifications.webhook.get()
      .then((c) => { setConfig(c); setUrl(c.url ?? ''); setEnabled(c.enabled); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);
  useEffect(load, [load]);

  const subscribed = (type: string) => config?.subscriptions.some((s) => s.notificationType === type && s.enabled) ?? false;

  async function saveConfig() {
    setBusy(true); setError(null); setMsg(null);
    try {
      // Send signingSecret only when the admin typed one (blank = leave unchanged).
      const body: { url: string; enabled: boolean; signingSecret?: string } = { url, enabled };
      if (secret) body.signingSecret = secret;
      const c = await api.notifications.webhook.save(body);
      setConfig(c); setSecret(''); setMsg('Saved.'); toast.success('Webhook integration saved');
    } catch (e) { const m = e instanceof Error ? e.message : 'Save failed'; setError(m); toast.error(m); }
    finally { setBusy(false); }
  }

  async function toggleSub(type: string, on: boolean) {
    setBusy(true); setError(null);
    try { setConfig(await api.notifications.webhook.setSubscription(type, on)); toast.success(`${type} ${on ? 'subscribed' : 'unsubscribed'}`); }
    catch (e) { const m = e instanceof Error ? e.message : 'Update failed'; setError(m); toast.error(m); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="topbar"><h1 className="h1">Webhook Integration</h1></div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Send notification events to an organization endpoint. Payloads are signed with HMAC-SHA256 when a
        signing secret is set (header <code>X-Inventory-Signature</code>).
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card muted" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'end' }}>
          <div><label>Endpoint URL</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/inventory" /></div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Signing secret {config?.hasSigningSecret && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={config?.hasSigningSecret ? '••••••••' : 'optional'} />
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" disabled={busy || !url} onClick={saveConfig}>Save</button>
        </div>
      </div>

      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>Events sent to this endpoint</div>
        {NOTIFICATION_TYPES.map((type) => (
          <label key={type} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
            <input type="checkbox" style={{ width: 'auto' }} disabled={busy} checked={subscribed(type)} onChange={(e) => toggleSub(type, e.target.checked)} />
            {NOTIFICATION_TYPE_LABELS[type]}
          </label>
        ))}
      </div>
    </div>
  );
}

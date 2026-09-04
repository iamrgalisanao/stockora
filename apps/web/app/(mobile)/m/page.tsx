'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, clearToken, getToken } from '../../../lib/api';
import {
  APP_VERSION,
  getDeviceId,
  offlineAuthState,
  probeConnectivity,
  refreshIdentity,
  registerServiceWorker,
  requestPersistentStorage,
  wipeUserData,
  type PersistResult,
} from '../../../lib/mobile';
import { MobileHeader } from '../../../components/mobile/MobileHeader';

const WORKFLOWS = [
  { href: '/m/receive', label: 'Receive', hint: 'Goods against a receipt' },
  { href: '/m/pick', label: 'Pick', hint: 'Issue an approved release' },
  { href: '/m/transfer', label: 'Transfer', hint: 'Dispatch / receive stock' },
  { href: '/m/count', label: 'Count', hint: 'Cycle & physical counts' },
  { href: '/m/return', label: 'Return', hint: 'Intake into quarantine' },
];

function versionLt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** Mobile home — task menu + survivability banners (2D.6D, ADR 0014). */
export default function MobileHome() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [persist, setPersist] = useState<PersistResult | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!getToken()) return;
    registerServiceWorker().catch(() => {});
    getDeviceId().catch(() => {});
    requestPersistentStorage().then(setPersist).catch(() => setPersist('unsupported'));
    refreshIdentity().catch(() => {});
    offlineAuthState().then((s) => setAuthExpired(!s.ok)).catch(() => {});
    // Compatibility gate: if this build is below the server minimum, warn + block work until updated.
    probeConnectivity().then(({ health }) => { if (health) setStale(versionLt(APP_VERSION, health.minAppVersion)); }).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    await wipeUserData().catch(() => {}); // no prior-user work left on the device (ADR 0014 §13)
    clearToken();
    router.replace('/login');
  }, [router]);

  // Until mounted, render a deterministic placeholder so SSR and the first client render match (avoids a
  // hydration mismatch; getToken()/browser APIs are only meaningful client-side).
  if (!mounted) {
    return (
      <div>
        <p className="m-title">IW Scanner</p>
        <p className="m-sub">Starting…</p>
      </div>
    );
  }

  if (!getToken()) {
    return (
      <div>
        <p className="m-title">IW Scanner</p>
        <div className="m-banner">Sign in on the main app first, then reopen the scanner.</div>
        <a className="m-btn" href="/login">Go to sign in</a>
      </div>
    );
  }

  return (
    <div>
      <MobileHeader />

      {stale && (
        <div className="m-banner">
          This scanner app is out of date and the server will refuse its commands. Reload to update before
          capturing more work.
          <button className="m-btn" style={{ marginTop: 10 }} onClick={() => window.location.reload()}>Reload to update</button>
        </div>
      )}
      {authExpired && (
        <div className="m-banner">
          Offline authorization has expired. Capture is read-only until you reconnect and your access is
          revalidated. Queued work is safe.
        </div>
      )}
      {persist && persist !== 'persisted' && (
        <div className="m-banner">
          This device hasn&apos;t granted persistent storage, so the browser could evict local work under
          pressure. Sync often, and keep queued work small.
        </div>
      )}

      <p className="m-title" style={{ marginTop: 12 }}>Warehouse tasks</p>
      <p className="m-sub">Scan-first work. Captured work is queued and applied by the server — never committed on the device.</p>
      <div className="m-grid">
        {WORKFLOWS.map((w) => (
          <Link key={w.href} href={w.href} className="m-card m-tile">
            <div className="m-tile-label">{w.label}</div>
            <div className="m-sub" style={{ margin: 0 }}>{w.hint}</div>
          </Link>
        ))}
      </div>
      <div className="m-grid" style={{ marginTop: 4 }}>
        <Link href="/m/pending" className="m-card m-tile"><div className="m-tile-label">Pending Sync</div><div className="m-sub" style={{ margin: 0 }}>Queue & retry</div></Link>
        <Link href="/m/conflicts" className="m-card m-tile"><div className="m-tile-label">Conflicts</div><div className="m-sub" style={{ margin: 0 }}>Resolve or discard</div></Link>
        <Link href="/m/status" className="m-card m-tile"><div className="m-tile-label">Device Status</div><div className="m-sub" style={{ margin: 0 }}>Foundation & sync health</div></Link>
      </div>

      <button className="m-btn secondary" style={{ marginTop: 16 }} onClick={signOut}>Sign out &amp; wipe this device</button>
    </div>
  );
}

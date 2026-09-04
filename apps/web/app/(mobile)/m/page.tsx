'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { getToken } from '../../../lib/api';
import { getDeviceId, refreshIdentity, registerServiceWorker, requestPersistentStorage } from '../../../lib/mobile';
import { MobileHeader } from '../../../components/mobile/MobileHeader';

const WORKFLOWS = [
  { href: '/m/receive', label: 'Receive', hint: 'Goods against a receipt' },
  { href: '/m/pick', label: 'Pick', hint: 'Issue an approved release' },
  { href: '/m/transfer', label: 'Transfer', hint: 'Dispatch / receive stock' },
  { href: '/m/count', label: 'Count', hint: 'Cycle & physical counts' },
  { href: '/m/return', label: 'Return', hint: 'Intake into quarantine' },
];

/** Mobile home — task-oriented menu (2D.6B, ADR 0014). Boots the PWA foundation (SW, device id, identity). */
export default function MobileHome() {
  useEffect(() => {
    if (!getToken()) return;
    registerServiceWorker().catch(() => {});
    getDeviceId().catch(() => {});
    requestPersistentStorage().catch(() => {});
    refreshIdentity().catch(() => {});
  }, []);

  if (typeof window !== 'undefined' && !getToken()) {
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
      <p className="m-title" style={{ marginTop: 12 }}>Warehouse tasks</p>
      <p className="m-sub">Scan-first work. Captured work is queued and synced — never committed on the device.</p>
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
        <Link href="/m/conflicts" className="m-card m-tile"><div className="m-tile-label">Conflicts</div><div className="m-sub" style={{ margin: 0 }}>Resolved in 2D.6C</div></Link>
        <Link href="/m/status" className="m-card m-tile"><div className="m-tile-label">Device Status</div><div className="m-sub" style={{ margin: 0 }}>Foundation & sync health</div></Link>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ConnectivityState } from '@iw/contracts';
import { ConnectivityController, countByState, pendingCount } from '../../lib/mobile';

/**
 * Shared mobile header (2D.6B) — always shows proven connectivity and how much work is waiting to sync, so an
 * operator can never mistake captured-but-unsynced work for committed. Poll-light; refreshes on focus.
 */
export function MobileHeader({ title, back }: { title?: string; back?: boolean }) {
  const [conn, setConn] = useState<ConnectivityState>('CONNECTING');
  const [pending, setPending] = useState(0);
  const [attention, setAttention] = useState(0);
  const ctrl = useRef<ConnectivityController | null>(null);

  useEffect(() => {
    const c = new ConnectivityController();
    ctrl.current = c;
    const unsub = c.subscribe((s) => setConn(s.state));
    c.start();
    const tick = () => {
      pendingCount().then(setPending).catch(() => {});
      // Attention = anything needing the operator: conflicts, rejections, and transport failures.
      Promise.all([countByState('CONFLICT'), countByState('REJECTED'), countByState('FAILED')])
        .then(([c, r, f]) => setAttention(c + r + f)).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { unsub(); c.stop(); clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const connKlass = conn === 'ONLINE' ? 'ok' : conn === 'DEGRADED' ? 'warn' : conn === 'CONNECTING' ? 'neutral' : 'bad';

  return (
    <div className="m-header">
      <div className="m-header-l">
        {back && <Link href="/m" className="m-link">‹ Home</Link>}
        <span className="m-header-title">{title ?? 'IW Scanner'}</span>
      </div>
      <div className="m-header-r">
        <Link href="/m/pending" className={`m-pill ${pending > 0 ? 'warn' : 'ok'}`} style={{ textDecoration: 'none' }}>⏳ {pending}</Link>
        {attention > 0 && <Link href="/m/conflicts" className="m-pill bad" style={{ textDecoration: 'none' }}>⚠ {attention}</Link>}
        <span className={`m-pill ${connKlass}`}><span className="m-dot" />{conn}</span>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectivityState, MobileHealthResponse, PendingCommand, ScannerCapabilities } from '@iw/contracts';
import { getToken } from '../../../../lib/api';
import {
  APP_VERSION,
  ConnectivityController,
  MobileChannel,
  WakeLockController,
  captureCommand,
  countByState,
  detectScannerCapabilities,
  estimateStorage,
  getDeviceId,
  idbClearAll,
  isSyncLockHeld,
  listCommands,
  pendingCount,
  preferredAdapter,
  registerServiceWorker,
  requestPersistentStorage,
  wakeLockAvailable,
  webLocksAvailable,
  withSyncLock,
  type PersistResult,
  type SwUpdateHandle,
} from '../../../../lib/mobile';

type ConnLabel = { state: ConnectivityState; klass: string };

function connClass(state: ConnectivityState): string {
  return state === 'ONLINE' ? 'ok' : state === 'DEGRADED' ? 'warn' : state === 'CONNECTING' ? 'neutral' : 'bad';
}

function bytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 2D.6A foundation status screen. Not a workflow — it exercises and surfaces every foundation capability so
 * the DoD is verifiable at a glance: install/shell, device identity, local persistence, one sync owner,
 * proven connectivity, service-worker update safety, and feature-detected scanner/wake-lock adapters.
 */
export default function MobileFoundationPage() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [persist, setPersist] = useState<PersistResult | null>(null);
  const [storage, setStorage] = useState<{ usageBytes: number | null; quotaBytes: number | null }>({ usageBytes: null, quotaBytes: null });
  const [conn, setConn] = useState<ConnLabel>({ state: 'CONNECTING', klass: 'neutral' });
  const [health, setHealth] = useState<MobileHealthResponse | null>(null);
  const [caps, setCaps] = useState<ScannerCapabilities | null>(null);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [syncOwner, setSyncOwner] = useState<boolean>(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [update, setUpdate] = useState<SwUpdateHandle | null>(null);
  const [swReady, setSwReady] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<PendingCommand[]>([]);
  const [busy, setBusy] = useState(false);

  const connRef = useRef<ConnectivityController | null>(null);
  const channelRef = useRef<MobileChannel | null>(null);
  const wakeRef = useRef<WakeLockController | null>(null);

  const refreshJournal = useCallback(async () => {
    try {
      const [p, c, list] = await Promise.all([pendingCount(), countByState('CONFLICT'), listCommands()]);
      setPending(p);
      setConflicts(c);
      setRecent(list.slice(0, 5));
    } catch {
      /* IndexedDB unavailable — leave zeros */
    }
  }, []);

  useEffect(() => {
    setHasToken(!!getToken());
    const caps0 = detectScannerCapabilities();
    setCaps(caps0);

    // Device identity + local durability.
    getDeviceId().then(setDeviceId).catch(() => setDeviceId(null));
    requestPersistentStorage().then(setPersist).catch(() => setPersist('unsupported'));
    estimateStorage().then(setStorage).catch(() => {});
    refreshJournal();
    isSyncLockHeld().then(setSyncOwner).catch(() => {});

    // Service worker + safe-update detection.
    registerServiceWorker((handle) => setUpdate(handle))
      .then((reg) => setSwReady(!!reg))
      .catch(() => setSwReady(false));

    // Proven connectivity.
    const controller = new ConnectivityController();
    connRef.current = controller;
    const unsub = controller.subscribe((snap) => {
      setConn({ state: snap.state, klass: connClass(snap.state) });
      setHealth(snap.health);
    });
    controller.start();

    // Cross-context coordination.
    const channel = new MobileChannel();
    channelRef.current = channel;
    const offCh = channel.on((msg) => {
      if (msg.type === 'COMMAND_SYNCED' || msg.type === 'COMMAND_CONFLICT') refreshJournal();
    });

    wakeRef.current = new WakeLockController();

    return () => {
      unsub();
      controller.stop();
      offCh();
      channel.close();
      void wakeRef.current?.disable();
    };
  }, [refreshJournal]);

  const captureDemo = useCallback(async () => {
    if (!health) return;
    setBusy(true);
    try {
      await captureCommand({
        deviceId: deviceId ?? 'unknown',
        organizationId: health.organizationId,
        warehouseId: health.warehouseScope?.[0] ?? 'default',
        userId: health.userId,
        commandType: 'COUNT_SUBMIT',
        payload: { selfTest: true, note: 'foundation self-test — not a real workflow command' },
      });
      channelRef.current?.post({ type: 'COMMAND_SYNCED', commandId: 'self-test', at: Date.now() });
      await refreshJournal();
    } finally {
      setBusy(false);
    }
  }, [health, deviceId, refreshJournal]);

  const clearJournal = useCallback(async () => {
    setBusy(true);
    try {
      await idbClearAll();
      await refreshJournal();
      // Device id was wiped too — re-establish it.
      setDeviceId(await getDeviceId());
    } finally {
      setBusy(false);
    }
  }, [refreshJournal]);

  const becomeOwner = useCallback(async () => {
    channelRef.current?.post({ type: 'SYNC_STARTED', at: Date.now() });
    await withSyncLock(async () => {
      setSyncOwner(true);
      // Hold briefly so a second tab observes the lock as unavailable (demonstrates single-owner election).
      await new Promise((r) => setTimeout(r, 1500));
    });
    setSyncOwner(await isSyncLockHeld());
  }, []);

  const toggleWake = useCallback(async () => {
    const ctl = wakeRef.current;
    if (!ctl) return;
    if (wakeOn) {
      await ctl.disable();
      setWakeOn(false);
    } else {
      setWakeOn(await ctl.enable());
    }
  }, [wakeOn]);

  const activateUpdate = useCallback(() => {
    if (!update) return;
    if (pending > 0) return; // never destroy unsynced work (ADR 0014 §14)
    update.activateUpdate();
  }, [update, pending]);

  const adapter = useMemo(() => (caps ? preferredAdapter(caps) : null), [caps]);

  // Until the mount effect runs, render a deterministic placeholder. Everything below depends on browser-only
  // APIs (navigator.locks, wakeLock, IndexedDB) that don't exist during SSR — gating on this initial `null`
  // keeps the first client render identical to the server's and avoids a hydration mismatch.
  if (hasToken === null) {
    return (
      <div>
        <p className="m-title">IW Scanner</p>
        <p className="m-sub">Starting…</p>
      </div>
    );
  }

  if (hasToken === false) {
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
      <p className="m-title">IW Scanner</p>
      <p className="m-sub">Foundation status · build {APP_VERSION}</p>

      {update && (
        <div className="m-banner">
          A new app version is ready.{' '}
          {pending > 0
            ? `Sync your ${pending} pending item(s) first — updating now would discard unsynced work.`
            : 'Safe to update.'}
          <button className="m-btn" style={{ marginTop: 10 }} disabled={pending > 0} onClick={activateUpdate}>
            Update &amp; reload
          </button>
        </div>
      )}

      <div className="m-card">
        <h2>Connectivity</h2>
        <div className="m-row">
          <span className="k">Server (proven)</span>
          <span className="v"><span className={`m-pill ${conn.klass}`}><span className="m-dot" />{conn.state}</span></span>
        </div>
        <div className="m-row"><span className="k">Session user</span><span className="v m-mono">{health?.userId ?? '—'}</span></div>
        <div className="m-row"><span className="k">Warehouse scope</span><span className="v">{health ? (health.warehouseScope ? `${health.warehouseScope.length} allowed` : 'all') : '—'}</span></div>
        <div className="m-row"><span className="k">Server schema / min build</span><span className="v">{health ? `${health.commandSchemaVersion} / ${health.minAppVersion}` : '—'}</span></div>
      </div>

      <div className="m-card">
        <h2>Device &amp; storage</h2>
        <div className="m-row"><span className="k">Installation ID</span><span className="v m-mono">{deviceId ? `${deviceId.slice(0, 8)}…` : '—'}</span></div>
        <div className="m-row">
          <span className="k">Persistent storage</span>
          <span className="v"><span className={`m-pill ${persist === 'persisted' ? 'ok' : persist === 'best-effort' ? 'warn' : 'neutral'}`}>{persist ?? '…'}</span></span>
        </div>
        <div className="m-row"><span className="k">Local usage / quota</span><span className="v">{bytes(storage.usageBytes)} / {bytes(storage.quotaBytes)}</span></div>
        <div className="m-row">
          <span className="k">Service worker (offline shell)</span>
          <span className="v"><span className={`m-pill ${swReady ? 'ok' : swReady === false ? 'bad' : 'neutral'}`}>{swReady == null ? '…' : swReady ? 'active' : 'unsupported'}</span></span>
        </div>
      </div>

      <div className="m-card">
        <h2>Command journal</h2>
        <div className="m-row"><span className="k">Pending (awaiting sync)</span><span className="v"><span className={`m-pill ${pending > 0 ? 'warn' : 'ok'}`}>{pending}</span></span></div>
        <div className="m-row"><span className="k">Conflicts</span><span className="v"><span className={`m-pill ${conflicts > 0 ? 'bad' : 'neutral'}`}>{conflicts}</span></span></div>
        <div className="m-row"><span className="k">Sync owner (this device)</span><span className="v"><span className={`m-pill ${syncOwner ? 'ok' : 'neutral'}`}>{syncOwner ? 'held' : webLocksAvailable() ? 'idle' : 'no Web Locks'}</span></span></div>
        {recent.map((c) => (
          <div className="m-row" key={c.commandId}>
            <span className="k m-mono">{c.commandType}</span>
            <span className="v"><span className="m-pill neutral">{c.state}</span></span>
          </div>
        ))}
        <div className="m-btn-row">
          <button className="m-btn secondary" disabled={busy || !health} onClick={captureDemo}>Capture demo</button>
          <button className="m-btn secondary" disabled={busy} onClick={becomeOwner}>Become sync owner</button>
        </div>
        <button className="m-btn secondary" disabled={busy} onClick={clearJournal}>Clear local journal (handover wipe)</button>
      </div>

      <div className="m-card">
        <h2>Scanner &amp; screen</h2>
        <div className="m-row">
          <span className="k">Detected inputs</span>
          <span className="v m-caps">
            <span className="m-pill ok">wedge</span>
            <span className="m-pill ok">manual</span>
            <span className={`m-pill ${caps?.nativeBarcodeDetector ? 'ok' : 'neutral'}`}>native detector</span>
            <span className={`m-pill ${caps?.camera ? 'ok' : 'neutral'}`}>camera</span>
          </span>
        </div>
        <div className="m-row"><span className="k">Preferred adapter</span><span className="v">{adapter ?? '—'}</span></div>
        <div className="m-row"><span className="k">Wake lock</span><span className="v"><span className={`m-pill ${wakeOn ? 'ok' : wakeLockAvailable() ? 'neutral' : 'neutral'}`}>{wakeLockAvailable() ? (wakeOn ? 'on' : 'off') : 'unsupported'}</span></span></div>
        <button className="m-btn secondary" disabled={!wakeLockAvailable()} onClick={toggleWake}>{wakeOn ? 'Release wake lock' : 'Keep screen awake'}</button>
      </div>
    </div>
  );
}

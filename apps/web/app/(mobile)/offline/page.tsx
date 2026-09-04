/**
 * Offline fallback (2D.6A). Precached by the service worker and shown when a navigation cannot reach the
 * network and no cached shell exists. Intentionally static and dependency-free so it always renders offline.
 */
export default function OfflinePage() {
  return (
    <div>
      <p className="m-title">You&apos;re offline</p>
      <p className="m-sub">The warehouse app can&apos;t reach the server right now.</p>
      <div className="m-card">
        <p className="m-row"><span className="k">Your captured work is safe</span></p>
        <p className="m-sub" style={{ marginBottom: 0 }}>
          Anything you scanned is held in this device&apos;s local journal and will sync once the connection is
          back. Nothing has changed on the server yet.
        </p>
      </div>
      <a className="m-btn" href="/m">Back to scanner</a>
    </div>
  );
}

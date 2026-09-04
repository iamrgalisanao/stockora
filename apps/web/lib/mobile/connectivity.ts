/**
 * Proven connectivity (2D.6A, ADR 0014 §5). `navigator.onLine` is a HINT, not truth — it reports the radio,
 * not whether our authenticated API is reachable. Effective state comes from a lightweight authenticated
 * probe to `GET /health/mobile`, which also confirms the session is still valid and echoes current scope.
 */

import type { ConnectivityState, MobileHealthResponse } from '@iw/contracts';
import { API_URL, getToken } from '../api';
import { recordAuthOk } from './offline-auth';

export interface ConnectivitySnapshot {
  state: ConnectivityState;
  lastProbeAt: number | null;
  lastOkAt: number | null;
  health: MobileHealthResponse | null;
  /** Round-trip of the last successful probe, ms — feeds the DEGRADED heuristic. */
  rttMs: number | null;
}

const DEGRADED_RTT_MS = 2500;

/** One probe. Never throws — a failure just means OFFLINE. */
export async function probeConnectivity(signal?: AbortSignal): Promise<{ ok: boolean; health: MobileHealthResponse | null; rttMs: number }> {
  const token = getToken();
  const started = Date.now();
  if (!token) return { ok: false, health: null, rttMs: 0 };
  try {
    const res = await fetch(`${API_URL}/api/health/mobile`, {
      headers: { Authorization: `Bearer ${token}` },
      // A probe must never be answered from the HTTP cache or the service worker's cache.
      cache: 'no-store',
      signal,
    });
    const rttMs = Date.now() - started;
    if (!res.ok) return { ok: false, health: null, rttMs };
    return { ok: true, health: (await res.json()) as MobileHealthResponse, rttMs };
  } catch {
    return { ok: false, health: null, rttMs: Date.now() - started };
  }
}

type Listener = (snap: ConnectivitySnapshot) => void;

/**
 * A single connectivity controller per app context. Polls at a steady cadence, probes eagerly on browser
 * online/visibility hints, and coalesces concurrent probes. Consumers subscribe for snapshots.
 */
export class ConnectivityController {
  private snap: ConnectivitySnapshot = { state: 'CONNECTING', lastProbeAt: null, lastOkAt: null, health: null, rttMs: null };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly intervalMs = 20000) {}

  get current(): ConnectivitySnapshot {
    return this.snap;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (typeof window === 'undefined') return;
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    window.addEventListener('online', this.onHint);
    window.addEventListener('offline', this.onHint);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller?.abort();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onHint);
      window.removeEventListener('offline', this.onHint);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
  }

  /** Force an immediate probe (e.g. before a manual "Sync now"). */
  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    // A hard offline hint short-circuits to OFFLINE without a wasted network attempt.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.emit({ ...this.snap, state: 'OFFLINE', lastProbeAt: Date.now() });
      return Promise.resolve();
    }
    this.emit({ ...this.snap, state: this.snap.state === 'ONLINE' ? 'ONLINE' : 'CONNECTING' });
    this.controller = new AbortController();
    this.inFlight = probeConnectivity(this.controller.signal)
      .then(({ ok, health, rttMs }) => {
        const now = Date.now();
        if (ok) {
          // A successful authenticated probe resets the offline-authorization window (ADR 0014 §12).
          if (health) void recordAuthOk(health);
          this.emit({ state: rttMs > DEGRADED_RTT_MS ? 'DEGRADED' : 'ONLINE', lastProbeAt: now, lastOkAt: now, health, rttMs });
        } else {
          this.emit({ ...this.snap, state: 'OFFLINE', lastProbeAt: now, rttMs });
        }
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private onHint = () => {
    void this.tick();
  };

  private onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.tick();
  };

  private emit(next: ConnectivitySnapshot): void {
    this.snap = next;
    for (const fn of this.listeners) fn(next);
  }
}

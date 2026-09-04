/**
 * Offline authorization window (2D.6D, ADR 0014 §12). A device may keep capturing work offline only for a
 * bounded window since its last successful authenticated probe. Past that, capture goes READ-ONLY until the
 * operator reconnects and the probe revalidates the session + scope (which resets the window). This is a
 * client-side safety limit; the server still revalidates permission/scope/account on every applied command.
 */

import type { MobileHealthResponse } from '@iw/contracts';
import { STORES, idbGet, idbPut } from './db';

const AUTH_KEY = 'lastAuthOk';
const DEFAULT_WINDOW_S = 8 * 60 * 60;

interface AuthRecord {
  key: string;
  at: number; // epoch ms of the last successful authenticated probe
  windowSeconds: number;
  userId: string;
}

/** Record a successful authenticated probe — resets the offline window. Called on every ONLINE probe. */
export async function recordAuthOk(health: MobileHealthResponse): Promise<void> {
  await idbPut<AuthRecord>(STORES.meta, {
    key: AUTH_KEY,
    at: Date.now(),
    windowSeconds: health.offlineAuthWindowSeconds || DEFAULT_WINDOW_S,
    userId: health.userId,
  }).catch(() => {});
}

export interface OfflineAuthState {
  /** false once the window has elapsed with no successful probe — capture becomes read-only. */
  ok: boolean;
  lastAuthOkAt: number | null;
  expiresAt: number | null;
  windowSeconds: number;
}

/**
 * Current offline-authorization state, computed from the last recorded successful probe. "No record yet"
 * means unknown, not expired (a just-opened online device hasn't probed yet) → treated as ok; the connectivity
 * probe establishes the record within seconds and the server revalidates every applied command regardless.
 * Read-only kicks in only once we KNOW the window has elapsed since a real successful probe.
 */
export async function offlineAuthState(): Promise<OfflineAuthState> {
  const rec = await idbGet<AuthRecord>(STORES.meta, AUTH_KEY).catch(() => undefined);
  if (!rec) return { ok: true, lastAuthOkAt: null, expiresAt: null, windowSeconds: DEFAULT_WINDOW_S };
  const expiresAt = rec.at + rec.windowSeconds * 1000;
  return { ok: Date.now() <= expiresAt, lastAuthOkAt: rec.at, expiresAt, windowSeconds: rec.windowSeconds };
}

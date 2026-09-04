/**
 * Single sync owner per device (2D.6A, ADR 0014 §7). Web Locks guarantees only one tab/window/service-worker
 * context drains the command queue at a time, so two tabs never double-submit the same local command. This is
 * LOCAL coordination only — correctness between physical devices still comes from server validation and
 * database locks, never from this lock.
 */

export const SYNC_LOCK_NAME = 'inventory-command-sync';

export function webLocksAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'locks' in navigator && !!navigator.locks;
}

/**
 * Run `work` while holding the exclusive sync lock. If the lock is held elsewhere, `ifUnavailable: 'skip'`
 * (the default via `ifAvailable`) resolves to `null` immediately rather than queueing — the caller was not
 * the owner this round, which is exactly what we want for "only one worker drains the queue".
 */
export async function withSyncLock<T>(work: () => Promise<T>): Promise<{ acquired: boolean; result: T | null }> {
  if (!webLocksAvailable()) {
    // No Web Locks (older engine): fall back to running directly. BroadcastChannel election still reduces
    // duplicate work, and the server's exactly-once idempotency key is the real backstop.
    const result = await work();
    return { acquired: true, result };
  }
  return navigator.locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) return { acquired: false, result: null };
    const result = await work();
    return { acquired: true, result };
  });
}

/** Whether the sync lock is currently held by any context on this device. */
export async function isSyncLockHeld(): Promise<boolean> {
  if (!webLocksAvailable() || !navigator.locks.query) return false;
  try {
    const state = await navigator.locks.query();
    return (state.held ?? []).some((l) => l.name === SYNC_LOCK_NAME);
  } catch {
    return false;
  }
}

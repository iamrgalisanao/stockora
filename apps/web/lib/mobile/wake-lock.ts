/**
 * Screen wake lock (2D.6A, ADR 0014 §10) — progressive enhancement. Long scanning sessions shouldn't dim or
 * lock the screen. Absent support, the app just works without it; nothing depends on the lock being granted.
 * The lock is auto-reacquired when the tab returns to the foreground (the platform releases it on hide).
 */

type SentinelLike = { released: boolean; release: () => Promise<void>; addEventListener: (t: string, cb: () => void) => void };

export function wakeLockAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export class WakeLockController {
  private sentinel: SentinelLike | null = null;
  private wanted = false;

  get active(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  /** Request the lock. Returns whether it is now held. Safe to call when unsupported (returns false). */
  async enable(): Promise<boolean> {
    this.wanted = true;
    if (!wakeLockAvailable()) return false;
    try {
      const sentinel = (await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<SentinelLike> } }).wakeLock.request('screen'));
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        // Reacquire on next foreground if the user still wants it.
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
      return true;
    } catch {
      return false;
    }
  }

  async disable(): Promise<void> {
    this.wanted = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    try {
      await this.sentinel?.release();
    } catch {
      /* already released */
    }
    this.sentinel = null;
  }

  private onVisible = () => {
    if (this.wanted && !this.active && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.enable();
    }
  };
}

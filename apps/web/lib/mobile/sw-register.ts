/**
 * Service-worker registration + safe-update UX (2D.6A, ADR 0014 §14). The SW gives the mobile app its offline
 * shell. When a new SW is waiting, we surface an update prompt rather than silently reloading — and the caller
 * MUST refuse to activate it while unsynced commands exist, so an app upgrade never destroys queued work.
 */

export interface SwUpdateHandle {
  registration: ServiceWorkerRegistration;
  /** Tell the waiting worker to take over, then reload. Caller gates this on an empty command queue. */
  activateUpdate: () => void;
}

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Register `/sw.js`. `onUpdateReady` fires when a new worker has installed and is waiting — the app shows an
 * "update available" affordance and, only once the queue is empty, calls `activateUpdate()`.
 */
export async function registerServiceWorker(onUpdateReady?: (handle: SwUpdateHandle) => void): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    const makeHandle = (): SwUpdateHandle => ({
      registration,
      activateUpdate: () => {
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      },
    });

    // A worker already waiting from a previous visit.
    if (registration.waiting && navigator.serviceWorker.controller) onUpdateReady?.(makeHandle());

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // Installed + an existing controller ⇒ this is an UPDATE (not the first install).
        if (installing.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady?.(makeHandle());
      });
    });

    // When the new worker takes control (after an approved skip-waiting), reload once to pick up the new shell.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    return registration;
  } catch {
    return null;
  }
}

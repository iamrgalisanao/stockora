/*
 * Mobile PWA service worker (2D.6A, ADR 0014). Gives the app an installable, offline application shell.
 *
 * Deliberately dependency-free rather than pulling Workbox from a CDN: a CDN import fails on the very first
 * offline load and adds an external runtime dependency the CSP would have to allow. This implements the same
 * strategies Workbox would — precache shell, network-first navigations with an offline fallback, cache-first
 * immutable static assets — with explicit, auditable code.
 *
 * Hard rules from ADR 0014:
 *  - The API (/api/*) is NEVER cached or served from cache. Inventory truth is always fetched live; a probe
 *    or command must fail honestly when offline, never be answered from a stale cache.
 *  - Activation waits for an explicit SKIP_WAITING from the app, which the app only sends once the command
 *    queue is empty — so an app upgrade cannot discard unsynced work (§14).
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `iw-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `iw-static-${CACHE_VERSION}`;

// The minimal app shell that must be available offline. The mobile entry route and its offline fallback.
const SHELL_URLS = ['/m', '/offline', '/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  // Do NOT skipWaiting here — the app decides when it is safe to activate an update (§14).
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Best-effort precache: a missing optional URL must not fail the whole install.
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('iw-') && k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only GETs are cacheable; commands (POST) always hit the network

  const url = new URL(req.url);

  // 1. API: never touch the cache. Let it go to the network and fail honestly when offline.
  if (url.origin === self.location.origin && isApiRequest(url)) return;
  // Cross-origin (e.g. the API on another port/host): also pass straight through.
  if (url.origin !== self.location.origin) return;

  // 2. Navigations: network-first so a connected device always gets fresh HTML; fall back to the cached
  //    shell, then the offline page, when the network is unavailable.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/m')) || (await caches.match('/offline')) || Response.error()),
    );
    return;
  }

  // 3. Immutable static assets: cache-first (they are content-hashed by Next).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          }),
      ),
    );
  }
});

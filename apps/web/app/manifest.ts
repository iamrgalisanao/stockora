import type { MetadataRoute } from 'next';

/**
 * Web App Manifest (2D.6A, ADR 0014) — makes the warehouse app installable as a standalone scanner PWA.
 * Next serves this at `/manifest.webmanifest` and injects the <link> automatically. `start_url` opens the
 * mobile shell; `scope` is the whole origin so the service worker controls every route.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Inventory Engine — Warehouse Scanner',
    short_name: 'IW Scanner',
    description: 'Scanner-first warehouse client with an offline command journal.',
    id: '/m',
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
    categories: ['business', 'productivity', 'utilities'],
  };
}

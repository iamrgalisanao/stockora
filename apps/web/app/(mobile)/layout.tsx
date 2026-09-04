import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './mobile.css';

/**
 * Mobile PWA shell layout (2D.6A, ADR 0014). A distinct, touch-first shell for the installable scanner client,
 * separate from the desktop `(app)` layout. Sets the standalone viewport + theme so an installed instance
 * renders full-bleed on a handheld.
 */
export const metadata: Metadata = {
  title: 'IW Scanner',
  applicationName: 'IW Scanner',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'IW Scanner' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function MobileLayout({ children }: { children: ReactNode }) {
  return <div className="m-shell">{children}</div>;
}

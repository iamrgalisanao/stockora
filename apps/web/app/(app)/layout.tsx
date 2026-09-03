'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearToken, getToken } from '../../lib/api';

const NAV: Array<{ group: string; links: Array<{ href: string; label: string }> }> = [
  { group: 'Overview', links: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/notifications', label: 'Notifications' }, { href: '/search', label: 'Search' }, { href: '/scan', label: 'Scan' }, { href: '/inventory', label: 'Stock Overview' }, { href: '/inventory/position', label: 'Inventory Position' }] },
  { group: 'Catalog', links: [{ href: '/products', label: 'Products' }, { href: '/suppliers', label: 'Suppliers' }] },
  {
    group: 'Warehouse',
    links: [
      { href: '/receiving', label: 'Receiving' },
      { href: '/releases', label: 'Releases' },
      { href: '/transfers', label: 'Transfers' },
      { href: '/reservations', label: 'Reservations' },
      { href: '/returns', label: 'Returns' },
      { href: '/lots', label: 'Lots' },
      { href: '/lots/expiry', label: 'Expiry' },
      { href: '/serials', label: 'Serials' },
    ],
  },
  { group: 'Supply', links: [{ href: '/reorder', label: 'Reorder' }, { href: '/suppliers/performance', label: 'Supplier Analytics' }] },
  {
    group: 'Control',
    links: [
      { href: '/adjustments', label: 'Adjustments' },
      { href: '/counts', label: 'Physical Counts' },
      { href: '/cycle-count', label: 'Cycle Counts' },
      { href: '/inventory/costing', label: 'Costing' },
    ],
  },
  {
    group: 'Analytics',
    links: [
      { href: '/analytics/valuation', label: 'Valuation' },
      { href: '/analytics/stock-status', label: 'Stock Status' },
      { href: '/analytics/dead-stock', label: 'Dead Stock' },
    ],
  },
  {
    group: 'Administration',
    links: [
      { href: '/warehouses', label: 'Warehouses' },
      { href: '/imports', label: 'Import' },
      { href: '/audit', label: 'Audit Explorer' },
      { href: '/outbox', label: 'Outbox Ops' },
      { href: '/admin/categories', label: 'Categories' },
      { href: '/admin/brands', label: 'Brands' },
      { href: '/admin/units', label: 'Units' },
      { href: '/admin/adjustment-reasons', label: 'Adjustment Reasons' },
      { href: '/admin/webhooks', label: 'Webhook Integration' },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else setReady(true);
  }, [router]);

  // Live-ish unread badge on the Notifications nav link (light poll; refreshes when the route changes).
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const tick = () => api.notifications.unreadCount().then((r) => { if (alive) setUnread(r.unread); }).catch(() => {});
    tick();
    const t = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [ready, pathname]);

  if (!ready) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">Inventory Engine</div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.links.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link key={l.href} href={l.href} className={`nav-link ${active ? 'active' : ''}`}>
                  {l.label}
                  {l.href === '/notifications' && unread > 0 && (
                    <span className="badge danger" style={{ marginLeft: 8, fontSize: 11 }}>{unread}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        <div style={{ marginTop: 'auto' }}>
          <button
            className="btn secondary"
            style={{ width: '100%' }}
            onClick={async () => {
              try { await api.logout(); } catch { /* revoke best-effort */ }
              clearToken();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

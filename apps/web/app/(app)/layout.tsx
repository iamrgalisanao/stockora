'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearToken, getToken } from '../../lib/api';

const NAV: Array<{ group: string; links: Array<{ href: string; label: string }> }> = [
  { group: 'Overview', links: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/search', label: 'Search' }, { href: '/scan', label: 'Scan' }, { href: '/inventory', label: 'Stock Overview' }, { href: '/inventory/position', label: 'Inventory Position' }] },
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
    ],
  },
  { group: 'Supply', links: [{ href: '/reorder', label: 'Reorder' }] },
  {
    group: 'Control',
    links: [
      { href: '/adjustments', label: 'Adjustments' },
      { href: '/counts', label: 'Physical Counts' },
      { href: '/cycle-count', label: 'Cycle Counts' },
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
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else setReady(true);
  }, [router]);

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

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { clearToken, getToken } from '../../lib/api';

const NAV: Array<{ group: string; links: Array<{ href: string; label: string }> }> = [
  { group: 'Overview', links: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/inventory', label: 'Stock Overview' }] },
  { group: 'Catalog', links: [{ href: '/products', label: 'Products' }] },
  {
    group: 'Warehouse',
    links: [
      { href: '/receiving', label: 'Receiving' },
      { href: '/releases', label: 'Releases' },
      { href: '/transfers', label: 'Transfers' },
    ],
  },
  { group: 'Supply', links: [{ href: '/reorder', label: 'Reorder' }] },
  {
    group: 'Control',
    links: [
      { href: '/adjustments', label: 'Adjustments' },
      { href: '/counts', label: 'Physical Counts' },
    ],
  },
  { group: 'Administration', links: [{ href: '/admin/adjustment-reasons', label: 'Adjustment Reasons' }] },
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
            onClick={() => {
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

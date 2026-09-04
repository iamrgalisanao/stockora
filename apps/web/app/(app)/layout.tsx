'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Toaster } from 'sonner';
import { api, clearToken, getToken } from '../../lib/api';

type NavLink = { href: string; label: string; icon: string };
const NAV: Array<{ group: string; accent: string; links: NavLink[] }> = [
  { group: 'Overview', accent: 'var(--frost, #d1e4fa)', links: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/notifications', label: 'Notifications', icon: 'bell' },
    { href: '/search', label: 'Search', icon: 'search' },
    { href: '/scan', label: 'Scan', icon: 'scan' },
    { href: '/inventory', label: 'Stock Overview', icon: 'boxes' },
    { href: '/inventory/position', label: 'Inventory Position', icon: 'pin' },
  ] },
  { group: 'Catalog', accent: '#f5a623', links: [
    { href: '/products', label: 'Products', icon: 'tag' },
    { href: '/suppliers', label: 'Suppliers', icon: 'truck' },
  ] },
  { group: 'Warehouse', accent: '#3fbfa3', links: [
    { href: '/receiving', label: 'Receiving', icon: 'receive' },
    { href: '/releases', label: 'Releases', icon: 'release' },
    { href: '/transfers', label: 'Transfers', icon: 'transfer' },
    { href: '/reservations', label: 'Reservations', icon: 'bookmark' },
    { href: '/returns', label: 'Returns', icon: 'returns' },
    { href: '/lots', label: 'Lots', icon: 'layers' },
    { href: '/lots/expiry', label: 'Expiry', icon: 'clock' },
    { href: '/serials', label: 'Serials', icon: 'serial' },
  ] },
  { group: 'Supply', accent: '#e2b24d', links: [
    { href: '/reorder', label: 'Reorder', icon: 'reorder' },
    { href: '/suppliers/performance', label: 'Supplier Analytics', icon: 'chartup' },
  ] },
  { group: 'Control', accent: '#4ea8f5', links: [
    { href: '/adjustments', label: 'Adjustments', icon: 'sliders' },
    { href: '/counts', label: 'Physical Counts', icon: 'clipboard' },
    { href: '/cycle-count', label: 'Cycle Counts', icon: 'repeat' },
    { href: '/inventory/costing', label: 'Costing', icon: 'coin' },
  ] },
  { group: 'Analytics', accent: '#c084fc', links: [
    { href: '/analytics/valuation', label: 'Valuation', icon: 'calculator' },
    { href: '/analytics/stock-status', label: 'Stock Status', icon: 'gauge' },
    { href: '/analytics/dead-stock', label: 'Dead Stock', icon: 'snooze' },
  ] },
  { group: 'Administration', accent: '#8fa6b8', links: [
    { href: '/warehouses', label: 'Warehouses', icon: 'building' },
    { href: '/imports', label: 'Import', icon: 'upload' },
    { href: '/audit', label: 'Audit Explorer', icon: 'audit' },
    { href: '/outbox', label: 'Outbox Ops', icon: 'outbox' },
    { href: '/admin/categories', label: 'Categories', icon: 'folder' },
    { href: '/admin/brands', label: 'Brands', icon: 'star' },
    { href: '/admin/units', label: 'Units', icon: 'ruler' },
    { href: '/admin/adjustment-reasons', label: 'Adjustment Reasons', icon: 'label' },
    { href: '/admin/webhooks', label: 'Webhook Integration', icon: 'webhook' },
  ] },
];

/** Distinct line-glyph per nav item (24x24, stroke=currentColor so the group accent colours it). */
const ICONS: Record<string, string> = {
  dashboard: '<path d="M4 4h7v6H4z"/><path d="M13 4h7v9h-7z"/><path d="M13 16h7v4h-7z"/><path d="M4 13h7v7H4z"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 21h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
  boxes: '<path d="M3 8 12 4l9 4-9 4-9-4Z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
  pin: '<path d="M12 21s-6.5-5.5-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.5 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.2"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  truck: '<path d="M3 6h11v9H3z"/><path d="M14 9h3.5L21 12v3h-7"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  receive: '<path d="M12 3v8"/><path d="m8 8 4 3 4-3"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  release: '<path d="M12 11V3"/><path d="m8 6 4-3 4 3"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  transfer: '<path d="M4 8h13"/><path d="m14 5 3 3-3 3"/><path d="M20 16H7"/><path d="m10 13-3 3 3 3"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  returns: '<path d="M4 10h11a5 5 0 0 1 0 10h-2"/><path d="m8 6-4 4 4 4"/>',
  layers: '<path d="M12 4 4 8l8 4 8-4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 16 8 4 8-4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  serial: '<path d="M4 5h16v14H4z"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/>',
  reorder: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v6h-6"/>',
  chartup: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>',
  sliders: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  clipboard: '<path d="M9 4h6v3H9z"/><path d="M7 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><path d="m9 14 2 2 4-4"/>',
  repeat: '<path d="M4 9a6 6 0 0 1 10-4l3 3"/><path d="M20 15a6 6 0 0 1-10 4l-3-3"/><path d="M17 3v5h-5"/><path d="M7 21v-5h5"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M14 10c0-1.1-.9-1.6-2-1.6s-2 .5-2 1.6.9 1.5 2 1.5 2 .5 2 1.5-.9 1.6-2 1.6-2-.5-2-1.6"/>',
  calculator: '<path d="M6 3h12v18H6z"/><path d="M8 6h8v3H8z"/><path d="M8 12h.5M11.5 12h.5M15 12h.5M8 15h.5M11.5 15h.5M8 18h4"/>',
  gauge: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-3"/><circle cx="12" cy="15" r="1"/>',
  snooze: '<path d="M4 7h6l-6 8h6"/><path d="M14 11h5l-5 6h5"/>',
  building: '<path d="M4 20V9l8-5 8 5v11"/><path d="M3 20h18"/><path d="M9 20v-5h6v5"/>',
  upload: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M4 18h16"/>',
  audit: '<path d="M4 6h11"/><path d="M4 11h6"/><path d="M4 16h6"/><circle cx="16" cy="15" r="3"/><path d="m21 20-2.6-2.6"/>',
  outbox: '<path d="m4 12 16-7-6 16-3-7-7-2Z"/>',
  folder: '<path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.6l5.9-.8z"/>',
  ruler: '<path d="M3 8 8 3l13 13-5 5L3 8Z"/><path d="m7 8 1.5 1.5M10 11l1.5 1.5M13 14l1.5 1.5"/>',
  label: '<path d="M4 6h9l7 6-7 6H4V6Z"/><circle cx="8" cy="12" r="1.4"/>',
  webhook: '<path d="M9 15 15 9"/><path d="M8 12 6.5 13.5a3 3 0 0 0 4.2 4.2L12 16"/><path d="M16 12l1.5-1.5a3 3 0 0 0-4.2-4.2L12 8"/>',
};

function NavIcon({ name }: { name: string }) {
  return (
    <span className="nav-tile">
      <svg className="nav-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} />
    </span>
  );
}

const LS_COLLAPSED = 'iw.sidebar.collapsed';
const LS_GROUPS = 'iw.sidebar.closedGroups';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);
  // Sidebar layout prefs — read synchronously on the client (render is gated on
  // `ready`, so there is no SSR/hydration mismatch) and persisted to localStorage.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(LS_COLLAPSED) === '1'; } catch { return false; }
  });
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => {
    // Groups start collapsed by default; a stored preference (even []) wins.
    const allClosed = () => new Set(NAV.map((n) => n.group));
    if (typeof window === 'undefined') return allClosed();
    try {
      const raw = window.localStorage.getItem(LS_GROUPS);
      return raw == null ? allClosed() : new Set(JSON.parse(raw) as string[]);
    } catch { return allClosed(); }
  });

  const toggleCollapsed = () => setCollapsed((c) => {
    const next = !c;
    try { window.localStorage.setItem(LS_COLLAPSED, next ? '1' : '0'); } catch { /* private mode */ }
    return next;
  });
  const toggleGroup = (g: string) => setClosedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    try { window.localStorage.setItem(LS_GROUPS, JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });

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
    <div className="shell" data-collapsed={collapsed || undefined}>
      <button
        type="button"
        className="rail-toggle"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.5 7l-5 5 5 5" />
        </svg>
      </button>
      <aside className="sidebar">
        <div className="logo">
          <img src="/stockora-logo-light.png" alt="Stockora" className="logo-mark" />
          <span className="logo-wm">
            <span className="logo-text"><span className="lg-stock">Stock</span><span className="lg-ora">ora</span></span>
            <span className="logo-tag">Warehouse Intelligence by Abbadev</span>
          </span>
        </div>
        {NAV.map((g) => {
          const hasActive = g.links.some((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));
          const open = collapsed || !closedGroups.has(g.group) || hasActive;
          return (
            <div key={g.group} className="nav-section" style={{ ['--nav-accent' as string]: g.accent }}>
              <button type="button" className="nav-group" aria-expanded={open} onClick={() => toggleGroup(g.group)} title={g.group}>
                <span className="nav-group-label">{g.group}</span>
                <svg className="nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              {open && g.links.map((l) => {
                const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`nav-link ${active ? 'active' : ''}`}
                    title={collapsed ? l.label : undefined}
                  >
                    <NavIcon name={l.icon} />
                    <span className="nav-label">{l.label}</span>
                    {l.href === '/notifications' && unread > 0 && (
                      <span className="badge danger nav-badge">{unread}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
        <div style={{ marginTop: 'auto' }}>
          <button
            className="btn secondary signout"
            onClick={async () => {
              try { await api.logout(); } catch { /* revoke best-effort */ }
              clearToken();
              router.replace('/login');
            }}
            title="Sign out"
          >
            <svg className="signout-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 12H4" /><path d="m8 8-4 4 4 4" /><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
            </svg>
            <span className="signout-label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
      <Toaster theme="dark" position="bottom-right" gap={10} toastOptions={{ duration: 3500 }} />
    </div>
  );
}

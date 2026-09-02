'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SearchResult, SearchResultType } from '@iw/contracts';
import { api } from '../../../lib/api';

const TYPE_LABEL: Record<SearchResultType, string> = {
  PRODUCT: 'Product',
  PRODUCT_VARIANT: 'Variant',
  SUPPLIER: 'Supplier',
  WAREHOUSE: 'Warehouse',
  LOCATION: 'Location',
  GOODS_RECEIPT: 'Receipt',
  RELEASE: 'Release',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  PHYSICAL_COUNT: 'Count',
};

export default function SearchPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); setError(null); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.search(term)
        .then((r) => { setResults(r); setActive(0); })
        .catch((e) => setError(e instanceof Error ? e.message : 'Search failed'))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  // Preserve ranked order, but show a type chip per row.
  const rows = useMemo(() => results, [results]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) router.push(r.route); }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Search</h1>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search products, suppliers, warehouses, locations, documents…"
          style={{ fontSize: 18, padding: '12px 14px' }}
          autoComplete="off"
        />
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Matches SKU, barcode, code, name, and document numbers · ↑↓ to navigate, Enter to open
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {q.trim() && !loading && rows.length === 0 && !error && <div className="card muted">No matches for “{q.trim()}”.</div>}

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {rows.map((r, i) => (
            <Link
              key={`${r.type}:${r.entityId}`}
              href={r.route}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                textDecoration: 'none', color: 'inherit',
                background: i === active ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span className="badge" style={{ minWidth: 78, textAlign: 'center' }}>{TYPE_LABEL[r.type]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{r.subtitle ?? ''}{r.code ? ` · ${r.code}` : ''}</div>
              </span>
              {r.status && <span className={`badge ${r.status === 'ACTIVE' ? 'ok' : 'warn'}`}>{r.status}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

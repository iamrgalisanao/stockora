'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EntityStatus, ProductResponse } from '@iw/contracts';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/master-data';

const FILTERS: Array<EntityStatus | 'ALL'> = ['ALL', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [filter, setFilter] = useState<EntityStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .products(filter === 'ALL' ? undefined : filter)
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [filter]);

  const hasCost = products.some((p) => p.cost !== undefined);
  const search = q.trim().toLowerCase();
  const visible = search
    ? products.filter((p) => p.sku.toLowerCase().includes(search) || p.name.toLowerCase().includes(search))
    : products;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Products</h1>
        <Link href="/products/new" className="btn">+ New product</Link>
      </div>

      <div className="toolbar">
        <input placeholder="Search SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        {FILTERS.map((f) => (
          <button key={f} className={`btn ${f === filter ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setFilter(f)}>{f}</button>
        ))}
        {!loading && <span className="count">{visible.length}{visible.length !== products.length ? ` of ${products.length}` : ''} {products.length === 1 ? 'product' : 'products'}</span>}
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : products.length === 0 ? (
        <div className="card muted">No products yet. Create one to start tracking stock.</div>
      ) : visible.length === 0 ? (
        <div className="card muted">No products match “{q}”.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Name</th><th>Category</th><th>Brand</th><th>UoM</th>
                <th className="num">Price</th>{hasCost && <th className="num">Cost</th>}<th>Variants</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/products/${p.id}`}>{p.sku}</Link></td>
                  <td>{p.name}</td>
                  <td>{p.categoryName ?? '—'}</td>
                  <td>{p.brandName ?? '—'}</td>
                  <td>{p.baseUomCode}</td>
                  <td className="num">{p.sellingPrice}</td>
                  {hasCost && <td className="num">{p.cost}</td>}
                  <td>{p.hasVariants ? 'Yes' : '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

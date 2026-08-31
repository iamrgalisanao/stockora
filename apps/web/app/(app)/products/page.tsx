'use client';

import { useEffect, useState } from 'react';
import type { ProductResponse } from '@iw/contracts';
import { api } from '../../../lib/api';

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .products()
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const hasCost = products.some((p) => p.cost !== undefined);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Products</h1>
        <span className="muted">{products.length} SKUs</span>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : products.length === 0 ? (
        <div className="card muted">No products yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Brand</th>
                <th>UoM</th>
                <th className="num">Price</th>
                {hasCost && <th className="num">Cost</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.categoryName ?? '—'}</td>
                  <td>{p.brandName ?? '—'}</td>
                  <td>{p.baseUomCode}</td>
                  <td className="num">{p.sellingPrice}</td>
                  {hasCost && <td className="num">{p.cost}</td>}
                  <td>
                    <span className={`badge ${p.isActive ? 'ok' : 'muted'}`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

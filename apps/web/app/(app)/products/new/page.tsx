'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BrandResponse, CategoryResponse, UnitResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [brands, setBrands] = useState<BrandResponse[]>([]);
  const [units, setUnits] = useState<UnitResponse[]>([]);
  const [f, setF] = useState({
    sku: '', name: '', baseUomId: '', categoryId: '', brandId: '',
    sellingPrice: '', cost: '', description: '',
    trackInventory: true, isSerialized: false, isBatchTracked: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.categories.list(undefined, 'ACTIVE'), api.brands.list(undefined, 'ACTIVE'), api.units.list(undefined, 'ACTIVE')])
      .then(([c, b, u]) => { setCategories(c); setBrands(b); setUnits(u); if (u[0]) setF((p) => ({ ...p, baseUomId: u[0]!.id })); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }

  async function save() {
    setError(null);
    if (!f.sku.trim() || !f.name.trim() || !f.baseUomId) return setError('SKU, name and base unit are required');
    setBusy(true);
    try {
      const created = await api.productAdmin.create({
        sku: f.sku, name: f.name, baseUomId: f.baseUomId,
        categoryId: f.categoryId || undefined, brandId: f.brandId || undefined,
        sellingPrice: f.sellingPrice ? Number(f.sellingPrice) : undefined,
        cost: f.cost ? Number(f.cost) : undefined,
        description: f.description || undefined,
        trackInventory: f.trackInventory, isSerialized: f.isSerialized, isBatchTracked: f.isBatchTracked,
      });
      router.push(`/products/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New product</h1>
        <button className="btn secondary small" onClick={() => router.push('/products')}>Cancel</button>
      </div>
      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div><label>SKU *</label><input value={f.sku} onChange={(e) => set('sku', e.target.value)} /></div>
          <div><label>Name *</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div><label>Base unit *</label>
            <select value={f.baseUomId} onChange={(e) => set('baseUomId', e.target.value)}>
              <option value="">Select…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </div>
          <div><label>Category</label>
            <select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label>Brand</label>
            <select value={f.brandId} onChange={(e) => set('brandId', e.target.value)}>
              <option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><label>Selling price</label><input type="number" min="0" value={f.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} /></div>
          <div><label>Cost</label><input type="number" min="0" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><label>Description</label><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="optional" /></div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.trackInventory} onChange={(e) => set('trackInventory', e.target.checked)} /> Track inventory</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isSerialized} onChange={(e) => set('isSerialized', e.target.checked)} /> Serialized</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isBatchTracked} onChange={(e) => set('isBatchTracked', e.target.checked)} /> Batch tracked</label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Working…' : 'Create product'}</button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Add variants, barcodes, and per-warehouse inventory policies after creating (see the product's tabs).</div>
      </div>
    </div>
  );
}

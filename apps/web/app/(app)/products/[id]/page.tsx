'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  AuditEntryResponse, BrandResponse, CategoryResponse, EntityStatus, InventoryPolicyResponse,
  ProductResponse, SupplierResponse, WarehouseResponse,
} from '@iw/contracts';
import { api } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/master-data';
import { auditActor, auditSummary } from '../../../../lib/audit-format';

type Tab = 'general' | 'variants' | 'policies' | 'barcodes' | 'history';

export default function ProductEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [p, setP] = useState<ProductResponse | null>(null);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [brands, setBrands] = useState<BrandResponse[]>([]);
  const [tab, setTab] = useState<Tab>('general');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.productAdmin.get(id).then(setP).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(() => {
    reload();
    api.categories.list(undefined, 'ACTIVE').then(setCategories).catch(() => {});
    api.brands.list(undefined, 'ACTIVE').then(setBrands).catch(() => {});
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  async function changeStatus(status: EntityStatus) {
    if (status === 'ARCHIVED' && !window.confirm('Archive this product? It must have no stock or open documents.')) return;
    run(() => api.productAdmin.changeStatus(id, status));
  }

  if (error && !p) return <div className="card error">{error}</div>;
  if (!p) return <div className="card muted">Loading…</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="h1" style={{ display: 'inline', marginRight: 10 }}>{p.sku}</h1>
          <StatusBadge status={p.status} />
        </div>
        <button className="btn secondary small" onClick={() => router.push('/products')}>Back</button>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        {(['general', 'variants', 'policies', 'barcodes', 'history'] as Tab[]).map((t) => (
          <button key={t} className={`btn ${t === tab ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span style={{ flex: 1 }} />
        {p.status !== 'ACTIVE' && p.status !== 'ARCHIVED' && <button className="btn small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('ACTIVE')}>Activate</button>}
        {p.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('INACTIVE')}>Deactivate</button>}
        {p.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('ARCHIVED')}>Archive</button>}
      </div>

      {error && <div className="error">{error}</div>}

      {tab === 'general' && <GeneralTab p={p} categories={categories} brands={brands} onSave={(body) => run(() => api.productAdmin.update(id, body))} busy={busy} />}
      {tab === 'variants' && <VariantsTab p={p} onAdd={(body) => run(() => api.productAdmin.addVariant(id, body))} onStatus={(vid, s) => run(() => api.productAdmin.changeVariantStatus(id, vid, s))} busy={busy} />}
      {tab === 'policies' && <PoliciesTab productId={id} p={p} />}
      {tab === 'barcodes' && <BarcodesTab p={p} onAssign={(body) => run(() => api.productAdmin.assignBarcode(id, body))} onUpdate={(bid, body) => run(() => api.productAdmin.updateBarcode(id, bid, body))} onRemove={(bid) => run(() => api.productAdmin.removeBarcode(id, bid))} busy={busy} />}
      {tab === 'history' && <HistoryTab productId={id} />}
    </div>
  );
}

function GeneralTab({ p, categories, brands, onSave, busy }: { p: ProductResponse; categories: CategoryResponse[]; brands: BrandResponse[]; onSave: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? '');
  const [categoryId, setCategoryId] = useState(p.categoryId ?? '');
  const [brandId, setBrandId] = useState(p.brandId ?? '');
  const [sellingPrice, setSellingPrice] = useState(p.sellingPrice);
  return (
    <div className="card">
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Category</label><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label>Brand</label><select value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label>Selling price</label><input type="number" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} /></div>
        <div><label>Base unit</label><input value={p.baseUomCode} disabled /></div>
      </div>
      <div style={{ marginTop: 10 }}><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy} onClick={() => onSave({ name, description: description || undefined, categoryId: categoryId || null, brandId: brandId || null, sellingPrice: Number(sellingPrice) })}>Save</button>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Base unit and batch/serial flags are locked once inventory movements exist.</div>
    </div>
  );
}

function VariantsTab({ p, onAdd, onStatus, busy }: { p: ProductResponse; onAdd: (b: { sku: string; attributes?: Record<string, unknown>; sellingPrice?: number }) => void; onStatus: (vid: string, s: EntityStatus) => void; busy: boolean }) {
  const [sku, setSku] = useState('');
  const [attrs, setAttrs] = useState('');
  const [err, setErr] = useState<string | null>(null);
  function add() {
    setErr(null);
    let attributes: Record<string, unknown> | undefined;
    if (attrs.trim()) { try { attributes = JSON.parse(attrs); } catch { return setErr('Attributes must be valid JSON, e.g. {"size":"M"}'); } }
    if (!sku.trim()) return setErr('Variant SKU is required');
    onAdd({ sku, attributes });
    setSku(''); setAttrs('');
  }
  return (
    <div className="card">
      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
        <div><label>Variant SKU</label><input value={sku} onChange={(e) => setSku(e.target.value)} /></div>
        <div><label>Attributes (JSON)</label><input value={attrs} onChange={(e) => setAttrs(e.target.value)} placeholder='{"size":"M"}' /></div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={add}>Add variant</button>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="grid">
          <thead><tr><th>SKU</th><th>Attributes</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {(p.variants ?? []).map((v) => (
              <tr key={v.id}>
                <td>{v.sku}</td><td>{JSON.stringify(v.attributes)}</td><td><StatusBadge status={v.status} /></td>
                <td><div className="toolbar">
                  {v.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onStatus(v.id, 'INACTIVE')}>Deactivate</button>}
                  {v.status === 'INACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onStatus(v.id, 'ACTIVE')}>Activate</button>}
                  {v.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onStatus(v.id, 'ARCHIVED')}>Archive</button>}
                </div></td>
              </tr>
            ))}
            {(p.variants ?? []).length === 0 && <tr><td colSpan={4} className="muted">No variants — this product is its own stock unit.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BarcodesTab({ p, onAssign, onUpdate, onRemove, busy }: { p: ProductResponse; onAssign: (b: { code: string; variantId?: string; isPrimary?: boolean }) => void; onUpdate: (bid: string, b: { isPrimary?: boolean; status?: EntityStatus }) => void; onRemove: (bid: string) => void; busy: boolean }) {
  const [code, setCode] = useState('');
  const [variantId, setVariantId] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const variantSku = (vid: string | null) => (vid ? p.variants?.find((v) => v.id === vid)?.sku ?? vid : '(product)');
  return (
    <div className="card">
      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr auto auto' }}>
        <div><label>Barcode</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><label>Applies to</label>
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Product (no variant)</option>
            {(p.variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary</label>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy || !code.trim()} onClick={() => { onAssign({ code, variantId: variantId || undefined, isPrimary }); setCode(''); setIsPrimary(false); }}>Assign</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="grid">
          <thead><tr><th>Code</th><th>Applies to</th><th>Primary</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {(p.barcodes ?? []).map((b) => (
              <tr key={b.id}>
                <td>{b.code}</td><td>{variantSku(b.variantId)}</td><td>{b.isPrimary ? '★' : ''}</td><td><StatusBadge status={b.status} /></td>
                <td><div className="toolbar">
                  {!b.isPrimary && b.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onUpdate(b.id, { isPrimary: true })}>Set primary</button>}
                  {b.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onUpdate(b.id, { status: 'INACTIVE' })}>Deactivate</button>}
                  {b.status === 'INACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onUpdate(b.id, { status: 'ACTIVE' })}>Activate</button>}
                  <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => { if (window.confirm('Delete this barcode?')) onRemove(b.id); }}>Delete</button>
                </div></td>
              </tr>
            ))}
            {(p.barcodes ?? []).length === 0 && <tr><td colSpan={5} className="muted">No barcodes assigned.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PoliciesTab({ productId, p }: { productId: string; p: ProductResponse }) {
  const [rows, setRows] = useState<InventoryPolicyResponse[] | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Create-form state
  const [warehouseId, setWarehouseId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [minStock, setMinStock] = useState('0');
  const [reorderPoint, setReorderPoint] = useState('0');
  const [reorderQuantity, setReorderQuantity] = useState('');
  const [maxStock, setMaxStock] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const reload = useCallback(() => {
    api.productAdmin.policies(productId).then(setRows).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [productId]);
  useEffect(() => {
    reload();
    api.warehouses().then(setWarehouses).catch(() => {});
    api.suppliers().then(setSuppliers).catch(() => {});
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  function create() {
    if (!warehouseId) return setError('Select a warehouse');
    if (!reorderQuantity || Number(reorderQuantity) <= 0) return setError('Reorder quantity must be greater than 0');
    run(() => api.productAdmin.createPolicy(productId, {
      warehouseId,
      variantId: variantId || undefined,
      minStock: Number(minStock) || 0,
      reorderPoint: Number(reorderPoint) || 0,
      reorderQuantity: Number(reorderQuantity),
      maxStock: maxStock.trim() ? Number(maxStock) : undefined,
      preferredSupplierId: supplierId || undefined,
    })).then(() => { setWarehouseId(''); setVariantId(''); setMinStock('0'); setReorderPoint('0'); setReorderQuantity(''); setMaxStock(''); setSupplierId(''); });
  }
  const variantLabel = (vid: string | null) => (vid ? p.variants?.find((v) => v.id === vid)?.sku ?? vid : '(product)');
  const supplierName = (sid: string | null) => (sid ? suppliers.find((s) => s.id === sid)?.companyName ?? sid : '—');

  return (
    <div className="card">
      <div className="field-row" style={{ gridTemplateColumns: 'repeat(6, 1fr) auto', alignItems: 'end' }}>
        <div><label>Warehouse</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">—</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </select>
        </div>
        <div><label>Applies to</label>
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Product</option>
            {(p.variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
          </select>
        </div>
        <div><label>Min</label><input type="number" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
        <div><label>Reorder pt</label><input type="number" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} /></div>
        <div><label>Reorder qty</label><input type="number" min="0" value={reorderQuantity} onChange={(e) => setReorderQuantity(e.target.value)} /></div>
        <div><label>Max</label><input type="number" min="0" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} placeholder="none" /></div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={create}>Add</button>
      </div>
      <div style={{ marginTop: 8 }}>
        <label>Preferred supplier</label>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">—</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Warehouse</th><th>Applies to</th>
              <th className="num">Min</th><th className="num">Reorder pt</th><th className="num">Reorder qty</th><th className="num">Max</th>
              <th>Supplier</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? <tr><td colSpan={9} className="muted">Loading…</td></tr> : rows.length === 0 ? (
              <tr><td colSpan={9} className="muted">No policies yet — add one per warehouse to drive reorder intelligence.</td></tr>
            ) : rows.map((r) => (
              editId === r.id ? (
                <PolicyEditRow key={r.id} r={r} busy={busy} warehouseLabel={r.warehouseCode} appliesTo={variantLabel(r.variantId)} suppliers={suppliers}
                  onCancel={() => setEditId(null)}
                  onSave={(body) => run(() => api.productAdmin.updatePolicy(r.id, body)).then(() => setEditId(null))} />
              ) : (
                <tr key={r.id}>
                  <td>{r.warehouseCode}</td>
                  <td>{variantLabel(r.variantId)}</td>
                  <td className="num">{r.minStock}</td>
                  <td className="num">{r.reorderPoint}</td>
                  <td className="num">{r.reorderQuantity}</td>
                  <td className="num">{r.maxStock ?? '—'}</td>
                  <td>{supplierName(r.preferredSupplierId)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td><div className="toolbar">
                    {r.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => setEditId(r.id)}>Edit</button>}
                    {r.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(() => api.productAdmin.changePolicyStatus(r.id, 'INACTIVE'))}>Deactivate</button>}
                    {r.status === 'INACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(() => api.productAdmin.changePolicyStatus(r.id, 'ACTIVE'))}>Activate</button>}
                    {r.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => { if (window.confirm('Archive this policy?')) run(() => api.productAdmin.changePolicyStatus(r.id, 'ARCHIVED')); }}>Archive</button>}
                  </div></td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PolicyEditRow({ r, busy, warehouseLabel, appliesTo, suppliers, onCancel, onSave }: {
  r: InventoryPolicyResponse; busy: boolean; warehouseLabel: string; appliesTo: string; suppliers: SupplierResponse[];
  onCancel: () => void; onSave: (b: { minStock?: number; maxStock?: number | null; reorderPoint?: number; reorderQuantity?: number; preferredSupplierId?: string | null }) => void;
}) {
  const [minStock, setMinStock] = useState(r.minStock);
  const [reorderPoint, setReorderPoint] = useState(r.reorderPoint);
  const [reorderQuantity, setReorderQuantity] = useState(r.reorderQuantity);
  const [maxStock, setMaxStock] = useState(r.maxStock ?? '');
  const [supplierId, setSupplierId] = useState(r.preferredSupplierId ?? '');
  return (
    <tr>
      <td>{warehouseLabel}</td>
      <td>{appliesTo}</td>
      <td className="num"><input type="number" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} style={{ width: 80 }} /></td>
      <td className="num"><input type="number" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} style={{ width: 80 }} /></td>
      <td className="num"><input type="number" min="0" value={reorderQuantity} onChange={(e) => setReorderQuantity(e.target.value)} style={{ width: 80 }} /></td>
      <td className="num"><input type="number" min="0" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} placeholder="none" style={{ width: 80 }} /></td>
      <td>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">—</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
        </select>
      </td>
      <td><StatusBadge status={r.status} /></td>
      <td><div className="toolbar">
        <button className="btn small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onSave({
          minStock: Number(minStock) || 0,
          reorderPoint: Number(reorderPoint) || 0,
          reorderQuantity: Number(reorderQuantity),
          maxStock: maxStock.trim() ? Number(maxStock) : null,
          preferredSupplierId: supplierId || null,
        })}>Save</button>
        <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={onCancel}>Cancel</button>
      </div></td>
    </tr>
  );
}

function HistoryTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<AuditEntryResponse[] | null>(null);
  useEffect(() => { api.audit.forEntity('product', productId).then(setRows).catch(() => setRows([])); }, [productId]);
  return (
    <div className="card">
      {rows === null ? <div className="muted">Loading…</div> : rows.length === 0 ? <div className="muted">No history.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Event</th><th>By</th><th>When</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{auditSummary(r)}</td><td>{auditActor(r)}</td><td>{new Date(r.occurredAt).toLocaleString()}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

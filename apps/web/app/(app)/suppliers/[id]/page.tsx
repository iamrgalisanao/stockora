'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  AuditEntryResponse, EntityStatus, ProductResponse, SupplierProductResponse, SupplierResponse,
} from '@iw/contracts';
import { api } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/master-data';
import { auditActor, auditSummary } from '../../../../lib/audit-format';

type Tab = 'general' | 'catalog' | 'history';

export default function SupplierEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [s, setS] = useState<SupplierResponse | null>(null);
  const [tab, setTab] = useState<Tab>('general');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.supplierAdmin.get(id).then(setS).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  async function changeStatus(status: EntityStatus) {
    if (status === 'ARCHIVED' && !window.confirm('Archive this supplier? It must not be preferred anywhere or on an open receipt.')) return;
    run(() => api.supplierAdmin.changeStatus(id, status));
  }

  if (error && !s) return <div className="card error">{error}</div>;
  if (!s) return <div className="card muted">Loading…</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="h1" style={{ display: 'inline', marginRight: 10 }}>{s.code}</h1>
          <StatusBadge status={s.status} />
          <span className="muted" style={{ marginLeft: 10 }}>{s.companyName}</span>
        </div>
        <button className="btn secondary small" onClick={() => router.push('/suppliers')}>Back</button>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        {(['general', 'catalog', 'history'] as Tab[]).map((t) => (
          <button key={t} className={`btn ${t === tab ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span style={{ flex: 1 }} />
        {s.status !== 'ACTIVE' && s.status !== 'ARCHIVED' && <button className="btn small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('ACTIVE')}>Activate</button>}
        {s.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('INACTIVE')}>Deactivate</button>}
        {s.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('ARCHIVED')}>Archive</button>}
      </div>

      {error && <div className="error">{error}</div>}

      {tab === 'general' && <GeneralTab s={s} onSave={(body) => run(() => api.supplierAdmin.update(id, body))} busy={busy} />}
      {tab === 'catalog' && <CatalogTab supplierId={id} />}
      {tab === 'history' && <HistoryTab supplierId={id} />}
    </div>
  );
}

function GeneralTab({ s, onSave, busy }: { s: SupplierResponse; onSave: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [f, setF] = useState({
    companyName: s.companyName, contactPerson: s.contactPerson ?? '', email: s.email ?? '', phone: s.phone ?? '',
    address: s.address ?? '', taxNumber: s.taxNumber ?? '', paymentTerms: s.paymentTerms ?? '',
    leadTimeDays: String(s.leadTimeDays), rating: s.rating != null ? String(s.rating) : '',
    isPreferred: s.isPreferred, notes: s.notes ?? '',
  });
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }
  return (
    <div className="card">
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div><label>Company name</label><input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></div>
        <div><label>Contact person</label><input value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></div>
        <div><label>Email</label><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div><label>Phone</label><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div><label>Lead time (days)</label><input type="number" min="0" value={f.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} /></div>
        <div><label>Rating (1–5)</label><input type="number" min="1" max="5" value={f.rating} onChange={(e) => set('rating', e.target.value)} /></div>
        <div><label>Tax number</label><input value={f.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} /></div>
        <div><label>Payment terms</label><input value={f.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 10 }}><label>Address</label><input value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
      <div style={{ marginTop: 10 }}><label>Notes</label><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isPreferred} onChange={(e) => set('isPreferred', e.target.checked)} /> Preferred Vendor (strategic classification)</label>
      </div>
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>A descriptive label only — the operational source of truth for reordering is the preferred supplier set on each product or warehouse policy.</div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy} onClick={() => onSave({
          companyName: f.companyName,
          contactPerson: f.contactPerson || null,
          email: f.email || null,
          phone: f.phone || null,
          address: f.address || null,
          taxNumber: f.taxNumber || null,
          paymentTerms: f.paymentTerms || null,
          leadTimeDays: Number(f.leadTimeDays) || 0,
          rating: f.rating ? Number(f.rating) : null,
          isPreferred: f.isPreferred,
          notes: f.notes || null,
        })}>Save</button>
      </div>
    </div>
  );
}

function CatalogTab({ supplierId }: { supplierId: string }) {
  const [rows, setRows] = useState<SupplierProductResponse[] | null>(null);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [supplierSku, setSupplierSku] = useState('');
  const [cost, setCost] = useState('');
  const [moq, setMoq] = useState('');

  const reload = useCallback(() => {
    api.supplierAdmin.products(supplierId).then(setRows).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [supplierId]);
  useEffect(() => {
    reload();
    api.products('ACTIVE').then(setProducts).catch(() => {});
  }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  function add() {
    if (!productId) return setError('Select a product');
    run(() => api.supplierAdmin.addProduct(supplierId, {
      productId,
      supplierSku: supplierSku || undefined,
      cost: cost ? Number(cost) : undefined,
      minOrderQty: moq ? Number(moq) : undefined,
    })).then(() => { setProductId(''); setSupplierSku(''); setCost(''); setMoq(''); });
  }
  const hasCost = (rows ?? []).some((r) => r.cost !== undefined);

  return (
    <div className="card">
      <div className="field-row" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto', alignItems: 'end' }}>
        <div><label>Product</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </select>
        </div>
        <div><label>Supplier SKU</label><input value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} /></div>
        <div><label>Cost</label><input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div><label>Min order qty</label><input type="number" min="0" value={moq} onChange={(e) => setMoq(e.target.value)} /></div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={add}>Link</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="grid">
          <thead>
            <tr>
              <th>SKU</th><th>Product</th><th>Supplier SKU</th>
              {hasCost && <th className="num">Cost</th>}<th className="num">MOQ</th><th>Preferred</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? <tr><td colSpan={8} className="muted">Loading…</td></tr> : rows.length === 0 ? (
              <tr><td colSpan={8} className="muted">No products linked yet.</td></tr>
            ) : rows.map((r) => (
              editId === r.id ? (
                <ProductEditRow key={r.id} r={r} busy={busy} hasCost={hasCost}
                  onCancel={() => setEditId(null)}
                  onSave={(body) => run(() => api.supplierAdmin.updateProduct(supplierId, r.id, body)).then(() => setEditId(null))} />
              ) : (
                <tr key={r.id}>
                  <td>{r.productSku}</td>
                  <td>{r.productName}</td>
                  <td>{r.supplierSku ?? '—'}</td>
                  {hasCost && <td className="num">{r.cost ?? '—'}</td>}
                  <td className="num">{r.minOrderQty ?? '—'}</td>
                  <td>{r.isPreferred ? '★' : '—'}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td><div className="toolbar">
                    {r.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => setEditId(r.id)}>Edit</button>}
                    {r.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(() => api.supplierAdmin.changeProductStatus(supplierId, r.id, 'INACTIVE'))}>Deactivate</button>}
                    {r.status === 'INACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(() => api.supplierAdmin.changeProductStatus(supplierId, r.id, 'ACTIVE'))}>Activate</button>}
                    {r.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => { if (window.confirm('Archive this link?')) run(() => api.supplierAdmin.changeProductStatus(supplierId, r.id, 'ARCHIVED')); }}>Archive</button>}
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

function ProductEditRow({ r, busy, hasCost, onCancel, onSave }: {
  r: SupplierProductResponse; busy: boolean; hasCost: boolean;
  onCancel: () => void; onSave: (b: { supplierSku?: string; cost?: number; minOrderQty?: number; isPreferred?: boolean }) => void;
}) {
  const [supplierSku, setSupplierSku] = useState(r.supplierSku ?? '');
  const [cost, setCost] = useState(r.cost ?? '');
  const [moq, setMoq] = useState(r.minOrderQty ?? '');
  const [isPreferred, setIsPreferred] = useState(r.isPreferred);
  return (
    <tr>
      <td>{r.productSku}</td>
      <td>{r.productName}</td>
      <td><input value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} style={{ width: 110 }} /></td>
      {hasCost && <td className="num"><input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: 90 }} /></td>}
      <td className="num"><input type="number" min="0" value={moq} onChange={(e) => setMoq(e.target.value)} style={{ width: 80 }} /></td>
      <td><input type="checkbox" style={{ width: 'auto' }} checked={isPreferred} onChange={(e) => setIsPreferred(e.target.checked)} /></td>
      <td><StatusBadge status={r.status} /></td>
      <td><div className="toolbar">
        <button className="btn small" style={{ marginTop: 0 }} disabled={busy} onClick={() => onSave({
          supplierSku: supplierSku || undefined,
          cost: cost !== '' ? Number(cost) : undefined,
          minOrderQty: moq !== '' ? Number(moq) : undefined,
          isPreferred,
        })}>Save</button>
        <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={onCancel}>Cancel</button>
      </div></td>
    </tr>
  );
}

function HistoryTab({ supplierId }: { supplierId: string }) {
  const [rows, setRows] = useState<AuditEntryResponse[] | null>(null);
  useEffect(() => { api.audit.forEntity('supplier', supplierId).then(setRows).catch(() => setRows([])); }, [supplierId]);
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

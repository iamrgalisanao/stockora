'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';

export default function NewSupplierPage() {
  const router = useRouter();
  const [f, setF] = useState({
    code: '', companyName: '', contactPerson: '', email: '', phone: '',
    address: '', taxNumber: '', paymentTerms: '', leadTimeDays: '0', rating: '',
    isPreferred: false, notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }

  async function save() {
    setError(null);
    if (!f.code.trim() || !f.companyName.trim()) return setError('Code and company name are required');
    setBusy(true);
    try {
      const created = await api.supplierAdmin.create({
        code: f.code, companyName: f.companyName,
        contactPerson: f.contactPerson || undefined,
        email: f.email || undefined,
        phone: f.phone || undefined,
        address: f.address || undefined,
        taxNumber: f.taxNumber || undefined,
        paymentTerms: f.paymentTerms || undefined,
        leadTimeDays: f.leadTimeDays ? Number(f.leadTimeDays) : undefined,
        rating: f.rating ? Number(f.rating) : undefined,
        isPreferred: f.isPreferred,
        notes: f.notes || undefined,
      });
      router.push(`/suppliers/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New supplier</h1>
        <button className="btn secondary small" onClick={() => router.push('/suppliers')}>Cancel</button>
      </div>
      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div><label>Code *</label><input value={f.code} onChange={(e) => set('code', e.target.value)} /></div>
          <div><label>Company name *</label><input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></div>
          <div><label>Contact person</label><input value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></div>
          <div><label>Email</label><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div><label>Phone</label><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div><label>Lead time (days)</label><input type="number" min="0" value={f.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} /></div>
          <div><label>Tax number</label><input value={f.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} /></div>
          <div><label>Payment terms</label><input value={f.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="e.g. Net 30" /></div>
          <div><label>Rating (1–5)</label><input type="number" min="1" max="5" value={f.rating} onChange={(e) => set('rating', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><label>Address</label><input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="optional" /></div>
        <div style={{ marginTop: 12 }}><label>Notes</label><input value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="optional" /></div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isPreferred} onChange={(e) => set('isPreferred', e.target.checked)} /> Preferred vendor</label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Working…' : 'Create supplier'}</button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Link products (SKU, cost, MOQ) from the supplier&apos;s Catalog tab after creating.</div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WAREHOUSE_TYPES } from '@iw/contracts';
import { api } from '../../../../lib/api';

export default function NewWarehousePage() {
  const router = useRouter();
  const [f, setF] = useState({
    code: '', name: '', type: 'MAIN', address: '', phone: '', email: '',
    isDefault: false, allowReceiving: true, allowDispatch: true, notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }

  async function save() {
    setError(null);
    if (!f.code.trim() || !f.name.trim()) return setError('Code and name are required');
    setBusy(true);
    try {
      const created = await api.warehouseAdmin.create({
        code: f.code, name: f.name, type: f.type,
        address: f.address || undefined, phone: f.phone || undefined, email: f.email || undefined,
        isDefault: f.isDefault, allowReceiving: f.allowReceiving, allowDispatch: f.allowDispatch,
        notes: f.notes || undefined,
      });
      router.push(`/warehouses/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New warehouse</h1>
        <button className="btn secondary small" onClick={() => router.push('/warehouses')}>Cancel</button>
      </div>
      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div><label>Code *</label><input value={f.code} onChange={(e) => set('code', e.target.value)} /></div>
          <div><label>Name *</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div><label>Type</label>
            <select value={f.type} onChange={(e) => set('type', e.target.value)}>
              {WAREHOUSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Phone</label><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div><label>Email</label><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}><label>Address</label><input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="optional" /></div>
        <div style={{ marginTop: 12 }}><label>Notes</label><input value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="optional" /></div>
        <div className="toolbar" style={{ marginTop: 12, gap: 16 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default warehouse</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.allowReceiving} onChange={(e) => set('allowReceiving', e.target.checked)} /> Allow receiving</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.allowDispatch} onChange={(e) => set('allowDispatch', e.target.checked)} /> Allow dispatch</label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Working…' : 'Create warehouse'}</button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Build the location hierarchy from the warehouse&apos;s Locations tab after creating.</div>
      </div>
    </div>
  );
}

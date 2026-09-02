'use client';

import { useState } from 'react';
import type { BrandResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { MasterDataManager } from '../../../../components/master-data';

function BrandForm({ editing, onDone }: { editing: BrandResponse | null; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [manufacturer, setManufacturer] = useState(editing?.manufacturer ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setError('Name is required');
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.brands.update(editing.id, { name, manufacturer: manufacturer || undefined });
      else await api.brands.create({ name, manufacturer: manufacturer || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 8 }}>{editing ? `Edit ${editing.name}` : 'New brand'}</div>
      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr auto auto' }}>
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Manufacturer</label><input value={manufacturer ?? ''} onChange={(e) => setManufacturer(e.target.value)} placeholder="optional" /></div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={save}>{editing ? 'Save' : 'Create'}</button>
        <button className="btn secondary" style={{ marginTop: 0 }} onClick={onDone}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default function BrandsAdminPage() {
  return (
    <MasterDataManager<BrandResponse>
      title="Brands"
      entityType="brand"
      columns={[
        { header: 'Name', render: (r) => r.name },
        { header: 'Manufacturer', render: (r) => r.manufacturer ?? '—' },
      ]}
      load={(q, status) => api.brands.list(q, status)}
      changeStatus={(id, status) => api.brands.changeStatus(id, status)}
      labelOf={(r) => r.name}
      renderForm={(editing, onDone) => <BrandForm key={editing?.id ?? 'new'} editing={editing} onDone={onDone} />}
    />
  );
}

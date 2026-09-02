'use client';

import { useState } from 'react';
import type { UnitResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { MasterDataManager } from '../../../../components/master-data';

function UnitForm({ editing, onDone }: { editing: UnitResponse | null; onDone: () => void }) {
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [precision, setPrecision] = useState(String(editing?.precision ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || (!editing && !code.trim())) return setError('Code and name are required');
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.units.update(editing.id, { name, precision: Number(precision) });
      else await api.units.create({ code, name, precision: Number(precision) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 8 }}>{editing ? `Edit ${editing.code}` : 'New unit'}</div>
      <div className="field-row" style={{ gridTemplateColumns: '120px 1fr 120px auto auto' }}>
        <div><label>Code</label><input value={code} disabled={!!editing} onChange={(e) => setCode(e.target.value)} placeholder="PCS" /></div>
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Precision</label><input type="number" min="0" max="6" value={precision} onChange={(e) => setPrecision(e.target.value)} /></div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={save}>{editing ? 'Save' : 'Create'}</button>
        <button className="btn secondary" style={{ marginTop: 0 }} onClick={onDone}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default function UnitsAdminPage() {
  return (
    <MasterDataManager<UnitResponse>
      title="Units of Measure"
      entityType="unit"
      columns={[
        { header: 'Code', render: (r) => r.code },
        { header: 'Name', render: (r) => r.name },
        { header: 'Precision', render: (r) => r.precision, num: true },
      ]}
      load={(q, status) => api.units.list(q, status)}
      changeStatus={(id, status) => api.units.changeStatus(id, status)}
      labelOf={(r) => r.code}
      renderForm={(editing, onDone) => <UnitForm key={editing?.id ?? 'new'} editing={editing} onDone={onDone} />}
    />
  );
}

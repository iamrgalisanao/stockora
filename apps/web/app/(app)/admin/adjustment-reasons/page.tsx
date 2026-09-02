'use client';

import { useEffect, useState } from 'react';
import type { AdjustmentReasonResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

export default function AdjustmentReasonsPage() {
  const [reasons, setReasons] = useState<AdjustmentReasonResponse[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .adjustmentReasons.list()
      .then(setReasons)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }
  useEffect(load, []);

  async function create() {
    setError(null);
    if (!code.trim() || !name.trim()) return setError('Code and name are required');
    setBusy(true);
    try {
      await api.adjustmentReasons.create({ code: code.trim().toUpperCase(), name: name.trim() });
      setCode('');
      setName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: AdjustmentReasonResponse) {
    setError(null);
    try {
      await api.adjustmentReasons.update(r.id, { isActive: !r.isActive });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Adjustment Reasons</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="muted" style={{ marginBottom: 8 }}>Add a reason</div>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
          <div>
            <label>Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SHRINKAGE" />
          </div>
          <div>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shrinkage" />
          </div>
          <button className="btn" disabled={busy} onClick={create} style={{ marginTop: 0 }}>Add</button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th>Code</th><th>Name</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {reasons.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td><span className={`badge ${r.isActive ? 'ok' : 'muted'}`}>{r.isActive ? 'Active' : 'Inactive'}</span></td>
                <td><button className="btn secondary small" onClick={() => toggle(r)}>{r.isActive ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

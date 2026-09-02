'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNT_TYPES, type CountType, type WarehouseResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

export default function NewCountPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState<CountType>('WAREHOUSE');
  const [isBlind, setIsBlind] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .warehouses()
      .then((w) => {
        setWarehouses(w);
        const def = w.find((x) => x.isDefault) ?? w[0];
        if (def) setWarehouseId(def.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  async function submit() {
    setError(null);
    if (!warehouseId) return setError('Select a warehouse');
    setBusy(true);
    try {
      const count = await api.counts.create({ warehouseId, type, isBlind, notes: notes || undefined });
      router.push(`/counts/${count.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New physical count</h1>
        <button className="btn secondary small" onClick={() => router.push('/counts')}>Cancel</button>
      </div>

      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div>
            <label>Warehouse *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as CountType)}>
              {COUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>Blind count</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={isBlind} onChange={(e) => setIsBlind(e.target.checked)} />
              Hide expected quantities from counters
            </label>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Start count (snapshot stock)'}</button>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Starting a count snapshots current on-hand for every product in the warehouse. Enter counted
          quantities, submit for review, approve, then post the variances to the ledger.
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProductResponse, ReturnType, WarehouseResponse } from '@iw/contracts';
import { RETURN_TYPES } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { LotPicker } from '../../../../components/LotPicker';

interface DraftLine { productId: string; quantity: string; lotId: string }

export default function NewReturnPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [type, setType] = useState<ReturnType>('CUSTOMER');
  const [warehouseId, setWarehouseId] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantity: '', lotId: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.products('ACTIVE').then(setProducts).catch(() => {});
    api.warehouses().then((w) => { setWarehouses(w); if (w[0]) setWarehouseId(w[0].id); }).catch(() => {});
  }, []);

  const isBatch = (productId: string) => products.find((p) => p.id === productId)?.isBatchTracked ?? false;
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: '', quantity: '', lotId: '' }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  async function submit(receiveNow: boolean) {
    setError(null);
    const chosen = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    if (!warehouseId) return setError('Select a warehouse.');
    if (chosen.length === 0) return setError('Add at least one line with a product and quantity.');
    // Batch-tracked products must reference a recognized lot (selected, not typed).
    if (chosen.some((l) => isBatch(l.productId) && !l.lotId)) return setError('Select a lot for each batch-tracked line.');
    const payloadLines = chosen.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), ...(l.lotId ? { lotId: l.lotId } : {}) }));
    setSaving(true);
    try {
      const created = await api.returns.create({
        type, warehouseId,
        sourceReference: sourceReference.trim() || undefined,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: payloadLines,
      });
      if (receiveNow) await api.returns.receive(created.id, {});
      router.push(`/returns/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create return');
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New return</h1>
        <Link href="/returns" className="btn secondary">Cancel</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div><label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as ReturnType)}>
              {RETURN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Warehouse *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div><label>Source reference</label><input value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="e.g. RMA-204" /></div>
        </div>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="topbar" style={{ marginBottom: 8 }}>
          <strong>Lines</strong>
          <button type="button" className="btn secondary" onClick={addLine}>+ Add line</button>
        </div>
        <table className="grid">
          <thead><tr><th>Product</th><th style={{ width: 280 }}>Lot</th><th className="num" style={{ width: 140 }}>Quantity</th><th style={{ width: 60 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value, lotId: '' })}>
                    <option value="">Select product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                  </select>
                </td>
                <td>
                  {isBatch(l.productId)
                    ? <LotPicker productId={l.productId} warehouseId={warehouseId} value={l.lotId} onChange={(lotId) => setLine(i, { lotId })} />
                    : <span className="muted">—</span>}
                </td>
                <td className="num"><input type="number" min="0" step="0.0001" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td><button type="button" className="btn secondary" onClick={() => removeLine(i)} disabled={lines.length === 1}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn" disabled={saving} onClick={() => submit(true)}>Create &amp; receive</button>
        <button className="btn secondary" disabled={saving} onClick={() => submit(false)}>Save as draft</button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Receiving lands the returned quantity in quarantine — physically on hand but not sellable until inspected.
      </p>
    </div>
  );
}

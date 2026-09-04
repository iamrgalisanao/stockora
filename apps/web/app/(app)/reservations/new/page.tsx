'use client';

import { toast } from 'sonner';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProductResponse, ReservationSource, WarehouseResponse } from '@iw/contracts';
import { RESERVATION_SOURCES } from '@iw/contracts';
import { api } from '../../../../lib/api';

interface DraftLine { productId: string; quantity: string }

export default function NewReservationPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [sourceType, setSourceType] = useState<ReservationSource>('MANUAL');
  const [sourceId, setSourceId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.products('ACTIVE').then(setProducts).catch(() => {});
    api.warehouses().then((w) => { setWarehouses(w); if (w[0]) setWarehouseId(w[0].id); }).catch(() => {});
  }, []);

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: '', quantity: '' }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  async function submit(confirmNow: boolean) {
    setError(null);
    const payloadLines = lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    if (!warehouseId) return setError('Select a warehouse.');
    if (payloadLines.length === 0) return setError('Add at least one line with a product and quantity.');
    setSaving(true);
    try {
      const created = await api.reservations.create({
        warehouseId,
        sourceType,
        sourceId: sourceId.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
        lines: payloadLines,
      });
      if (confirmNow) await api.reservations.confirm(created.id);
      toast.success(confirmNow ? 'Reservation confirmed' : 'Reservation created');
      router.push(`/reservations/${created.id}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Failed to create reservation';
      setError(m);
      toast.error(m);
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New reservation</h1>
        <Link href="/reservations" className="btn secondary">Cancel</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div><label>Warehouse *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div><label>Source</label>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value as ReservationSource)}>
              {RESERVATION_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Source reference</label><input value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder="e.g. SO-1042" /></div>
          <div><label>Expires at</label><input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="topbar" style={{ marginBottom: 8 }}>
          <strong>Lines</strong>
          <button type="button" className="btn secondary" onClick={addLine}>+ Add line</button>
        </div>
        <table className="grid">
          <thead><tr><th>Product</th><th className="num" style={{ width: 160 }}>Quantity</th><th style={{ width: 60 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                    <option value="">Select product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                  </select>
                </td>
                <td className="num"><input type="number" min="0" step="0.0001" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                <td><button type="button" className="btn secondary" onClick={() => removeLine(i)} disabled={lines.length === 1}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn" disabled={saving} onClick={() => submit(true)}>Create &amp; confirm</button>
        <button className="btn secondary" disabled={saving} onClick={() => submit(false)}>Save as draft</button>
      </div>
    </div>
  );
}

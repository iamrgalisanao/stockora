'use client';

import { toast } from 'sonner';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdjustmentDirection, AdjustmentReasonResponse, ProductResponse, WarehouseResponse } from '@iw/contracts';
import { api, type CreateAdjustmentBody } from '../../../../lib/api';

interface Line {
  productId: string;
  direction: AdjustmentDirection;
  quantity: string;
  unitCost: string;
}
const emptyLine = (): Line => ({ productId: '', direction: 'IN', quantity: '', unitCost: '' });

export default function NewAdjustmentPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [reasons, setReasons] = useState<AdjustmentReasonResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.warehouses(), api.products(), api.adjustmentReasons.list()])
      .then(([w, p, r]) => {
        setWarehouses(w);
        setProducts(p);
        setReasons(r.filter((x) => x.isActive));
        const def = w.find((x) => x.isDefault) ?? w[0];
        if (def) setWarehouseId(def.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError(null);
    if (!warehouseId) return setError('Select a warehouse');
    const items = lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: l.productId,
        direction: l.direction,
        quantity: Number(l.quantity),
        unitCost: l.direction === 'IN' && l.unitCost ? Number(l.unitCost) : undefined,
      }));
    if (items.length === 0) return setError('Add at least one line with a quantity');

    const body: CreateAdjustmentBody = { warehouseId, reasonId: reasonId || undefined, notes: notes || undefined, items };
    setBusy(true);
    try {
      const adj = await api.adjustments.create(body);
      toast.success('Adjustment created');
      router.push(`/adjustments/${adj.id}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Something went wrong';
      setError(m);
      toast.error(m);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New stock adjustment</h1>
        <button className="btn secondary small" onClick={() => router.push('/adjustments')}>Cancel</button>
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
            <label>Reason</label>
            <select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
              <option value="">—</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="muted">Lines</div>
            <button className="btn secondary small" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</button>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>Product</th><th>Direction</th><th className="num">Quantity</th><th className="num">Unit cost (IN)</th><th></th></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ minWidth: 220 }}>
                      <select className="inline" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                        <option value="">Select product…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="inline" value={l.direction} onChange={(e) => setLine(i, { direction: e.target.value as AdjustmentDirection })}>
                        <option value="IN">IN (+)</option>
                        <option value="OUT">OUT (−)</option>
                      </select>
                    </td>
                    <td className="num">
                      <input className="inline" style={{ width: 90, textAlign: 'right' }} type="number" min="0" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="inline" style={{ width: 100, textAlign: 'right' }} type="number" min="0" step="0.01" value={l.unitCost} disabled={l.direction === 'OUT'} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <button className="btn secondary small" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Create adjustment'}</button>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Adjustments require approval; high-value ones (above the org threshold) need a second, different approver before posting.
        </div>
      </div>
    </div>
  );
}

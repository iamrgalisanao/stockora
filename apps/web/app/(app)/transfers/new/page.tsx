'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductResponse, WarehouseResponse } from '@iw/contracts';
import { api, type CreateTransferBody } from '../../../../lib/api';

interface Line {
  productId: string;
  quantity: string;
}
const emptyLine = (): Line => ({ productId: '', quantity: '' });

export default function NewTransferPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [sourceWarehouseId, setSource] = useState('');
  const [destWarehouseId, setDest] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.warehouses(), api.products()])
      .then(([w, p]) => {
        setWarehouses(w);
        setProducts(p);
        if (w[0]) setSource(w[0].id);
        if (w[1]) setDest(w[1].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError(null);
    if (!sourceWarehouseId || !destWarehouseId) return setError('Select both warehouses');
    if (sourceWarehouseId === destWarehouseId) return setError('Source and destination must differ');
    const items = lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    if (items.length === 0) return setError('Add at least one line with a quantity');

    const body: CreateTransferBody = { sourceWarehouseId, destWarehouseId, reference: reference || undefined, items };
    setBusy(true);
    try {
      const transfer = await api.transfers.create(body);
      router.push(`/transfers/${transfer.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New stock transfer</h1>
        <button className="btn secondary small" onClick={() => router.push('/transfers')}>Cancel</button>
      </div>

      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div>
            <label>From warehouse *</label>
            <select value={sourceWarehouseId} onChange={(e) => setSource(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label>To warehouse *</label>
            <select value={destWarehouseId} onChange={(e) => setDest(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label>Reference</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="muted">Lines</div>
            <button className="btn secondary small" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</button>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Product</th><th className="num">Quantity</th><th></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ minWidth: 240 }}>
                      <select className="inline" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                        <option value="">Select product…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                      </select>
                    </td>
                    <td className="num">
                      <input className="inline" style={{ width: 110, textAlign: 'right' }} type="number" min="0" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
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
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Create transfer'}</button>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Transfers require approval, then dispatch (stock goes in-transit) and receive at the destination.
        </div>
      </div>
    </div>
  );
}

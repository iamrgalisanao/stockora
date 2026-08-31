'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  RELEASE_DESTINATION_TYPES,
  type ProductResponse,
  type ReleaseDestinationType,
  type WarehouseResponse,
} from '@iw/contracts';
import { api, type CreateReleaseBody } from '../../../../lib/api';

interface Line {
  productId: string;
  requestedQty: string;
}
const emptyLine = (): Line => ({ productId: '', requestedQty: '' });

export default function NewReleasePage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [destinationType, setDestinationType] = useState<ReleaseDestinationType>('CUSTOMER');
  const [purpose, setPurpose] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.warehouses(), api.products()])
      .then(([w, p]) => {
        setWarehouses(w);
        setProducts(p);
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
      .filter((l) => l.productId && Number(l.requestedQty) > 0)
      .map((l) => ({ productId: l.productId, requestedQty: Number(l.requestedQty) }));
    if (items.length === 0) return setError('Add at least one line with a quantity');

    const body: CreateReleaseBody = {
      warehouseId,
      destinationType,
      purpose: purpose || undefined,
      reference: reference || undefined,
      items,
    };
    setBusy(true);
    try {
      const release = await api.releases.create(body);
      router.push(`/releases/${release.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">New stock release</h1>
        <button className="btn secondary small" onClick={() => router.push('/releases')}>Cancel</button>
      </div>

      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div>
            <label>Warehouse *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Destination</label>
            <select value={destinationType} onChange={(e) => setDestinationType(e.target.value as ReleaseDestinationType)}>
              {RELEASE_DESTINATION_TYPES.map((d) => (
                <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Purpose</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="optional" />
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
              <thead>
                <tr><th>Product</th><th className="num">Requested qty</th><th></th></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ minWidth: 240 }}>
                      <select className="inline" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                        <option value="">Select product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input className="inline" style={{ width: 110, textAlign: 'right' }} type="number" min="0" value={l.requestedQty} onChange={(e) => setLine(i, { requestedQty: e.target.value })} />
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
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Create release'}</button>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Releases require approval: after creating, submit for approval, then an approver approves before it can be posted to stock.
        </div>
      </div>
    </div>
  );
}

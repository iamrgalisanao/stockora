'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  SERIAL_STATUSES,
  type ProductResponse,
  type SerialReconciliationResult,
  type SerialResponse,
  type SerialStatus,
  type WarehouseResponse,
} from '@iw/contracts';
import { api } from '../../../lib/api';

const STATUS_LABEL: Record<SerialStatus, string> = {
  IN_STOCK: 'In stock',
  RESERVED: 'Reserved',
  IN_TRANSIT: 'In transit',
  QUARANTINED: 'Quarantined',
  DAMAGED: 'Damaged',
  ISSUED: 'Issued',
  DISPOSED: 'Disposed',
};

export default function SerialsPage() {
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState<SerialStatus | ''>('');
  const [inInventory, setInInventory] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SerialResponse[]>([]);
  const [recon, setRecon] = useState<SerialReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => { api.products().then((p) => setProducts(p.filter((x) => x.isSerialized))).catch(() => {}); }, []);
  useEffect(() => { api.serials.reconcile().then(setRecon).catch(() => setRecon(null)); }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.serials
        .list({ warehouseId: warehouseId || undefined, productId: productId || undefined, status: status || undefined, inInventory: inInventory || undefined, q: q.trim() || undefined })
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [warehouseId, productId, status, inInventory, q]);

  const whCode = useMemo(() => new Map(warehouses.map((w) => [w.id, w.code])), [warehouses]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Serials</h1>
      </div>

      {recon && (
        <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${recon.ok ? 'var(--ok, #1a7f37)' : 'var(--danger, #b3261e)'}` }}>
          {recon.ok ? (
            <div className="muted" style={{ fontSize: 13 }}>
              ✓ Registry reconciles to the ledger — {recon.serialsChecked} serial{recon.serialsChecked === 1 ? '' : 's'} in inventory, no drift.
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠ {recon.drift.length} reconciliation drift{recon.drift.length === 1 ? '' : 's'}</div>
              <div className="table-wrap">
                <table className="grid">
                  <thead><tr><th>Product</th><th>Warehouse</th><th>Lot</th><th>Bucket</th><th className="num">Serials</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {recon.drift.map((d, i) => (
                      <tr key={i}>
                        <td>{d.productSku}</td>
                        <td>{d.warehouseId ? whCode.get(d.warehouseId) ?? d.warehouseId : '—'}</td>
                        <td>{d.lotId ? d.lotId.slice(0, 8) : '—'}</td>
                        <td>{d.bucket}</td>
                        <td className="num">{d.serialCount}</td>
                        <td className="num">{d.balanceQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1.5fr', gap: 10, alignItems: 'end' }}>
          <div>
            <label>Product</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">All serialized</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All (my scope)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as SerialStatus | '')}>
              <option value="">Any</option>
              {SERIAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label>Serial number</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial…" />
          </div>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" checked={inInventory} onChange={(e) => setInInventory(e.target.checked)} disabled={!!status} />
          Currently in inventory only
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Product</th>
                <th>Status</th>
                <th>Warehouse</th>
                <th>Lot</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace' }}><Link href={`/serials/${r.id}`}>{r.serialNumber}</Link></td>
                  <td>{r.productSku} — {r.productName}</td>
                  <td>{STATUS_LABEL[r.status]}</td>
                  <td>{r.warehouseCode ?? '—'}</td>
                  <td>{r.lotNumber ?? '—'}</td>
                  <td>{r.receivedAt ? new Date(r.receivedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>No serials found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Loading…</div>}
      </div>
    </div>
  );
}

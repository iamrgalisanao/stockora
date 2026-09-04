'use client';

import { toast } from 'sonner';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductResponse, SupplierResponse, WarehouseResponse } from '@iw/contracts';
import { api, type CreateReceiptBody } from '../../../../lib/api';

interface Line {
  productId: string;
  expectedQty: string;
  receivedQty: string;
  unitCost: string;
  batchNumber: string;
  /** One serial per line/comma — parsed into serialNumbers[] on submit (serialized products). */
  serials: string;
}

const emptyLine = (): Line => ({ productId: '', expectedQty: '', receivedQty: '', unitCost: '', batchNumber: '', serials: '' });

const parseSerials = (raw: string): string[] =>
  raw.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);

export default function NewReceiptPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);

  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [poRef, setPoRef] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.warehouses(), api.suppliers(), api.products()])
      .then(([w, s, p]) => {
        setWarehouses(w);
        setSuppliers(s);
        setProducts(p);
        const def = w.find((x) => x.isDefault) ?? w[0];
        if (def) setWarehouseId(def.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function onPickProduct(i: number, productId: string) {
    const p = productById.get(productId);
    setLine(i, { productId, unitCost: p?.cost ?? lines[i]?.unitCost ?? '' });
  }

  function buildBody(): CreateReceiptBody | null {
    if (!warehouseId) {
      setError('Select a warehouse');
      return null;
    }
    const items = lines
      .filter((l) => l.productId)
      .map((l) => {
        const p = productById.get(l.productId);
        const serialNumbers = p?.isSerialized ? parseSerials(l.serials) : undefined;
        return {
          productId: l.productId,
          expectedQty: l.expectedQty ? Number(l.expectedQty) : undefined,
          receivedQty: l.receivedQty ? Number(l.receivedQty) : undefined,
          unitCost: l.unitCost ? Number(l.unitCost) : undefined,
          batchNumber: p?.isBatchTracked && l.batchNumber ? l.batchNumber : undefined,
          serialNumbers: serialNumbers && serialNumbers.length > 0 ? serialNumbers : undefined,
        };
      });
    if (items.length === 0) {
      setError('Add at least one product line');
      return null;
    }
    return {
      warehouseId,
      supplierId: supplierId || undefined,
      purchaseOrderRef: poRef || undefined,
      orderDate: orderDate ? new Date(orderDate).toISOString() : undefined,
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString() : undefined,
      notes: notes || undefined,
      items,
    };
  }

  async function submit(post: boolean) {
    setError(null);
    const body = buildBody();
    if (!body) return;
    setBusy(true);
    try {
      const receipt = await api.receiving.create(body);
      if (post) {
        await api.receiving.post(receipt.id);
        toast.success(`Receipt ${receipt.receiptNumber} posted`);
        router.push('/inventory');
      } else {
        toast.success('Draft receipt saved');
        router.push('/receiving');
      }
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
        <h1 className="h1">New goods receipt</h1>
        <button className="btn secondary small" onClick={() => router.push('/receiving')}>Cancel</button>
      </div>

      <div className="card">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
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
            <label>Supplier</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.companyName}</option>
              ))}
            </select>
          </div>
          <div>
            <label>PO reference</label>
            <input value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label>Order date</label>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div>
            <label>Expected delivery</label>
            <input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Order &amp; expected-delivery dates are optional — they power supplier lead-time and on-time analytics.
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="muted">Lines</div>
            <button className="btn secondary small" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</button>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Expected</th>
                  <th className="num">Received</th>
                  <th className="num">Unit cost</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = l.productId ? productById.get(l.productId) : undefined;
                  const serialCount = p?.isSerialized ? parseSerials(l.serials).length : 0;
                  const receivedNum = Number(l.receivedQty || '0');
                  const serialMismatch = p?.isSerialized && l.serials.trim() !== '' && serialCount !== receivedNum;
                  return (
                    <React.Fragment key={i}>
                      <tr>
                        <td style={{ minWidth: 220 }}>
                          <select className="inline" value={l.productId} onChange={(e) => onPickProduct(i, e.target.value)}>
                            <option value="">Select product…</option>
                            {products.map((prod) => (
                              <option key={prod.id} value={prod.id}>{prod.sku} — {prod.name}</option>
                            ))}
                          </select>
                          {p && (p.isSerialized || p.isBatchTracked) && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                              {p.isBatchTracked && <span>batch-tracked</span>}
                              {p.isBatchTracked && p.isSerialized && <span> · </span>}
                              {p.isSerialized && <span>serialized</span>}
                            </div>
                          )}
                        </td>
                        <td className="num"><input className="inline" style={{ width: 90, textAlign: 'right' }} type="number" min="0" value={l.expectedQty} onChange={(e) => setLine(i, { expectedQty: e.target.value })} /></td>
                        <td className="num"><input className="inline" style={{ width: 90, textAlign: 'right' }} type="number" min="0" value={l.receivedQty} onChange={(e) => setLine(i, { receivedQty: e.target.value })} /></td>
                        <td className="num"><input className="inline" style={{ width: 100, textAlign: 'right' }} type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></td>
                        <td>
                          {lines.length > 1 && (
                            <button className="btn secondary small" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
                          )}
                        </td>
                      </tr>
                      {p && (p.isBatchTracked || p.isSerialized) && (
                        <tr>
                          <td colSpan={5} style={{ background: 'var(--surface-2, #fafafa)', paddingTop: 8, paddingBottom: 10 }}>
                            <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                              {p.isBatchTracked && (
                                <div>
                                  <label style={{ fontSize: 12 }}>Batch / lot number *</label>
                                  <input className="inline" style={{ width: 180 }} value={l.batchNumber} onChange={(e) => setLine(i, { batchNumber: e.target.value })} placeholder="e.g. LOT-2026-01" />
                                </div>
                              )}
                              {p.isSerialized && (
                                <div style={{ flex: 1, minWidth: 240 }}>
                                  <label style={{ fontSize: 12 }}>
                                    Serial numbers (one per line){' '}
                                    <span className={serialMismatch ? 'error' : 'muted'} style={{ fontSize: 11 }}>
                                      — {serialCount} entered{receivedNum > 0 ? ` of ${receivedNum}` : ''}
                                    </span>
                                  </label>
                                  <textarea
                                    style={{ width: '100%', minHeight: 64, fontFamily: 'monospace', fontSize: 12 }}
                                    value={l.serials}
                                    onChange={(e) => setLine(i, { serials: e.target.value })}
                                    placeholder={'SN-0001\nSN-0002\nSN-0003'}
                                  />
                                  <div className="muted" style={{ fontSize: 11 }}>
                                    Captured per unit at receipt. Count must match the received quantity. Leave blank if this product captures serials at issue.
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy} onClick={() => submit(true)}>
            {busy ? 'Working…' : 'Receive & post to stock'}
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => submit(false)}>
            Save as draft
          </button>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          "Receive &amp; post" writes a PURCHASE_RECEIPT to the inventory ledger and updates on-hand stock.
        </div>
      </div>
    </div>
  );
}

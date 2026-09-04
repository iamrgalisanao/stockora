'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AuthenticatedUser, ProductResponse, TransferResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { statusClass } from '../../../../lib/status';
import { SerialPicker } from '../../../../components/SerialPicker';

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [transfer, setTransfer] = useState<TransferResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [products, setProducts] = useState<Map<string, ProductResponse>>(new Map());
  const [serialSel, setSerialSel] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.transfers.get(id), api.me(), api.products()])
      .then(([t, u, ps]) => {
        setTransfer(t);
        setUser(u);
        setProducts(new Map(ps.map((p) => [p.id, p])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(load, [load]);

  const serialItems = useMemo(
    () => (transfer?.items ?? []).filter((i) => products.get(i.productId)?.isSerialized && Number(i.quantity) > 0),
    [transfer, products],
  );
  const serialsSatisfied = serialItems.every((i) => (serialSel[i.id]?.length ?? 0) === Number(i.quantity));
  const dispatchWithSerials = () =>
    api.transfers.dispatch(id, serialItems.map((i) => ({ itemId: i.id, serialNumbers: serialSel[i.id] ?? [] })));

  async function act(fn: () => Promise<TransferResponse>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setTransfer(res);
      toast.success(`Transfer ${res.status.replace(/_/g, ' ').toLowerCase()}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Action failed';
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  if (error && !transfer) return <div className="card error">{error}</div>;
  if (!transfer || !user) return <div className="card muted">Loading…</div>;

  const canApprove = user.permissions.includes('inventory.approve');
  const canTransfer = user.permissions.includes('inventory.transfer');
  const s = transfer.status;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{transfer.transferNumber}</h1>
        <button className="btn secondary small" onClick={() => router.push('/transfers')}>Back to list</button>
      </div>

      <div className="card">
        <div>
          <span className={`badge ${statusClass(s)}`}>{s.replace(/_/g, ' ')}</span>
          <span className="muted" style={{ marginLeft: 12 }}>
            {transfer.sourceWarehouseCode} → {transfer.destWarehouseCode}
            {transfer.reference ? ` · ${transfer.reference}` : ''}
          </span>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Product</th>
                <th className="num">Quantity</th><th className="num">Dispatched</th><th className="num">Received</th>
              </tr>
            </thead>
            <tbody>
              {transfer.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productSku}</td>
                  <td>{i.productName}{i.serialNumbers.length > 0 ? <span className="muted" style={{ fontSize: 11 }}> · {i.serialNumbers.join(', ')}</span> : null}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{i.qtyDispatched}</td>
                  <td className="num">{i.qtyReceived}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Dispatch: select the exact serials at the source (2D.3C). */}
        {s === 'APPROVED' && canTransfer && serialItems.length > 0 && (
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            {serialItems.map((i) => (
              <div key={i.id}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{i.productSku} — select serials to send</div>
                <SerialPicker
                  mode="select" productId={i.productId} variantId={i.variantId}
                  warehouseId={transfer.sourceWarehouseId} requiredCount={Number(i.quantity)}
                  value={serialSel[i.id] ?? []} onChange={(v) => setSerialSel((prev) => ({ ...prev, [i.id]: v }))}
                />
              </div>
            ))}
          </div>
        )}

        {/* Receive: show the exact dispatched set — no generic picker, so no substitution (2D.3C). */}
        {(s === 'IN_TRANSIT' || s === 'PARTIALLY_RECEIVED') && serialItems.length > 0 && (
          <div className="card" style={{ marginTop: 16, background: 'var(--surface-2,#fafafa)' }}>
            <strong style={{ fontSize: 13 }}>Verify the dispatched serials on arrival</strong>
            {serialItems.map((i) => (
              <div key={i.id} style={{ marginTop: 6, fontSize: 12 }}>
                <span className="muted">{i.productSku}:</span> <span style={{ fontFamily: 'monospace' }}>{i.serialNumbers.join(', ') || '—'}</span>
              </div>
            ))}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          {s === 'DRAFT' && canTransfer && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.transfers.submit(id))}>Submit for approval</button>
          )}
          {s === 'FOR_APPROVAL' && canApprove && (
            <>
              <button className="btn" disabled={busy} onClick={() => act(() => api.transfers.approve(id))}>Approve</button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Reason for rejection?') ?? '';
                  if (reason) act(() => api.transfers.reject(id, reason));
                }}
              >
                Reject
              </button>
            </>
          )}
          {s === 'FOR_APPROVAL' && !canApprove && <span className="muted">Awaiting approval.</span>}
          {s === 'APPROVED' && canTransfer && (
            <button className="btn" disabled={busy || !serialsSatisfied} onClick={() => act(dispatchWithSerials)}>
              Dispatch (send in-transit){serialItems.length > 0 && !serialsSatisfied ? ' (select serials first)' : ''}
            </button>
          )}
          {(s === 'IN_TRANSIT' || s === 'PARTIALLY_RECEIVED') && canTransfer && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.transfers.receive(id))}>Receive at destination</button>
          )}
          {['DRAFT', 'FOR_APPROVAL', 'APPROVED'].includes(s) && canTransfer && (
            <button className="btn secondary" disabled={busy} onClick={() => act(() => api.transfers.cancel(id))}>Cancel</button>
          )}
          {s === 'RECEIVED' && (
            <span className="badge ok">Received{transfer.receivedAt ? ` · ${new Date(transfer.receivedAt).toLocaleString()}` : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}

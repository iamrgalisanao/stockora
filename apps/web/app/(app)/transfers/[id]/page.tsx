'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AuthenticatedUser, TransferResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { statusClass } from '../../../../lib/status';

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [transfer, setTransfer] = useState<TransferResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.transfers.get(id), api.me()])
      .then(([t, u]) => {
        setTransfer(t);
        setUser(u);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<TransferResponse>) {
    setBusy(true);
    setError(null);
    try {
      setTransfer(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
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
                  <td>{i.productName}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{i.qtyDispatched}</td>
                  <td className="num">{i.qtyReceived}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
            <button className="btn" disabled={busy} onClick={() => act(() => api.transfers.dispatch(id))}>Dispatch (send in-transit)</button>
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

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AdjustmentResponse, AuthenticatedUser } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { statusClass } from '../../../../lib/status';

export default function AdjustmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [adj, setAdj] = useState<AdjustmentResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.adjustments.get(id), api.me()])
      .then(([a, u]) => {
        setAdj(a);
        setUser(u);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<AdjustmentResponse>) {
    setBusy(true);
    setError(null);
    try {
      setAdj(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (error && !adj) return <div className="card error">{error}</div>;
  if (!adj || !user) return <div className="card muted">Loading…</div>;

  const canApprove = user.permissions.includes('inventory.approve');
  const canAdjust = user.permissions.includes('inventory.adjust');
  const s = adj.status;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{adj.adjustmentNumber}</h1>
        <button className="btn secondary small" onClick={() => router.push('/adjustments')}>Back to list</button>
      </div>

      <div className="card">
        <div>
          <span className={`badge ${statusClass(s)}`}>{s.replace(/_/g, ' ')}</span>
          {adj.requiresSecondApproval && <span className="badge warn" style={{ marginLeft: 8 }}>2-approver required</span>}
          <span className="muted" style={{ marginLeft: 12 }}>
            {adj.warehouseCode}{adj.reasonName ? ` · ${adj.reasonName}` : ''}
            {adj.estimatedValue ? ` · est. value ${adj.estimatedValue}` : ''}
          </span>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Product</th><th>Direction</th><th className="num">Quantity</th>
                {adj.items.some((i) => i.unitCost !== undefined) && <th className="num">Unit cost</th>}
              </tr>
            </thead>
            <tbody>
              {adj.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productSku}</td>
                  <td>{i.productName}</td>
                  <td><span className={`badge ${i.direction === 'IN' ? 'ok' : 'muted'}`}>{i.direction}</span></td>
                  <td className="num">{i.quantity}</td>
                  {adj.items.some((x) => x.unitCost !== undefined) && <td className="num">{i.unitCost ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          {s === 'DRAFT' && canAdjust && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.adjustments.submit(id))}>Submit for approval</button>
          )}
          {s === 'SUBMITTED' && canApprove && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.adjustments.approve(id))}>Approve</button>
          )}
          {s === 'PENDING_SECOND_APPROVAL' && canApprove && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.adjustments.secondApprove(id))}>Second approval</button>
          )}
          {(s === 'SUBMITTED' || s === 'PENDING_SECOND_APPROVAL') && canApprove && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Reason for rejection?') ?? '';
                if (reason) act(() => api.adjustments.reject(id, reason));
              }}
            >
              Reject
            </button>
          )}
          {(s === 'SUBMITTED' || s === 'PENDING_SECOND_APPROVAL') && !canApprove && (
            <span className="muted">Awaiting approval.</span>
          )}
          {s === 'APPROVED' && canAdjust && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.adjustments.post(id))}>Post to ledger</button>
          )}
          {['DRAFT', 'SUBMITTED', 'PENDING_SECOND_APPROVAL', 'APPROVED'].includes(s) && canAdjust && (
            <button className="btn secondary" disabled={busy} onClick={() => act(() => api.adjustments.cancel(id))}>Cancel</button>
          )}
          {s === 'POSTED' && (
            <span className="badge ok">Posted{adj.postedAt ? ` · ${new Date(adj.postedAt).toLocaleString()}` : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}

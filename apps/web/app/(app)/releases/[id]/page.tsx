'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AuthenticatedUser, ReleaseResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { statusClass } from '../../../../lib/status';

export default function ReleaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [release, setRelease] = useState<ReleaseResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.releases.get(id), api.me()])
      .then(([r, u]) => {
        setRelease(r);
        setUser(u);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<ReleaseResponse>) {
    setBusy(true);
    setError(null);
    try {
      setRelease(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  // Posting a batch release surfaces two FEFO paths explicitly (ADR 0008): a non-FEFO lot selection needs
  // an override reason, and a plan gone stale (409) needs a refresh — neither hidden behind a raw error.
  async function postRelease(reason?: string) {
    setBusy(true);
    setError(null);
    try {
      setRelease(await api.releases.post(id, reason));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      if (/reason is required to override FEFO/i.test(msg)) {
        const r = window.prompt('This lot selection bypasses FEFO order. Enter a reason to override:');
        if (r && r.trim()) { setBusy(false); return postRelease(r.trim()); }
        setError('FEFO override cancelled — an earlier-expiring lot is available.');
      } else if (/stale|no longer has enough/i.test(msg)) {
        setError('Stock changed since this allocation was generated. Refresh the FEFO plan and try again.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !release) return <div className="card error">{error}</div>;
  if (!release || !user) return <div className="card muted">Loading…</div>;

  const canApprove = user.permissions.includes('inventory.approve');
  const canRelease = user.permissions.includes('inventory.release');
  const s = release.status;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{release.releaseNumber}</h1>
        <button className="btn secondary small" onClick={() => router.push('/releases')}>Back to list</button>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <span className={`badge ${statusClass(s)}`}>{s.replace(/_/g, ' ')}</span>
            <span className="muted" style={{ marginLeft: 12 }}>
              {release.warehouseCode} · {release.destinationType.replace(/_/g, ' ')}
              {release.purpose ? ` · ${release.purpose}` : ''}
            </span>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Product</th>
                <th className="num">Requested</th><th className="num">Approved</th><th className="num">Released</th>
              </tr>
            </thead>
            <tbody>
              {release.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productSku}</td>
                  <td>{i.productName}</td>
                  <td className="num">{i.requestedQty}</td>
                  <td className="num">{i.approvedQty}</td>
                  <td className="num">{i.releasedQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          {s === 'DRAFT' && canRelease && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.releases.submit(id))}>Submit for approval</button>
          )}
          {s === 'FOR_APPROVAL' && canApprove && (
            <>
              <button className="btn" disabled={busy} onClick={() => act(() => api.releases.approve(id))}>Approve</button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Reason for rejection?') ?? '';
                  if (reason) act(() => api.releases.reject(id, reason));
                }}
              >
                Reject
              </button>
            </>
          )}
          {s === 'FOR_APPROVAL' && !canApprove && (
            <span className="muted">Awaiting approval by an authorized approver.</span>
          )}
          {s === 'APPROVED' && canRelease && (
            <button className="btn" disabled={busy} onClick={() => postRelease()}>Release to stock</button>
          )}
          {['DRAFT', 'FOR_APPROVAL', 'APPROVED'].includes(s) && canRelease && (
            <button className="btn secondary" disabled={busy} onClick={() => act(() => api.releases.cancel(id))}>Cancel</button>
          )}
          {s === 'RELEASED' && <span className="badge ok">Posted to the ledger{release.postedAt ? ` · ${new Date(release.postedAt).toLocaleString()}` : ''}</span>}
        </div>
      </div>
    </div>
  );
}

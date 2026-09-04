'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AuthenticatedUser, ProductResponse, ReleaseResponse, SerialCaptureMode } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { statusClass } from '../../../../lib/status';
import { SerialPicker } from '../../../../components/SerialPicker';

export default function ReleaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [release, setRelease] = useState<ReleaseResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [products, setProducts] = useState<Map<string, ProductResponse>>(new Map());
  const [captureMode, setCaptureMode] = useState<Map<string, SerialCaptureMode>>(new Map());
  const [serialSel, setSerialSel] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.releases.get(id), api.me(), api.products()])
      .then(async ([r, u, ps]) => {
        setRelease(r);
        setUser(u);
        setProducts(new Map(ps.map((p) => [p.id, p])));
        // Capture mode per serialized product decides select (RECEIPT) vs capture-new (ISSUE).
        const serializedIds = [...new Set(r.items.map((i) => i.productId).filter((pid) => ps.find((p) => p.id === pid)?.isSerialized))];
        const modes = await Promise.all(serializedIds.map((pid) => api.serials.policy(pid).then((pol) => [pid, pol.captureMode] as const).catch(() => [pid, 'RECEIPT' as SerialCaptureMode] as const)));
        setCaptureMode(new Map(modes));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(load, [load]);

  const serialItems = useMemo(
    () => (release?.items ?? []).filter((i) => products.get(i.productId)?.isSerialized && Number(i.approvedQty) > 0),
    [release, products],
  );
  const serialsSatisfied = serialItems.every((i) => (serialSel[i.id]?.length ?? 0) === Number(i.approvedQty));

  async function act(fn: () => Promise<ReleaseResponse>) {
    setBusy(true);
    setError(null);
    try { const res = await fn(); setRelease(res); toast.success(`Release ${res.status.replace(/_/g, ' ').toLowerCase()}`); } catch (e) { const m = e instanceof Error ? e.message : 'Action failed'; setError(m); toast.error(m); } finally { setBusy(false); }
  }

  // Posting a batch release surfaces two FEFO paths explicitly (ADR 0008): a non-FEFO lot selection needs
  // an override reason, and a plan gone stale (409) needs a refresh — neither hidden behind a raw error.
  async function postRelease(reason?: string) {
    setBusy(true);
    setError(null);
    const serials = serialItems.map((i) => ({ itemId: i.id, serialNumbers: serialSel[i.id] ?? [] }));
    try {
      setRelease(await api.releases.post(id, reason, serials));
      toast.success('Release posted');
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
        toast.error(msg);
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
                  <td>{i.productName}{i.serialNumbers.length > 0 ? <span className="muted" style={{ fontSize: 11 }}> · {i.serialNumbers.join(', ')}</span> : null}</td>
                  <td className="num">{i.requestedQty}</td>
                  <td className="num">{i.approvedQty}</td>
                  <td className="num">{i.releasedQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Serial selection / capture at post (2D.3C) */}
        {s === 'APPROVED' && canRelease && serialItems.length > 0 && (
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            {serialItems.map((i) => {
              const mode: SerialCaptureMode = captureMode.get(i.productId) ?? 'RECEIPT';
              return (
                <div key={i.id}>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                    {i.productSku} — {mode === 'ISSUE' ? 'capture new serials at issue' : 'select serials to issue'}
                  </div>
                  <SerialPicker
                    mode={mode === 'ISSUE' ? 'capture' : 'select'}
                    productId={i.productId}
                    variantId={i.variantId}
                    warehouseId={release.warehouseId}
                    requiredCount={Number(i.approvedQty)}
                    value={serialSel[i.id] ?? []}
                    onChange={(v) => setSerialSel((prev) => ({ ...prev, [i.id]: v }))}
                  />
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          {s === 'DRAFT' && canRelease && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.releases.submit(id))}>Submit for approval</button>
          )}
          {s === 'FOR_APPROVAL' && canApprove && (
            <>
              <button className="btn" disabled={busy} onClick={() => act(() => api.releases.approve(id))}>Approve</button>
              <button className="btn secondary" disabled={busy} onClick={() => { const reason = window.prompt('Reason for rejection?') ?? ''; if (reason) act(() => api.releases.reject(id, reason)); }}>Reject</button>
            </>
          )}
          {s === 'FOR_APPROVAL' && !canApprove && (<span className="muted">Awaiting approval by an authorized approver.</span>)}
          {s === 'APPROVED' && canRelease && (
            <button className="btn" disabled={busy || !serialsSatisfied} onClick={() => postRelease()}>
              Release to stock{serialItems.length > 0 && !serialsSatisfied ? ' (select serials first)' : ''}
            </button>
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

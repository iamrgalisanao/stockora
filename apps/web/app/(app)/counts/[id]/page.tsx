'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AuthenticatedUser, CountResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { statusClass } from '../../../../lib/status';

export default function CountDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [count, setCount] = useState<CountResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.counts.get(id), api.me()])
      .then(([c, u]) => {
        setCount(c);
        setUser(u);
        setEntries(Object.fromEntries(c.items.map((i) => [i.id, i.countedQty ?? ''])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<CountResponse>) {
    setBusy(true);
    setError(null);
    try {
      const c = await fn();
      setCount(c);
      setEntries(Object.fromEntries(c.items.map((i) => [i.id, i.countedQty ?? ''])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveCounts() {
    if (!count) return;
    const items = count.items
      .filter((i) => entries[i.id] !== '' && entries[i.id] !== undefined)
      .map((i) => ({ itemId: i.id, countedQty: Number(entries[i.id]) }));
    if (items.length === 0) return setError('Enter at least one counted quantity');
    await act(() => api.counts.enter(id, items));
  }

  if (error && !count) return <div className="card error">{error}</div>;
  if (!count || !user) return <div className="card muted">Loading…</div>;

  const canCount = user.permissions.includes('inventory.count');
  const canApprove = user.permissions.includes('inventory.approve');
  const s = count.status;
  const counting = s === 'COUNTING';
  const showSystem = count.items.some((i) => i.systemQty !== undefined);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{count.countNumber}</h1>
        <button className="btn secondary small" onClick={() => router.push('/counts')}>Back to list</button>
      </div>

      <div className="card">
        <div>
          <span className={`badge ${statusClass(s)}`}>{s}</span>
          {count.isBlind && <span className="badge muted" style={{ marginLeft: 8 }}>blind</span>}
          <span className="muted" style={{ marginLeft: 12 }}>
            {count.warehouseCode} · {count.type}
            {count.varianceValue !== undefined ? ` · variance value ${count.varianceValue}` : ''}
          </span>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Product</th>
                {showSystem && <th className="num">System</th>}
                <th className="num">Counted</th>
                {showSystem && <th className="num">Variance</th>}
              </tr>
            </thead>
            <tbody>
              {count.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productSku}</td>
                  <td>{i.productName}</td>
                  {showSystem && <td className="num">{i.systemQty}</td>}
                  <td className="num">
                    {counting && canCount ? (
                      <input
                        className="inline"
                        style={{ width: 90, textAlign: 'right' }}
                        type="number"
                        min="0"
                        value={entries[i.id] ?? ''}
                        onChange={(e) => setEntries((p) => ({ ...p, [i.id]: e.target.value }))}
                      />
                    ) : (
                      (i.countedQty ?? '—')
                    )}
                  </td>
                  {showSystem && (
                    <td className="num">
                      {i.varianceQty !== undefined && i.varianceQty !== '0' ? (
                        <span className={`badge ${Number(i.varianceQty) > 0 ? 'ok' : 'warn'}`}>{i.varianceQty}</span>
                      ) : (
                        i.varianceQty ?? '—'
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="toolbar" style={{ marginTop: 18 }}>
          {counting && canCount && (
            <>
              <button className="btn secondary" disabled={busy} onClick={saveCounts}>Save counts</button>
              <button className="btn" disabled={busy} onClick={() => act(() => api.counts.submit(id))}>Submit for review</button>
            </>
          )}
          {s === 'REVIEW' && canApprove && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.counts.approve(id))}>Approve</button>
          )}
          {s === 'REVIEW' && !canApprove && <span className="muted">Awaiting approval.</span>}
          {s === 'APPROVED' && canCount && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.counts.post(id))}>Post variances to ledger</button>
          )}
          {['COUNTING', 'REVIEW', 'APPROVED'].includes(s) && canCount && (
            <button className="btn secondary" disabled={busy} onClick={() => act(() => api.counts.cancel(id))}>Cancel</button>
          )}
          {s === 'POSTED' && (
            <span className="badge ok">Posted{count.postedAt ? ` · ${new Date(count.postedAt).toLocaleString()}` : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { toast } from 'sonner';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { ReservationResponse, ReservationStatus } from '@iw/contracts';
import { api } from '../../../../lib/api';

const badgeClass = (s: ReservationStatus) =>
  s === 'RESERVED' || s === 'PARTIALLY_CONSUMED' ? 'ok'
    : s === 'CONSUMED' ? '' : s === 'EXPIRED' ? 'danger' : 'warn';

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');

export default function ReservationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<ReservationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.reservations.get(id)
      .then(setR)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function act(action: 'confirm' | 'release' | 'cancel', confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true); setError(null);
    try {
      const updated = await api.reservations[action](id);
      setR(updated);
      toast.success(`Reservation ${action === 'confirm' ? 'confirmed' : action === 'release' ? 'released' : 'cancelled'}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : `Failed to ${action}`;
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  if (error && !r) return <div className="error">{error}</div>;
  if (!r) return <div className="card muted">Loading…</div>;

  const isDraft = r.status === 'DRAFT';
  const isActive = r.status === 'RESERVED' || r.status === 'PARTIALLY_CONSUMED';

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{r.reservationNo} <span className={`badge ${badgeClass(r.status)}`}>{r.status}</span></h1>
        <Link href="/reservations" className="btn secondary">← All reservations</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 24px' }}>
          <div className="kv"><div className="k">Warehouse</div><div className="v">{r.warehouseCode}</div></div>
          <div className="kv"><div className="k">Source</div><div className="v">{r.sourceType}{r.sourceId ? ` · ${r.sourceId}` : ''}</div></div>
          <div className="kv"><div className="k">Expires</div><div className="v">{fmt(r.expiresAt)}</div></div>
          <div className="kv"><div className="k">Created</div><div className="v">{fmt(r.createdAt)}</div></div>
          <div className="kv"><div className="k">Confirmed</div><div className="v">{fmt(r.confirmedAt)}</div></div>
          <div className="kv"><div className="k">Completed</div><div className="v">{fmt(r.completedAt)}</div></div>
        </div>
        {r.notes && <p className="muted" style={{ marginTop: 10 }}>{r.notes}</p>}
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th>Product</th><th>Variant</th><th>Location</th><th className="num">Reserved</th><th className="num">Consumed</th><th className="num">Remaining</th></tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.productSku} — {l.productName}</td>
                <td>{l.variantId ?? '—'}</td>
                <td>{l.locationId ?? '—'}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{l.consumedQuantity}</td>
                <td className="num">{l.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {isDraft && <button className="btn" disabled={busy} onClick={() => act('confirm')}>Confirm reservation</button>}
        {isDraft && <button className="btn secondary" disabled={busy} onClick={() => act('cancel', 'Cancel this draft reservation?')}>Cancel</button>}
        {isActive && <button className="btn" disabled={busy} onClick={() => act('release', 'Release the remaining reserved quantity back to available?')}>Release remaining</button>}
        {isActive && <button className="btn secondary" disabled={busy} onClick={() => act('cancel', 'Cancel the remaining reservation? Remaining reserved quantity returns to available.')}>Cancel remaining</button>}
      </div>
    </div>
  );
}

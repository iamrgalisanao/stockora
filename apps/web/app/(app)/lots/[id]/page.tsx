'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { LotMovementRow, LotResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');
// Which source-document types deep-link to a page in this app.
const DOC_LINK: Record<string, string> = {
  goods_receipt: '/receiving', stock_release: '/releases', stock_transfer: '/transfers', inventory_return: '/returns',
};
const deltas = (m: LotMovementRow) => {
  const parts: string[] = [];
  const add = (label: string, v: string) => { if (Number(v) !== 0) parts.push(`${label} ${Number(v) > 0 ? '+' : ''}${v}`); };
  add('on hand', m.onHandDelta); add('reserved', m.reservedDelta); add('in transit', m.inTransitDelta);
  add('quarantined', m.quarantinedDelta); add('damaged', m.damagedDelta);
  return parts.join(', ') || '—';
};

export default function LotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lot, setLot] = useState<LotResponse | null>(null);
  const [movements, setMovements] = useState<LotMovementRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.lots.get(id).then(setLot).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    api.lots.movements(id).then(setMovements).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !lot) return <div className="error">{error}</div>;
  if (!lot) return <div className="card muted">Loading…</div>;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">
          Lot {lot.lotNumber}
          <span className={`badge ${lot.status === 'ACTIVE' ? 'ok' : 'muted'}`} style={{ marginLeft: 8 }}>{lot.status}</span>
          {lot.origin === 'LEGACY_MIGRATION' && <span className="badge warn" style={{ marginLeft: 6 }}>Migrated / Unspecified</span>}
        </h1>
        <Link href="/lots" className="btn secondary">← All lots</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 24px' }}>
          <div className="kv"><div className="k">Product</div><div className="v">{lot.productSku} — {lot.productName}</div></div>
          <div className="kv"><div className="k">Manufactured</div><div className="v">{fmtDate(lot.manufacturedAt)}</div></div>
          <div className="kv"><div className="k">Expiry</div><div className="v">{fmtDate(lot.expiryDate)}</div></div>
          <div className="kv"><div className="k">Received</div><div className="v">{fmtDate(lot.receivedAt)}</div></div>
          <div className="kv"><div className="k">On hand</div><div className="v">{lot.onHand}</div></div>
          <div className="kv"><div className="k">Quarantined</div><div className="v">{lot.quarantined}</div></div>
          <div className="kv"><div className="k">Damaged</div><div className="v">{lot.damaged}</div></div>
          <div className="kv"><div className="k">In transit</div><div className="v">{lot.inTransit}</div></div>
        </div>
      </div>

      <h2 className="h1" style={{ fontSize: 16, margin: '18px 0 8px' }}>Stock by warehouse</h2>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Warehouse</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Quarantined</th><th className="num">Damaged</th><th className="num">In transit</th><th className="num">Available</th></tr></thead>
          <tbody>
            {(lot.stock ?? []).length === 0 ? <tr><td colSpan={7} className="muted">No stock in scope.</td></tr> :
              (lot.stock ?? []).map((s) => (
                <tr key={s.warehouseId}>
                  <td>{s.warehouseCode}</td>
                  <td className="num">{s.onHand}</td><td className="num">{s.reserved}</td><td className="num">{s.quarantined}</td>
                  <td className="num">{s.damaged}</td><td className="num">{s.inTransit}</td><td className="num">{s.available}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h2 className="h1" style={{ fontSize: 16, margin: '18px 0 8px' }}>Movement history</h2>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>When</th><th>Event</th><th>Warehouse</th><th>Change</th><th>Document</th></tr></thead>
          <tbody>
            {movements.length === 0 ? <tr><td colSpan={5} className="muted">No movements.</td></tr> :
              movements.map((m) => {
                const href = m.documentType && m.documentId ? DOC_LINK[m.documentType] : undefined;
                return (
                  <tr key={m.id}>
                    <td>{fmt(m.occurredAt)}</td>
                    <td>{m.movementType}</td>
                    <td>{m.warehouseCode}</td>
                    <td>{deltas(m)}</td>
                    <td>{href
                      ? <Link href={`${href}/${m.documentId}`}>{m.documentReference}</Link>
                      : (m.documentReference ?? '—')}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

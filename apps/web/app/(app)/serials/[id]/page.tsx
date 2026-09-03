'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { SerialHistoryResponse, SerialEventType, SerialStatus } from '@iw/contracts';
import { api } from '../../../../lib/api';

const STATUS_LABEL: Record<SerialStatus, string> = {
  IN_STOCK: 'In stock', RESERVED: 'Reserved', IN_TRANSIT: 'In transit', QUARANTINED: 'Quarantined',
  DAMAGED: 'Damaged', ISSUED: 'Issued', DISPOSED: 'Disposed',
};
const EVENT_LABEL: Record<SerialEventType, string> = {
  RECEIVED: 'Received', ISSUED: 'Issued', TRANSFERRED_OUT: 'Transferred out', TRANSFERRED_IN: 'Transferred in',
  RETURNED: 'Returned', RESTOCKED: 'Restocked', DAMAGED: 'Damaged', DISPOSED: 'Disposed',
  ADJUSTED_IN: 'Adjusted in', ADJUSTED_OUT: 'Adjusted out', COUNT_FOUND: 'Count — found', COUNT_LOST: 'Count — lost',
};
const DOC_ROUTE: Record<string, string> = {
  goods_receipt: '/receiving', stock_release: '/releases', stock_transfer: '/transfers',
  inventory_return: '/returns', stock_adjustment: '/adjustments', stock_count: '/counts',
};

export default function SerialDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<SerialHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.serials.history(params.id).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [params.id]);

  const row = data?.serial;

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Serial detail</h1>
        <Link className="btn secondary small" href="/serials">← Serials</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {row && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
          {/* Summary + current state */}
          <div className="card">
            <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{row.serialNumber}</div>
            <div className="muted" style={{ marginBottom: 16 }}>{row.productSku} — {row.productName}</div>
            <dl style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 10, columnGap: 12, margin: 0 }}>
              <dt className="muted">Status</dt><dd style={{ margin: 0, fontWeight: 600 }}>{STATUS_LABEL[row.status]}</dd>
              <dt className="muted">Warehouse</dt><dd style={{ margin: 0 }}>{row.warehouseCode ?? '—'}</dd>
              <dt className="muted">Lot</dt><dd style={{ margin: 0 }}>{row.lotNumber ?? '—'}</dd>
              <dt className="muted">Variant</dt><dd style={{ margin: 0 }}>{row.variantId ?? 'base'}</dd>
              <dt className="muted">Received</dt><dd style={{ margin: 0 }}>{row.receivedAt ? new Date(row.receivedAt).toLocaleString() : '—'}</dd>
              <dt className="muted">Issued</dt><dd style={{ margin: 0 }}>{row.issuedAt ? new Date(row.issuedAt).toLocaleString() : '—'}</dd>
              <dt className="muted">Last movement</dt><dd style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{row.lastMovementId ?? '—'}</dd>
            </dl>
          </div>

          {/* Movement history / source documents */}
          <div className="card">
            <strong style={{ fontSize: 14 }}>Movement history</strong>
            {data && data.events.length === 0 && <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>No events yet.</div>}
            <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, borderLeft: '2px solid var(--line,#ddd)' }}>
              {data?.events.map((ev, i) => (
                <li key={i} style={{ position: 'relative', padding: '0 0 16px 18px' }}>
                  <span style={{ position: 'absolute', left: -6, top: 3, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent,#2e6e68)' }} />
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{EVENT_LABEL[ev.type]}{ev.detail ? <span className="muted" style={{ fontWeight: 400 }}> · {ev.detail}</span> : null}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(ev.at).toLocaleString()} ·{' '}
                    <Link href={`${DOC_ROUTE[ev.documentType] ?? '#'}/${ev.documentId}`}>{ev.documentNumber ?? ev.documentType}</Link>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

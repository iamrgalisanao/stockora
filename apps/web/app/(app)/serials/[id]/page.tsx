'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { SerialResponse, SerialStatus } from '@iw/contracts';
import { api } from '../../../../lib/api';

const STATUS_LABEL: Record<SerialStatus, string> = {
  IN_STOCK: 'In stock',
  RESERVED: 'Reserved',
  IN_TRANSIT: 'In transit',
  QUARANTINED: 'Quarantined',
  DAMAGED: 'Damaged',
  ISSUED: 'Issued',
  DISPOSED: 'Disposed',
};

export default function SerialDetailPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<SerialResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.serials.get(params.id).then(setRow).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [params.id]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Serial detail</h1>
        <Link className="btn secondary small" href="/serials">← Serials</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {row && (
        <div className="card" style={{ maxWidth: 640 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{row.serialNumber}</div>
          <div className="muted" style={{ marginBottom: 16 }}>{row.productSku} — {row.productName}</div>
          <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, columnGap: 12, margin: 0 }}>
            <dt className="muted">Status</dt><dd style={{ margin: 0, fontWeight: 600 }}>{STATUS_LABEL[row.status]}</dd>
            <dt className="muted">Warehouse</dt><dd style={{ margin: 0 }}>{row.warehouseCode ?? '—'}</dd>
            <dt className="muted">Lot</dt><dd style={{ margin: 0 }}>{row.lotNumber ?? '—'}</dd>
            <dt className="muted">Received</dt><dd style={{ margin: 0 }}>{row.receivedAt ? new Date(row.receivedAt).toLocaleString() : '—'}</dd>
            <dt className="muted">Issued</dt><dd style={{ margin: 0 }}>{row.issuedAt ? new Date(row.issuedAt).toLocaleString() : '—'}</dd>
            <dt className="muted">Last movement</dt><dd style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{row.lastMovementId ?? '—'}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

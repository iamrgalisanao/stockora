'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ReceiptListItem } from '@iw/contracts';
import { api } from '../../../lib/api';

const statusClass = (s: string) =>
  s === 'COMPLETED' ? 'ok' : s === 'PARTIALLY_RECEIVED' ? 'warn' : 'muted';

export default function ReceivingPage() {
  const [receipts, setReceipts] = useState<ReceiptListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .receiving.list()
      .then(setReceipts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Receiving</h1>
        <Link href="/receiving/new" className="btn">+ New receipt</Link>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : receipts.length === 0 ? (
        <div className="card muted">No goods receipts yet. Create one to bring stock in.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Supplier</th>
                <th>Warehouse</th>
                <th className="num">Lines</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.receiptNumber}</td>
                  <td>{r.supplierName ?? '—'}</td>
                  <td>{r.warehouseCode}</td>
                  <td className="num">{r.lineCount}</td>
                  <td>{new Date(r.receivingDate).toLocaleDateString()}</td>
                  <td><span className={`badge ${statusClass(r.status)}`}>{r.status.replace(/_/g, ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

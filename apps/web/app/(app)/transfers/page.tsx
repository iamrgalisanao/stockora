'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TransferListItem } from '@iw/contracts';
import { api } from '../../../lib/api';
import { statusClass } from '../../../lib/status';

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<TransferListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .transfers.list()
      .then(setTransfers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Transfers</h1>
        <Link href="/transfers/new" className="btn">+ New transfer</Link>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : transfers.length === 0 ? (
        <div className="card muted">No warehouse transfers yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Transfer #</th>
                <th>From</th>
                <th>To</th>
                <th className="num">Lines</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/transfers/${t.id}`}>{t.transferNumber}</Link></td>
                  <td>{t.sourceWarehouseCode}</td>
                  <td>{t.destWarehouseCode}</td>
                  <td className="num">{t.lineCount}</td>
                  <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td><span className={`badge ${statusClass(t.status)}`}>{t.status.replace(/_/g, ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdjustmentListItem } from '@iw/contracts';
import { api } from '../../../lib/api';
import { statusClass } from '../../../lib/status';

export default function AdjustmentsPage() {
  const [rows, setRows] = useState<AdjustmentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .adjustments.list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Adjustments</h1>
        <Link href="/adjustments/new" className="btn">+ New adjustment</Link>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card muted">No stock adjustments yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Adjustment #</th>
                <th>Warehouse</th>
                <th>Reason</th>
                <th className="num">Lines</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/adjustments/${a.id}`}>{a.adjustmentNumber}</Link></td>
                  <td>{a.warehouseCode}</td>
                  <td>{a.reasonName ?? '—'}</td>
                  <td className="num">{a.lineCount}</td>
                  <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td>
                    <span className={`badge ${statusClass(a.status)}`}>{a.status.replace(/_/g, ' ')}</span>
                    {a.requiresSecondApproval && <span className="badge warn" style={{ marginLeft: 6 }}>2-approver</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

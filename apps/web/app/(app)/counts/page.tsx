'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CountListItem } from '@iw/contracts';
import { api } from '../../../lib/api';
import { statusClass } from '../../../lib/status';

export default function CountsPage() {
  const [rows, setRows] = useState<CountListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .counts.list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Physical Counts</h1>
        <Link href="/counts/new" className="btn">+ New count</Link>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card muted">No physical counts yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Count #</th>
                <th>Warehouse</th>
                <th>Type</th>
                <th>Blind</th>
                <th className="num">Lines</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/counts/${c.id}`}>{c.countNumber}</Link></td>
                  <td>{c.warehouseCode}</td>
                  <td>{c.type}</td>
                  <td>{c.isBlind ? 'Yes' : 'No'}</td>
                  <td className="num">{c.lineCount}</td>
                  <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td><span className={`badge ${statusClass(c.status)}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

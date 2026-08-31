'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ReleaseListItem } from '@iw/contracts';
import { api } from '../../../lib/api';
import { statusClass } from '../../../lib/status';

export default function ReleasesPage() {
  const [releases, setReleases] = useState<ReleaseListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .releases.list()
      .then(setReleases)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Releases</h1>
        <Link href="/releases/new" className="btn">+ New release</Link>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : releases.length === 0 ? (
        <div className="card muted">No stock releases yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Release #</th>
                <th>Destination</th>
                <th>Purpose</th>
                <th className="num">Lines</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/releases/${r.id}`}>{r.releaseNumber}</Link></td>
                  <td>{r.destinationType.replace(/_/g, ' ')}</td>
                  <td>{r.purpose ?? '—'}</td>
                  <td className="num">{r.lineCount}</td>
                  <td>{new Date(r.createdAt).toLocaleDateString()}</td>
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

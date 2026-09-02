'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EntityStatus, WarehouseResponse } from '@iw/contracts';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/master-data';

const FILTERS: Array<EntityStatus | 'ALL'> = ['ALL', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];

export default function WarehousesPage() {
  const [rows, setRows] = useState<WarehouseResponse[]>([]);
  const [filter, setFilter] = useState<EntityStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .warehouses(q.trim() || undefined, filter === 'ALL' ? undefined : filter)
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [filter, q]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Warehouses</h1>
        <Link href="/warehouses/new" className="btn">+ New warehouse</Link>
      </div>

      <div className="toolbar" style={{ marginBottom: 12, gap: 8 }}>
        <input placeholder="Search code or name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260, marginTop: 0 }} />
        {FILTERS.map((f) => (
          <button key={f} className={`btn ${f === filter ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="card muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card muted">No warehouses.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Type</th><th>Manager</th><th>Default</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td><Link href={`/warehouses/${w.id}`}>{w.code}</Link></td>
                  <td>{w.name}</td>
                  <td>{w.type}</td>
                  <td>{w.managerName ?? '—'}</td>
                  <td>{w.isDefault ? '★' : '—'}</td>
                  <td><StatusBadge status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

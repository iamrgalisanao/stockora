'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EntityStatus, SupplierResponse } from '@iw/contracts';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/master-data';

const FILTERS: Array<EntityStatus | 'ALL'> = ['ALL', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];

export default function SuppliersPage() {
  const [rows, setRows] = useState<SupplierResponse[]>([]);
  const [filter, setFilter] = useState<EntityStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .suppliers(q.trim() || undefined, filter === 'ALL' ? undefined : filter)
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [filter, q]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Suppliers</h1>
        <Link href="/suppliers/new" className="btn">+ New supplier</Link>
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
        <div className="card muted">No suppliers.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th><th>Company</th><th>Contact</th><th>Email</th>
                <th className="num">Lead (d)</th><th>Preferred</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/suppliers/${s.id}`}>{s.code}</Link></td>
                  <td>{s.companyName}</td>
                  <td>{s.contactPerson ?? '—'}</td>
                  <td>{s.email ?? '—'}</td>
                  <td className="num">{s.leadTimeDays}</td>
                  <td>{s.isPreferred ? '★' : '—'}</td>
                  <td><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

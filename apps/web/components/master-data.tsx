'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuditEntryResponse, EntityStatus } from '@iw/contracts';
import { api } from '../lib/api';

export function StatusBadge({ status }: { status: EntityStatus }) {
  const cls = status === 'ACTIVE' ? 'ok' : status === 'INACTIVE' ? 'warn' : 'muted';
  return <span className={`badge ${cls}`}>{status}</span>;
}

/** Right-side drawer showing an entity's audit history. */
export function AuditDrawer({
  entityType,
  entityId,
  label,
  onClose,
}: {
  entityType: string;
  entityId: string;
  label: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AuditEntryResponse[] | null>(null);
  useEffect(() => {
    api.audit(entityType, entityId).then(setRows).catch(() => setRows([]));
  }, [entityType, entityId]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="brand">History — {label}</div>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={onClose}>Close</button>
        </div>
        {rows === null ? (
          <div className="muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="muted">No history.</div>
        ) : (
          <div>
            {rows.map((r) => (
              <div className="kv" key={r.id}>
                <div className="v">{r.action.replace(/[._]/g, ' ')}</div>
                <div className="k">{new Date(r.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  num?: boolean;
}

const FILTERS: Array<EntityStatus | 'ALL'> = ['ALL', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
const NEXT: Record<EntityStatus, Array<{ to: EntityStatus; label: string }>> = {
  ACTIVE: [{ to: 'INACTIVE', label: 'Deactivate' }, { to: 'ARCHIVED', label: 'Archive' }],
  INACTIVE: [{ to: 'ACTIVE', label: 'Activate' }, { to: 'ARCHIVED', label: 'Archive' }],
  ARCHIVED: [],
};

/**
 * Reusable master-data manager: search + status filter + table + create/edit form +
 * status lifecycle actions + audit-history drawer. Pages supply columns, a form, and the
 * load / changeStatus calls.
 */
export function MasterDataManager<T extends { id: string; status: EntityStatus }>(props: {
  title: string;
  entityType: string;
  columns: Column<T>[];
  load: (q: string | undefined, status: EntityStatus | undefined) => Promise<T[]>;
  changeStatus: (id: string, status: EntityStatus) => Promise<unknown>;
  labelOf: (row: T) => string;
  renderForm: (editing: T | null, onDone: () => void) => ReactNode;
}) {
  const { title, entityType, columns, load, changeStatus, labelOf, renderForm } = props;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<EntityStatus | 'ALL'>('ALL');
  const [rows, setRows] = useState<T[]>([]);
  const [editing, setEditing] = useState<T | null | undefined>(undefined); // undefined=closed, null=new
  const [auditFor, setAuditFor] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    load(q || undefined, filter === 'ALL' ? undefined : filter)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [load, q, filter]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function doStatus(row: T, to: EntityStatus) {
    if (to === 'ARCHIVED' && !window.confirm(`Archive "${labelOf(row)}"? It will be hidden from operational use.`)) return;
    setBusy(true);
    setError(null);
    try {
      await changeStatus(row.id, to);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">{title}</h1>
        <button className="btn" style={{ marginTop: 0 }} onClick={() => setEditing(null)}>+ New</button>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
        {FILTERS.map((f) => (
          <button key={f} className={`btn ${f === filter ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {editing !== undefined && (
        <div className="card" style={{ marginBottom: 12 }}>
          {renderForm(editing, () => {
            setEditing(undefined);
            reload();
          })}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {columns.map((c) => <th key={c.header} className={c.num ? 'num' : undefined}>{c.header}</th>)}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.header} className={c.num ? 'num' : undefined}>{c.render(row)}</td>)}
                <td><StatusBadge status={row.status} /></td>
                <td>
                  <div className="toolbar">
                    {row.status !== 'ARCHIVED' && (
                      <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => setEditing(row)}>Edit</button>
                    )}
                    {NEXT[row.status].map((t) => (
                      <button key={t.to} className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => doStatus(row, t.to)}>{t.label}</button>
                    ))}
                    <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => setAuditFor(row)}>History</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {auditFor && (
        <AuditDrawer entityType={entityType} entityId={auditFor.id} label={labelOf(auditFor)} onClose={() => setAuditFor(null)} />
      )}
    </div>
  );
}

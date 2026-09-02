'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  AuditEntryResponse, EntityStatus, InventoryPolicyResponse, LocationUsage,
  WarehouseLocationResponse, WarehouseResponse, WarehouseType,
} from '@iw/contracts';
import { LOCATION_USAGES, LOCATION_TYPE_SUGGESTIONS, WAREHOUSE_TYPES } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/master-data';

type Tab = 'general' | 'locations' | 'policies' | 'history';

export default function WarehouseEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [w, setW] = useState<WarehouseResponse | null>(null);
  const [tab, setTab] = useState<Tab>('general');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.warehouseAdmin.get(id).then(setW).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  async function changeStatus(status: EntityStatus) {
    if (status === 'ARCHIVED' && !window.confirm('Archive this warehouse? It must hold no stock, open documents, active policies, or active locations.')) return;
    run(() => api.warehouseAdmin.changeStatus(id, status));
  }

  if (error && !w) return <div className="card error">{error}</div>;
  if (!w) return <div className="card muted">Loading…</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="h1" style={{ display: 'inline', marginRight: 10 }}>{w.code}</h1>
          <StatusBadge status={w.status} />
          <span className="muted" style={{ marginLeft: 10 }}>{w.name}</span>
        </div>
        <button className="btn secondary small" onClick={() => router.push('/warehouses')}>Back</button>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        {(['general', 'locations', 'policies', 'history'] as Tab[]).map((t) => (
          <button key={t} className={`btn ${t === tab ? '' : 'secondary'} small`} style={{ marginTop: 0 }} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span style={{ flex: 1 }} />
        {w.status !== 'ACTIVE' && w.status !== 'ARCHIVED' && <button className="btn small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('ACTIVE')}>Activate</button>}
        {w.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('INACTIVE')}>Deactivate</button>}
        {w.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => changeStatus('ARCHIVED')}>Archive</button>}
      </div>

      {error && <div className="error">{error}</div>}

      {tab === 'general' && <GeneralTab w={w} onSave={(body) => run(() => api.warehouseAdmin.update(id, body))} busy={busy} />}
      {tab === 'locations' && <LocationsTab warehouseId={id} />}
      {tab === 'policies' && <PoliciesTab warehouseId={id} />}
      {tab === 'history' && <HistoryTab warehouseId={id} />}
    </div>
  );
}

function GeneralTab({ w, onSave, busy }: { w: WarehouseResponse; onSave: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [f, setF] = useState({
    name: w.name, type: w.type as WarehouseType, address: w.address ?? '', phone: w.phone ?? '', email: w.email ?? '',
    isDefault: w.isDefault, allowReceiving: w.allowReceiving, allowDispatch: w.allowDispatch, notes: w.notes ?? '',
  });
  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) { setF((p) => ({ ...p, [k]: v })); }
  return (
    <div className="card">
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div><label>Name</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label>Type</label>
          <select value={f.type} onChange={(e) => set('type', e.target.value as WarehouseType)}>
            {WAREHOUSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><label>Code</label><input value={w.code} disabled /></div>
        <div><label>Phone</label><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div><label>Email</label><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 10 }}><label>Address</label><input value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
      <div style={{ marginTop: 10 }}><label>Notes</label><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="toolbar" style={{ marginTop: 12, gap: 16 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default warehouse</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.allowReceiving} onChange={(e) => set('allowReceiving', e.target.checked)} /> Allow receiving</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.allowDispatch} onChange={(e) => set('allowDispatch', e.target.checked)} /> Allow dispatch</label>
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy} onClick={() => onSave({
          name: f.name, type: f.type, address: f.address || null, phone: f.phone || null, email: f.email || null,
          isDefault: f.isDefault, allowReceiving: f.allowReceiving, allowDispatch: f.allowDispatch, notes: f.notes || null,
        })}>Save</button>
      </div>
    </div>
  );
}

interface TreeNode extends WarehouseLocationResponse { children: TreeNode[]; depth: number }

function LocationsTab({ warehouseId }: { warehouseId: string }) {
  const [locs, setLocs] = useState<WarehouseLocationResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // form: { mode: 'create'|'edit', parentId?, target? }
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; parentId: string | null; target?: WarehouseLocationResponse } | null>(null);
  const [moveFor, setMoveFor] = useState<WarehouseLocationResponse | null>(null);

  const reload = useCallback(() => {
    api.warehouseAdmin.locations(warehouseId).then(setLocs).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [warehouseId]);
  useEffect(() => { reload(); }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }

  const tree = useMemo(() => buildTree(locs ?? []), [locs]);
  const descendantIds = useMemo(() => (moveFor ? collectSubtree(locs ?? [], moveFor.id) : new Set<string>()), [locs, moveFor]);

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button className="btn small" style={{ marginTop: 0 }} onClick={() => setForm({ mode: 'create', parentId: null })}>+ Add root location</button>
      </div>

      {error && <div className="error">{error}</div>}

      {form && (
        <LocationForm
          key={form.mode + (form.target?.id ?? form.parentId ?? 'root')}
          form={form} busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(body) => run(() =>
            form.mode === 'create'
              ? api.warehouseAdmin.createLocation(warehouseId, { ...body, code: body.code!, parentId: form.parentId ?? undefined })
              : api.warehouseAdmin.updateLocation(warehouseId, form.target!.id, body),
          ).then(() => setForm(null))}
        />
      )}

      {moveFor && (
        <MovePanel
          location={moveFor} candidates={(locs ?? []).filter((l) => l.id !== moveFor.id && !descendantIds.has(l.id) && l.status !== 'ARCHIVED')}
          busy={busy}
          onCancel={() => setMoveFor(null)}
          onMove={(parentId) => run(() => api.warehouseAdmin.moveLocation(warehouseId, moveFor.id, parentId)).then(() => setMoveFor(null))}
        />
      )}

      {locs === null ? <div className="muted">Loading…</div> : tree.length === 0 ? (
        <div className="muted">No locations yet — add a root location to start the hierarchy.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Location</th><th>Type</th><th>Usage</th><th>Pickable</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {flatten(tree).map((n) => (
                <tr key={n.id}>
                  <td style={{ paddingLeft: 12 + n.depth * 22 }}>
                    <strong>{n.code}</strong>{n.name ? <span className="muted"> — {n.name}</span> : null}
                  </td>
                  <td>{n.type ?? '—'}</td>
                  <td>{n.usage}</td>
                  <td>{n.isPickable ? 'Yes' : '—'}</td>
                  <td><StatusBadge status={n.status} /></td>
                  <td><div className="toolbar">
                    {n.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => setForm({ mode: 'create', parentId: n.id })}>+ child</button>}
                    {n.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => setForm({ mode: 'edit', parentId: n.parentId, target: n })}>Edit</button>}
                    {n.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => setMoveFor(n)}>Move</button>}
                    {n.status === 'ACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(() => api.warehouseAdmin.changeLocationStatus(warehouseId, n.id, 'INACTIVE'))}>Deactivate</button>}
                    {n.status === 'INACTIVE' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(() => api.warehouseAdmin.changeLocationStatus(warehouseId, n.id, 'ACTIVE'))}>Activate</button>}
                    {n.status !== 'ARCHIVED' && <button className="btn secondary small" style={{ marginTop: 0 }} disabled={busy} onClick={() => { if (window.confirm('Archive this location?')) run(() => api.warehouseAdmin.changeLocationStatus(warehouseId, n.id, 'ARCHIVED')); }}>Archive</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LocationForm({ form, busy, onCancel, onSubmit }: {
  form: { mode: 'create' | 'edit'; parentId: string | null; target?: WarehouseLocationResponse };
  busy: boolean; onCancel: () => void;
  onSubmit: (b: { code?: string; name?: string; type?: string; usage?: LocationUsage; isPickable?: boolean }) => void;
}) {
  const t = form.target;
  const [code, setCode] = useState(t?.code ?? '');
  const [name, setName] = useState(t?.name ?? '');
  const [type, setType] = useState(t?.type ?? '');
  const [usage, setUsage] = useState<LocationUsage>(t?.usage ?? 'STORAGE');
  const [isPickable, setIsPickable] = useState(t?.isPickable ?? true);
  const heading = form.mode === 'create' ? (form.parentId ? 'Add child location' : 'Add root location') : `Edit ${t?.code}`;
  return (
    <div className="card" style={{ background: 'rgba(255,255,255,0.03)', marginBottom: 12 }}>
      <strong>{heading}</strong>
      <div className="field-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginTop: 8, alignItems: 'end' }}>
        {form.mode === 'create' && <div><label>Code *</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>}
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Type</label>
          <input list="loc-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="optional" />
          <datalist id="loc-types">{LOCATION_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div><label>Usage</label>
          <select value={usage} onChange={(e) => setUsage(e.target.value as LocationUsage)}>
            {LOCATION_USAGES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={isPickable} onChange={(e) => setIsPickable(e.target.checked)} /> Pickable</label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy || (form.mode === 'create' && !code.trim())} onClick={() => onSubmit({
          code: form.mode === 'create' ? code : undefined,
          name: name || undefined, type: type || undefined, usage, isPickable,
        })}>{form.mode === 'create' ? 'Add' : 'Save'}</button>
        <button className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function MovePanel({ location, candidates, busy, onCancel, onMove }: {
  location: WarehouseLocationResponse; candidates: WarehouseLocationResponse[]; busy: boolean;
  onCancel: () => void; onMove: (parentId: string | null) => void;
}) {
  const [parentId, setParentId] = useState<string>(location.parentId ?? '');
  return (
    <div className="card" style={{ background: 'rgba(255,255,255,0.03)', marginBottom: 12 }}>
      <strong>Move {location.code}</strong>
      <div className="field-row" style={{ gridTemplateColumns: '1fr auto auto', marginTop: 8, alignItems: 'end' }}>
        <div><label>New parent</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">(root of warehouse)</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.code}{c.name ? ` — ${c.name}` : ''}</option>)}
          </select>
        </div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={() => onMove(parentId || null)}>Move</button>
        <button className="btn secondary" style={{ marginTop: 0 }} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function PoliciesTab({ warehouseId }: { warehouseId: string }) {
  const [rows, setRows] = useState<InventoryPolicyResponse[] | null>(null);
  useEffect(() => { api.warehouseAdmin.policies(warehouseId).then(setRows).catch(() => setRows([])); }, [warehouseId]);
  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Reorder policies governing stock in this warehouse. Edit them from each product&apos;s Inventory Policies tab.</div>
      {rows === null ? <div className="muted">Loading…</div> : rows.length === 0 ? <div className="muted">No policies target this warehouse yet.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>SKU</th><th>Product</th><th className="num">Min</th><th className="num">Reorder pt</th><th className="num">Reorder qty</th><th className="num">Max</th><th>Supplier</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/products/${r.productId}`}>{r.productSku}</Link></td>
                  <td>{r.productName}</td>
                  <td className="num">{r.minStock}</td>
                  <td className="num">{r.reorderPoint}</td>
                  <td className="num">{r.reorderQuantity}</td>
                  <td className="num">{r.maxStock ?? '—'}</td>
                  <td>{r.preferredSupplierName ?? '—'}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ warehouseId }: { warehouseId: string }) {
  const [rows, setRows] = useState<AuditEntryResponse[] | null>(null);
  useEffect(() => { api.audit('warehouse', warehouseId).then(setRows).catch(() => setRows([])); }, [warehouseId]);
  return (
    <div className="card">
      {rows === null ? <div className="muted">Loading…</div> : rows.length === 0 ? <div className="muted">No history.</div> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Action</th><th>When</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{r.action.replace(/[._]/g, ' ')}</td><td>{new Date(r.createdAt).toLocaleString()}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- tree helpers ----
function buildTree(flat: WarehouseLocationResponse[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  flat.forEach((l) => byId.set(l.id, { ...l, children: [], depth: 0 }));
  const roots: TreeNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  });
  const sortRec = (nodes: TreeNode[], depth: number) => {
    nodes.sort((a, b) => a.code.localeCompare(b.code));
    nodes.forEach((n) => { n.depth = depth; sortRec(n.children, depth + 1); });
  };
  sortRec(roots, 0);
  return roots;
}
function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}
function collectSubtree(flat: WarehouseLocationResponse[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  flat.forEach((l) => { if (l.parentId) { const a = childrenOf.get(l.parentId) ?? []; a.push(l.id); childrenOf.set(l.parentId, a); } });
  const out = new Set<string>();
  const walk = (idw: string) => { (childrenOf.get(idw) ?? []).forEach((c) => { out.add(c); walk(c); }); };
  walk(rootId);
  return out;
}

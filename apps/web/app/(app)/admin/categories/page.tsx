'use client';

import { useEffect, useState } from 'react';
import type { CategoryResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';
import { MasterDataManager } from '../../../../components/master-data';

function CategoryForm({
  editing,
  options,
  onDone,
}: {
  editing: CategoryResponse | null;
  options: CategoryResponse[];
  onDone: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [parentId, setParentId] = useState(editing?.parentId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setError('Name is required');
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.categories.update(editing.id, { name, parentId: parentId || null });
      else await api.categories.create({ name, parentId: parentId || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 8 }}>{editing ? `Edit ${editing.name}` : 'New category'}</div>
      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr auto auto' }}>
        <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <label>Parent</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— (top level)</option>
            {options.filter((o) => o.id !== editing?.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={save}>{editing ? 'Save' : 'Create'}</button>
        <button className="btn secondary" style={{ marginTop: 0 }} onClick={onDone}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default function CategoriesAdminPage() {
  const [all, setAll] = useState<CategoryResponse[]>([]);
  useEffect(() => {
    api.categories.list().then(setAll).catch(() => setAll([]));
  }, []);
  const nameById = new Map(all.map((c) => [c.id, c.name]));

  return (
    <MasterDataManager<CategoryResponse>
      title="Categories"
      entityType="category"
      columns={[
        { header: 'Name', render: (r) => r.name },
        { header: 'Parent', render: (r) => (r.parentId ? nameById.get(r.parentId) ?? '—' : '—') },
      ]}
      load={(q, status) => api.categories.list(q, status).then((r) => { setAll((prev) => (q || status ? prev : r)); return r; })}
      changeStatus={(id, status) => api.categories.changeStatus(id, status)}
      labelOf={(r) => r.name}
      renderForm={(editing, onDone) => <CategoryForm key={editing?.id ?? 'new'} editing={editing} options={all} onDone={onDone} />}
    />
  );
}

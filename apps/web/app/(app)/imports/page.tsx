'use client';

import { useState } from 'react';
import type { ImportPreviewResponse } from '@iw/contracts';
import { api } from '../../../lib/api';

type ImportType = 'products' | 'suppliers' | 'opening-inventory';

const TEMPLATES: Record<ImportType, { label: string; headers: string[]; sample: string }> = {
  products: {
    label: 'Products, variants & barcodes',
    headers: ['sku', 'product_name', 'description', 'category', 'brand', 'unit_code', 'cost', 'selling_price', 'is_serialized', 'is_batch_tracked', 'status', 'barcode', 'parent_sku'],
    sample: 'SSD-1TB,Samsung 1TB SSD,,Storage,Samsung,PCS,90,120,false,false,ACTIVE,4801234567890,',
  },
  suppliers: {
    label: 'Suppliers & supplier-product links',
    headers: ['code', 'company_name', 'contact_person', 'email', 'phone', 'lead_time_days', 'product_sku', 'supplier_sku', 'cost', 'min_order_qty'],
    sample: 'ACME,ACME Distribution,Jane,jane@acme.test,,7,,,,',
  },
  'opening-inventory': {
    label: 'Opening inventory (posts through the ledger)',
    headers: ['warehouse_code', 'location_code', 'sku', 'quantity', 'unit_cost'],
    sample: 'MAIN-DC,,SSD-1TB,42,90',
  },
};

export default function ImportsPage() {
  const [type, setType] = useState<ImportType>('products');
  const [fileName, setFileName] = useState('import.csv');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<string | null>(null);

  const tpl = TEMPLATES[type];

  function loadTemplate() {
    setContent(`${tpl.headers.join(',')}\n${tpl.sample}\n`);
    setPreview(null); setCommitted(null); setError(null);
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
    setPreview(null); setCommitted(null);
  }
  async function runPreview() {
    setBusy(true); setError(null); setCommitted(null); setPreview(null);
    try { setPreview(await api.imports.preview(type, fileName, content)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Preview failed'); }
    finally { setBusy(false); }
  }
  async function runCommit() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const job = await api.imports.commit(preview.job.id);
      setCommitted(`Committed ${job.validRows} row(s) — job ${job.status}.`);
      setPreview({ ...preview, job });
    } catch (e) { setError(e instanceof Error ? e.message : 'Commit failed'); }
    finally { setBusy(false); }
  }

  const job = preview?.job;
  const canCommit = job && job.status === 'VALIDATED' && job.invalidRows === 0 && job.validRows > 0;

  async function download(path: string, filename: string) {
    setError(null);
    try { await api.exports.download(path, filename); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
  }

  return (
    <div>
      <div className="topbar"><h1 className="h1">Import &amp; Export</h1></div>

      <div className="card" style={{ marginBottom: 12 }}>
        <strong>Export</strong>
        <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>Read-only CSV. Exported files re-import as templates.</div>
        <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => download('/exports/products', 'products.csv')}>Products</button>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => download('/exports/suppliers', 'suppliers.csv')}>Suppliers</button>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => download('/exports/stock-balances', 'stock-balances.csv')}>Stock balances</button>
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>Blank templates:</span>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => download('/exports/templates/products', 'products-template.csv')}>Products</button>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => download('/exports/templates/suppliers', 'suppliers-template.csv')}>Suppliers</button>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => download('/exports/templates/opening-inventory', 'opening-inventory-template.csv')}>Opening inventory</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="toolbar" style={{ gap: 8 }}>
          {(Object.keys(TEMPLATES) as ImportType[]).map((t) => (
            <button key={t} className={`btn ${t === type ? '' : 'secondary'} small`} style={{ marginTop: 0 }}
              onClick={() => { setType(t); setPreview(null); setCommitted(null); setError(null); }}>
              {TEMPLATES[t].label}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Columns: <code>{tpl.headers.join(', ')}</code>. Categories, brands, and units must already exist.
        </div>
        <div className="field-row" style={{ gridTemplateColumns: 'auto auto 1fr', alignItems: 'center', marginTop: 10 }}>
          <label className="btn secondary small" style={{ marginTop: 0 }}>
            Choose CSV…<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFile} />
          </label>
          <button className="btn secondary small" style={{ marginTop: 0 }} onClick={loadTemplate}>Load template</button>
          <span className="muted" style={{ fontSize: 12 }}>{fileName}</span>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} placeholder="Paste CSV here…"
          style={{ width: '100%', marginTop: 10, fontFamily: 'monospace', fontSize: 12 }} />
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy || !content.trim()} onClick={runPreview}>Preview</button>
          <button className="btn" disabled={busy || !canCommit} onClick={runCommit}>Commit</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {committed && <div className="card" style={{ borderColor: 'var(--ok, #2e7)' }}>{committed}</div>}

      {job && (
        <div className="card">
          <div className="toolbar" style={{ gap: 16 }}>
            <span>Status: <span className="badge">{job.status}</span></span>
            <span>Total: <strong>{job.totalRows}</strong></span>
            <span className="badge ok">Valid {job.validRows}</span>
            {job.warningRows > 0 && <span className="badge warn">Warnings {job.warningRows}</span>}
            {job.invalidRows > 0 && <span className="badge danger">Invalid {job.invalidRows}</span>}
          </div>
          {job.invalidRows > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Fix the {job.invalidRows} invalid row(s) below, then re-preview to commit.</div>}
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="grid">
              <thead><tr><th>Row</th><th>Status</th><th>Details</th></tr></thead>
              <tbody>
                {preview!.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td><span className={`badge ${r.status === 'INVALID' ? 'danger' : r.status === 'WARNING' ? 'warn' : 'ok'}`}>{r.status}</span></td>
                    <td>
                      {r.errors.length > 0 && <div className="danger">{r.errors.join('; ')}</div>}
                      {r.warnings.length > 0 && <div className="warn">{r.warnings.join('; ')}</div>}
                      {r.errors.length === 0 && r.warnings.length === 0 && <span className="muted">{Object.values(r.rawData).filter(Boolean).slice(0, 4).join(' · ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

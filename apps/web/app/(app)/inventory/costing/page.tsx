'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { AuthenticatedUser, CostLayerResponse, CostValuationRow, CostingPolicyResponse, WarehouseResponse } from '@iw/contracts';
import { api } from '../../../../lib/api';

const money = (v: string) => `₱${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CostingPage() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [policy, setPolicy] = useState<CostingPolicyResponse | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [rows, setRows] = useState<CostValuationRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [layers, setLayers] = useState<CostLayerResponse[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.me().then(setUser).catch(() => {}); }, []);
  useEffect(() => { api.warehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => { api.costingPolicy().then(setPolicy).catch(() => {}); }, []);

  useEffect(() => {
    api.costValuation({ warehouseId }).then(setRows).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [warehouseId]);

  const canManage = !!user?.permissions.includes('settings.manage');
  const canCost = !!user?.permissions.includes('cost.view');

  const totals = useMemo(() => ({
    wac: rows.reduce((s, r) => s + Number(r.wacValue), 0),
    fifo: rows.reduce((s, r) => s + Number(r.fifoValue), 0),
  }), [rows]);

  async function setStrategy(strategy: 'WAC' | 'FIFO') {
    setMsg(null); setError(null);
    try {
      setPolicy(await api.setCostingPolicy(strategy));
      setMsg(`Organization default costing set to ${strategy}.`);
      setRows(await api.costValuation({ warehouseId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change strategy');
    }
  }

  async function toggle(r: CostValuationRow) {
    if (expanded === r.productId + r.warehouseId) { setExpanded(null); return; }
    setExpanded(r.productId + r.warehouseId);
    if (canCost) setLayers(await api.costLayers({ productId: r.productId, warehouseId: r.warehouseId, status: 'OPEN' }).catch(() => []));
  }

  return (
    <div>
      <div className="topbar"><h1 className="h1">Costing</h1></div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ fontSize: 13 }}>Organization costing strategy: </strong>
            <span className="badge">{policy?.strategy ?? 'WAC'}</span>
            {policy && !policy.configured && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>(built-in default)</span>}
          </div>
          {canManage && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => setStrategy('WAC')} disabled={policy?.strategy === 'WAC'}>Use WAC</button>
              <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => setStrategy('FIFO')} disabled={policy?.strategy === 'FIFO'}>Use FIFO</button>
            </div>
          )}
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          FIFO consumes the oldest purchase-cost layers on each outbound movement; WAC uses the moving average.
          A strategy can only be changed while on-hand stock is zero (ADR 0013). Cost figures require cost.view.
        </p>
        {msg && <div className="muted" style={{ fontSize: 12 }}>{msg}</div>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '1fr', gap: 10, maxWidth: 320 }}>
          <div><label>Warehouse</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All (my scope)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <strong style={{ fontSize: 13 }}>WAC vs FIFO valuation</strong>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          Totals — WAC {money(String(totals.wac))} · FIFO {money(String(totals.fifo))}
        </span>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="grid">
            <thead>
              <tr><th>Product</th><th>Warehouse</th><th>Strategy</th><th className="num">On hand</th><th className="num">WAC unit</th><th className="num">WAC value</th><th className="num">FIFO qty</th><th className="num">FIFO value</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.productId + r.warehouseId}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => toggle(r)}>
                    <td>{r.productSku} — {r.productName}</td>
                    <td>{r.warehouseCode}</td>
                    <td><span className="badge">{r.strategy}</span></td>
                    <td className="num">{r.onHand}</td>
                    <td className="num">{canCost ? money(r.wacUnitCost) : '—'}</td>
                    <td className="num">{canCost ? money(r.wacValue) : '—'}</td>
                    <td className="num">{r.fifoLayerQuantity}</td>
                    <td className="num">{canCost ? money(r.fifoValue) : '—'}</td>
                  </tr>
                  {expanded === r.productId + r.warehouseId && canCost && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--surface-2,#fafafa)' }}>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Open cost layers (oldest first)</div>
                        {layers.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>No open layers.</span> : (
                          <table className="grid" style={{ fontSize: 12 }}>
                            <thead><tr><th>Received</th><th className="num">Remaining</th><th className="num">Unit cost</th><th className="num">Layer value</th></tr></thead>
                            <tbody>
                              {layers.map((l) => (
                                <tr key={l.id}>
                                  <td>{new Date(l.receivedAt).toLocaleDateString()}</td>
                                  <td className="num">{l.remainingQuantity}</td>
                                  <td className="num">{money(l.unitCost)}</td>
                                  <td className="num">{money(String(Number(l.remainingQuantity) * Number(l.unitCost)))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>No on-hand stock to value.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  AuthenticatedUser,
  CostLayerResponse,
  CostValuationRow,
  CostingPolicyResponse,
  FifoCogsReportResponse,
  MovementCostDetailResponse,
  ProductResponse,
  ReturnCostTraceResponse,
  TransferCostTraceResponse,
  WarehouseResponse,
} from '@iw/contracts';
import { api } from '../../../../lib/api';

const money = (v?: string | number | null) => v === undefined || v === null || v === '' ? '-' : `PHP ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (v?: string | null) => v ? new Date(v).toLocaleString() : '-';
const doc = (d?: { type: string; id: string | null; number: string | null } | null) => d ? `${d.number ?? d.id ?? 'Unnumbered'} (${d.type})` : '-';

export default function CostingPage() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [policy, setPolicy] = useState<CostingPolicyResponse | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [valuation, setValuation] = useState<CostValuationRow[]>([]);
  const [layers, setLayers] = useState<CostLayerResponse[]>([]);
  const [cogs, setCogs] = useState<FifoCogsReportResponse | null>(null);
  const [movementId, setMovementId] = useState('');
  const [movementDetail, setMovementDetail] = useState<MovementCostDetailResponse | null>(null);
  const [transferId, setTransferId] = useState('');
  const [transferTrace, setTransferTrace] = useState<TransferCostTraceResponse | null>(null);
  const [returnId, setReturnId] = useState('');
  const [returnTrace, setReturnTrace] = useState<ReturnCostTraceResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = !!user?.permissions.includes('settings.manage');
  const canCost = !!user?.permissions.includes('cost.view');
  const canValuation = !!user?.permissions.includes('valuation.view');

  useEffect(() => {
    api.me().then(setUser).catch(() => {});
    api.costingPolicy().then(setPolicy).catch(() => {});
    api.warehouses().then(setWarehouses).catch(() => {});
    api.products().then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, productId, status, from, to, user?.permissions.join('|')]);

  const totals = useMemo(() => ({
    wac: valuation.reduce((s, r) => s + Number(r.wacValue), 0),
    fifo: valuation.reduce((s, r) => s + Number(r.fifoValue), 0),
    cogs: Number(cogs?.totalCogs ?? 0),
  }), [valuation, cogs]);

  async function reload() {
    setError(null);
    const filters = { warehouseId, productId, status, from, to };
    try {
      const jobs: Promise<unknown>[] = [];
      if (canValuation) jobs.push(api.costValuation({ warehouseId, productId }).then(setValuation));
      else setValuation([]);
      if (canCost) {
        jobs.push(api.costLayers(filters).then(setLayers));
        jobs.push(api.fifoCogs({ warehouseId, productId, from, to }).then(setCogs));
      } else {
        setLayers([]);
        setCogs(null);
      }
      await Promise.all(jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load costing data');
    }
  }

  async function setStrategy(strategy: 'WAC' | 'FIFO') {
    setMsg(null); setError(null);
    try {
      setPolicy(await api.setCostingPolicy(strategy));
      setMsg(`Organization default costing set to ${strategy}.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change strategy');
    }
  }

  async function loadMovement(id = movementId) {
    if (!id.trim()) return;
    setError(null);
    try { setMovementDetail(await api.movementCostDetail(id.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load movement cost detail'); }
  }

  async function loadTransfer() {
    if (!transferId.trim()) return;
    setError(null);
    try { setTransferTrace(await api.transferCostTrace(transferId.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load transfer cost trace'); }
  }

  async function loadReturn() {
    if (!returnId.trim()) return;
    setError(null);
    try { setReturnTrace(await api.returnCostTrace(returnId.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load return cost trace'); }
  }

  return (
    <div>
      <div className="topbar"><h1 className="h1">FIFO Costing</h1></div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 13 }}>Organization strategy </strong>
            <span className="badge">{policy?.strategy ?? 'WAC'}</span>
            {policy && !policy.configured && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>(built-in default)</span>}
          </div>
          {canManage && (
            <div className="toolbar">
              <button className="btn secondary small" onClick={() => setStrategy('WAC')} disabled={policy?.strategy === 'WAC'}>Use WAC</button>
              <button className="btn secondary small" onClick={() => setStrategy('FIFO')} disabled={policy?.strategy === 'FIFO'}>Use FIFO</button>
            </div>
          )}
        </div>
        {msg && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '1.2fr 1.2fr .8fr .8fr .8fr' }}>
          <div><label>Product</label><select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}</select></div>
          <div><label>Warehouse</label><select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">All warehouses</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></div>
          <div><label>Layer status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option><option value="OPEN">Open</option><option value="DEPLETED">Depleted</option></select></div>
          <div><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="grid2" style={{ marginBottom: 12 }}>
        <Tile label="FIFO valuation" value={canValuation ? money(totals.fifo) : 'Hidden'} hint="requires valuation.view" />
        <Tile label="FIFO COGS" value={canCost ? money(totals.cogs) : 'Hidden'} hint="requires cost.view" />
      </div>

      {canValuation && (
        <Section title="Valuation Report" aside={`WAC ${money(totals.wac)} / FIFO ${money(totals.fifo)}`}>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Product</th><th>Warehouse</th><th>Strategy</th><th className="num">On hand</th><th className="num">WAC value</th><th className="num">FIFO qty</th><th className="num">FIFO value</th></tr></thead>
              <tbody>
                {valuation.map((r) => <tr key={`${r.productId}:${r.warehouseId}`}><td>{r.productSku} - {r.productName}</td><td>{r.warehouseCode}</td><td><span className="badge">{r.strategy}</span></td><td className="num">{r.onHand}</td><td className="num">{money(r.wacValue)}</td><td className="num">{r.fifoLayerQuantity}</td><td className="num">{money(r.fifoValue)}</td></tr>)}
                {valuation.length === 0 && <Empty colSpan={7} text="No valuation rows in this scope." />}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {canCost ? (
        <>
          <Section title="Cost Layer Explorer" aside={`${layers.length} layers`}>
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>Layer</th><th>Product</th><th>Warehouse</th><th>Source</th><th className="num">Received</th><th className="num">Remaining</th><th className="num">Unit cost</th><th className="num">Remaining value</th><th>Status</th></tr></thead>
                <tbody>
                  {layers.map((l) => <tr key={l.id}><td><button className="linklike" onClick={() => { setMovementId(l.sourceMovementId); loadMovement(l.sourceMovementId); }}>source movement</button></td><td>{l.productSku}</td><td>{l.warehouseCode}</td><td>{doc(l.sourceDocument)}</td><td className="num">{l.receivedQuantity}</td><td className="num">{l.remainingQuantity}</td><td className="num">{money(l.unitCost)}</td><td className="num">{money(l.remainingValue)}</td><td><span className={`badge ${l.status === 'OPEN' ? 'ok' : 'muted'}`}>{l.status}</span></td></tr>)}
                  {layers.length === 0 && <Empty colSpan={9} text="No cost layers match these filters." />}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="FIFO COGS Report" aside={money(cogs?.totalCogs)}>
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>Movement</th><th>Type</th><th>Product</th><th>Warehouse</th><th>Source</th><th className="num">Qty</th><th className="num">COGS</th><th>Posted</th></tr></thead>
                <tbody>
                  {(cogs?.rows ?? []).map((r) => <tr key={r.movementId}><td><button className="linklike" onClick={() => { setMovementId(r.movementId); loadMovement(r.movementId); }}>{r.txnNumber}</button></td><td>{r.movementType}</td><td>{r.productSku}</td><td>{r.warehouseCode}</td><td>{doc(r.sourceDocument)}</td><td className="num">{r.quantity}</td><td className="num">{money(r.totalCost)}</td><td>{date(r.postedAt)}</td></tr>)}
                  {(!cogs || cogs.rows.length === 0) && <Empty colSpan={8} text="No FIFO COGS movements in this scope." />}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Movement Cost Detail">
            <Lookup value={movementId} setValue={setMovementId} onLoad={() => loadMovement()} placeholder="Movement UUID" />
            {movementDetail && <MovementDetail detail={movementDetail} />}
          </Section>

          <Section title="Transfer Cost Trace">
            <Lookup value={transferId} setValue={setTransferId} onLoad={loadTransfer} placeholder="Transfer UUID" />
            {transferTrace && <TransferTrace trace={transferTrace} />}
          </Section>

          <Section title="Return Cost Trace">
            <Lookup value={returnId} setValue={setReturnId} onLoad={loadReturn} placeholder="Return UUID" />
            {returnTrace && <ReturnTrace trace={returnTrace} />}
          </Section>
        </>
      ) : (
        <div className="card"><span className="muted">Cost details are hidden because this user lacks cost.view.</span></div>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="card"><div className="muted" style={{ fontSize: 12 }}>{label}</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div><div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{hint}</div></div>;
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return <div className="card" style={{ marginBottom: 12 }}><div className="row" style={{ marginBottom: 10 }}><strong style={{ fontSize: 13 }}>{title}</strong>{aside && <span className="muted" style={{ fontSize: 12 }}>{aside}</span>}</div>{children}</div>;
}

function Empty({ colSpan, text }: { colSpan: number; text: string }) {
  return <tr><td colSpan={colSpan} className="muted" style={{ textAlign: 'center', padding: 20 }}>{text}</td></tr>;
}

function Lookup({ value, setValue, onLoad, placeholder }: { value: string; setValue: (v: string) => void; onLoad: () => void; placeholder: string }) {
  return <div className="toolbar" style={{ marginBottom: 10 }}><input className="inline" style={{ minWidth: 360 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} /><button className="btn small" onClick={onLoad}>Load trace</button></div>;
}

function MovementDetail({ detail }: { detail: MovementCostDetailResponse }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{detail.movement.txnNumber} / {detail.movement.movementType} / {doc(detail.sourceDocument)} / COGS {money(detail.movement.totalCost)}</div>
      <ConsumptionTable rows={detail.consumptions} />
    </div>
  );
}

function ConsumptionTable({ rows }: { rows: MovementCostDetailResponse['consumptions'] }) {
  return <div className="table-wrap"><table className="grid"><thead><tr><th>Cost layer</th><th>Layer source</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Extended</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id}><td>{c.costLayerId.slice(0, 8)}</td><td>{doc(c.layerSourceDocument)}</td><td className="num">{c.quantity}</td><td className="num">{money(c.unitCost)}</td><td className="num">{money(c.extendedCost)}</td></tr>)}{rows.length === 0 && <Empty colSpan={5} text="This movement has no FIFO consumption rows." />}</tbody></table></div>;
}

function TransferTrace({ trace }: { trace: TransferCostTraceResponse }) {
  return <div>{trace.lines.map((line, i) => <Fragment key={`${line.productId}:${i}`}><div className="muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>{trace.transfer.number}: {line.productSku} / source {line.sourceMovementId.slice(0, 8)} / destination {line.destinationMovementId?.slice(0, 8) ?? '-'}</div><ConsumptionTable rows={line.sourceConsumptions} /><div className="table-wrap" style={{ marginTop: 8 }}><table className="grid"><thead><tr><th>Destination layer</th><th className="num">Received</th><th className="num">Remaining</th><th className="num">Unit cost</th><th className="num">Value</th></tr></thead><tbody>{line.destinationLayers.map((l) => <tr key={l.id}><td>{l.id.slice(0, 8)}</td><td className="num">{l.receivedQuantity}</td><td className="num">{l.remainingQuantity}</td><td className="num">{money(l.unitCost)}</td><td className="num">{money(l.remainingValue)}</td></tr>)}</tbody></table></div></Fragment>)}</div>;
}

function ReturnTrace({ trace }: { trace: ReturnCostTraceResponse }) {
  return <div>{trace.lines.map((line, i) => <div key={`${line.productId}:${i}`} style={{ marginTop: 8 }}><div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{trace.return.number}: {line.productSku} / serials {line.serialNumbers.join(', ') || 'none'} / receipt {line.receiptMovementId?.slice(0, 8) ?? '-'}</div><div className="table-wrap"><table className="grid"><thead><tr><th>Serial</th><th>Original issue</th><th className="num">Issue COGS</th></tr></thead><tbody>{line.originalIssueMovements.map((m) => <tr key={m.serialNumber}><td>{m.serialNumber}</td><td>{m.movement?.txnNumber ?? '-'}</td><td className="num">{money(m.movement?.totalCost)}</td></tr>)}{line.originalIssueMovements.length === 0 && <Empty colSpan={3} text="No serialized issue trace is available." />}</tbody></table></div><div className="table-wrap" style={{ marginTop: 8 }}><table className="grid"><thead><tr><th>Restored layer</th><th className="num">Received</th><th className="num">Remaining</th><th className="num">Unit cost</th><th className="num">Value</th></tr></thead><tbody>{line.restoredLayers.map((l) => <tr key={l.id}><td>{l.id.slice(0, 8)}</td><td className="num">{l.receivedQuantity}</td><td className="num">{l.remainingQuantity}</td><td className="num">{money(l.unitCost)}</td><td className="num">{money(l.remainingValue)}</td></tr>)}</tbody></table></div></div>)}</div>;
}

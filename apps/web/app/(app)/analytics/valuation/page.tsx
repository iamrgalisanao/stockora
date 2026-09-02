'use client';

import { useEffect, useState } from 'react';
import type { ValuationGrouping, ValuationReport } from '@iw/contracts';
import { api } from '../../../../lib/api';

const GROUPS: ValuationGrouping[] = ['warehouse', 'category', 'brand'];

export default function ValuationReportPage() {
  const [groupBy, setGroupBy] = useState<ValuationGrouping>('warehouse');
  const [report, setReport] = useState<ValuationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .reports.valuation(groupBy)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [groupBy]);

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Inventory Valuation</h1>
        <div className="toolbar">
          {GROUPS.map((g) => (
            <button key={g} className={`btn ${g === groupBy ? '' : 'secondary'} small`} onClick={() => setGroupBy(g)} style={{ marginTop: 0 }}>
              By {g}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!report ? (
        <div className="card muted">Loading…</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Total inventory value</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>
              {Number(report.totalValue).toLocaleString(undefined, { style: 'currency', currency: 'PHP' })}
            </div>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th><th className="num">On hand</th><th className="num">Value</th></tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="num">{Number(r.onHand).toLocaleString()}</td>
                    <td className="num">{Number(r.value).toLocaleString(undefined, { style: 'currency', currency: 'PHP' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

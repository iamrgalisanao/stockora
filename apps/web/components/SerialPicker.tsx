'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SerialResponse, SerialStatus } from '@iw/contracts';
import { api } from '../lib/api';

/**
 * Shared serial selection/capture control (2D.3C, ADR 0012). Used by release, transfer, return, adjustment,
 * and count workflows.
 *
 * - `mode: 'select'` (RECEIPT capture) — only existing eligible serials appear; the operator picks/scans
 *   from them. Wrong-warehouse / wrong-lot / wrong-status serials are never eligible, so they can't be chosen.
 * - `mode: 'capture'` (ISSUE capture) — no existing serials; the operator scans/types NEW serial numbers to
 *   register at issue.
 *
 * Both modes enforce an exact `requiredCount`, suppress duplicate scans, and never let the parent submit
 * until `value.length === requiredCount`.
 */
export interface SerialPickerProps {
  mode: 'select' | 'capture';
  productId: string;
  variantId?: string | null;
  warehouseId: string;
  lotId?: string | null;
  requiredCount: number;
  status?: SerialStatus; // eligible status in select mode (default IN_STOCK)
  value: string[];
  onChange: (serials: string[]) => void;
  disabled?: boolean;
}

export function SerialPicker(props: SerialPickerProps) {
  const { mode, productId, warehouseId, lotId, requiredCount, value, onChange, disabled } = props;
  const status = props.status ?? 'IN_STOCK';
  const [eligible, setEligible] = useState<SerialResponse[]>([]);
  const [scan, setScan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode !== 'select' || !productId) { setEligible([]); return; }
    setLoading(true);
    api.serials
      .list({ productId, warehouseId: warehouseId || undefined, status, lotId: lotId ?? undefined })
      .then(setEligible)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load serials'))
      .finally(() => setLoading(false));
  }, [mode, productId, warehouseId, lotId, status]);

  const eligibleByNumber = useMemo(() => new Map(eligible.map((s) => [s.serialNumber, s])), [eligible]);
  const selected = new Set(value);
  const full = value.length >= requiredCount;

  const add = (raw: string) => {
    const sn = raw.trim();
    if (!sn) return;
    if (selected.has(sn)) { setError(null); return; } // duplicate scan suppressed
    if (mode === 'select' && !eligibleByNumber.has(sn)) { setError(`${sn} is not an eligible serial here`); return; }
    if (full) { setError(`Only ${requiredCount} serial(s) required`); return; }
    setError(null);
    onChange([...value, sn]);
  };
  const remove = (sn: string) => onChange(value.filter((s) => s !== sn));

  return (
    <div style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Serial numbers</strong>
        <span className={value.length === requiredCount ? 'muted' : 'error'} style={{ fontSize: 12, fontWeight: 600 }}>
          Selected {value.length} / {requiredCount}
        </span>
      </div>

      {!disabled && (
        <input
          ref={inputRef}
          value={scan}
          placeholder={mode === 'capture' ? 'Type/scan a NEW serial, Enter to add' : 'Scan or type an eligible serial, Enter to add'}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(scan); setScan(''); inputRef.current?.focus(); } }}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
        />
      )}
      {error && <div className="error" style={{ fontSize: 12, marginTop: 6 }}>{error}</div>}

      {/* Selected chips */}
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {value.map((sn) => (
            <span key={sn} style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--accent-soft, #e7f0ee)', border: '1px solid var(--line,#ccc)', borderRadius: 14, padding: '3px 8px' }}>
              {sn} {!disabled && <button type="button" onClick={() => remove(sn)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger,#b3261e)' }}>✕</button>}
            </span>
          ))}
        </div>
      )}

      {/* Eligible list (select mode) — click to toggle */}
      {mode === 'select' && !disabled && (
        <div style={{ marginTop: 10, maxHeight: 180, overflowY: 'auto', borderTop: '1px dashed var(--line,#ddd)', paddingTop: 8 }}>
          {loading && <div className="muted" style={{ fontSize: 12 }}>Loading eligible serials…</div>}
          {!loading && eligible.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No eligible serials in this warehouse{lotId ? '/lot' : ''}.</div>}
          {eligible.map((s) => {
            const on = selected.has(s.serialNumber);
            return (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => (on ? remove(s.serialNumber) : add(s.serialNumber))}
                  disabled={!on && full}
                />
                <span style={{ fontFamily: 'monospace' }}>{s.serialNumber}</span>
                {s.lotNumber && <span className="muted">· {s.lotNumber}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BalanceResponse, BarcodeResolutionResult, ScanDiagnosis } from '@iw/contracts';
import { api } from '../../../lib/api';
import { isDuplicateScan, useLastScan, useScannerInput } from '../../../lib/use-scanner';

export default function ScanPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScan = useLastScan();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BarcodeResolutionResult | null>(null);
  const [diagnosis, setDiagnosis] = useState<ScanDiagnosis | null>(null);
  const [stock, setStock] = useState<BalanceResponse[] | null>(null);
  const [cameraMsg, setCameraMsg] = useState<string | null>(null);

  // Arm the field for keyboard-wedge scans (this is a safe screen for that behavior).
  useScannerInput(inputRef, true);

  const submit = useCallback((raw: string) => {
    const value = raw.trim();
    if (!value) return;
    // One code, one resolve — a scanner's trailing Enter/burst must not double-fire.
    if (isDuplicateScan(value, lastScan.current, Date.now())) return;
    lastScan.current = { code: value, at: Date.now() };

    setBusy(true); setResult(null); setDiagnosis(null); setStock(null);
    api.resolve(value)
      .then((r) => setResult(r))
      .catch(async () => {
        // The plain resolver is identity-only and hides non-active records; ask the diagnostic
        // path (if permitted) WHY it didn't resolve, otherwise report a clean not-found.
        try {
          setDiagnosis(await api.resolveDiagnose(value));
        } catch {
          setDiagnosis({ code: value, outcome: 'NOT_FOUND', reason: 'No active identity for this code', result: null });
        }
      })
      .finally(() => { setBusy(false); setCode(''); inputRef.current?.focus(); });
  }, [lastScan]);

  async function useCamera() {
    setCameraMsg(null);
    const Detector = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect: (s: unknown) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Camera scanning is not supported in this browser. Use a hardware scanner or type the code.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      const detector = new Detector();
      setCameraMsg('Point the camera at a barcode…');
      const stop = () => stream.getTracks().forEach((t) => t.stop());
      const tick = async () => {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) { stop(); setCameraMsg(null); submit(codes[0].rawValue); return; }
        } catch { /* keep trying */ }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => { stop(); setCameraMsg((m) => (m === 'Point the camera at a barcode…' ? null : m)); }, 20_000);
    } catch {
      setCameraMsg('Could not access the camera.');
    }
  }

  function viewStock() {
    if (!result) return;
    api.balances({ productId: result.productId }).then(setStock).catch(() => setStock([]));
  }

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Scan</h1>
        <button className="btn secondary small" style={{ marginTop: 0 }} onClick={() => router.push('/search')}>Text search →</button>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field-row" style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'end' }}>
          <div>
            <label>Barcode</label>
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(code); } }}
              placeholder="Scan or type a barcode, then Enter"
              style={{ fontSize: 18, padding: '12px 14px' }}
              autoComplete="off"
            />
          </div>
          <button className="btn" style={{ marginTop: 0 }} disabled={busy} onClick={() => submit(code)}>Resolve</button>
          <button className="btn secondary" style={{ marginTop: 0 }} onClick={useCamera}>Use camera</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Hardware scanners, manual entry, and the camera all resolve through the same BarcodeResolver.
        </div>
        {cameraMsg && <div className="muted" style={{ marginTop: 8 }}>{cameraMsg}</div>}
      </div>

      {result && <IdentityPanel result={result} onOpen={() => router.push(`/products/${result.productId}`)} onViewStock={viewStock} stock={stock} />}

      {diagnosis && diagnosis.outcome !== 'RESOLVED' && (
        <div className={`card ${diagnosis.outcome === 'NOT_FOUND' ? '' : 'error'}`}>
          <strong>{humanOutcome(diagnosis.outcome)}</strong>
          <div className="muted" style={{ marginTop: 4 }}>
            Code <code>{diagnosis.code}</code>{diagnosis.reason ? ` — ${diagnosis.reason}` : ''}.
          </div>
        </div>
      )}
    </div>
  );
}

function IdentityPanel({ result, onOpen, onViewStock, stock }: {
  result: BarcodeResolutionResult; onOpen: () => void; onViewStock: () => void; stock: BalanceResponse[] | null;
}) {
  return (
    <div className="card">
      <div style={{ fontSize: 20, fontWeight: 700 }}>{result.metadata.name}</div>
      {result.type === 'PRODUCT_VARIANT' && <div className="muted">Variant: {result.metadata.sku}</div>}
      <table className="grid" style={{ marginTop: 10, maxWidth: 420 }}><tbody>
        <tr><td className="muted">SKU</td><td>{result.metadata.sku}</td></tr>
        <tr><td className="muted">Barcode</td><td><code>{result.displayCode}</code></td></tr>
        <tr><td className="muted">Type</td><td>{result.type === 'PRODUCT_VARIANT' ? 'Product variant' : 'Product'}</td></tr>
        <tr><td className="muted">Status</td><td><span className="badge ok">{result.status}</span></td></tr>
      </tbody></table>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onOpen}>Open Product</button>
        <button className="btn secondary" onClick={onViewStock}>View Stock</button>
      </div>

      {stock !== null && (
        <div style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Availability is a separate inventory query — never part of the identity resolve.</div>
          {stock.length === 0 ? <div className="muted">No stock on hand.</div> : (
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>Warehouse</th><th className="num">On hand</th><th className="num">Available</th><th className="num">Reserved</th></tr></thead>
                <tbody>
                  {stock.map((b) => (
                    <tr key={`${b.warehouseId}:${b.variantId ?? ''}`}>
                      <td>{b.warehouseCode}</td>
                      <td className="num">{b.onHand}</td>
                      <td className="num">{b.available}</td>
                      <td className="num">{b.reserved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function humanOutcome(o: ScanDiagnosis['outcome']): string {
  switch (o) {
    case 'NOT_FOUND': return 'Not found';
    case 'INACTIVE': return 'Code is inactive';
    case 'ARCHIVED': return 'Code is archived';
    case 'AMBIGUOUS': return 'Ambiguous code';
    default: return 'Unresolved';
  }
}

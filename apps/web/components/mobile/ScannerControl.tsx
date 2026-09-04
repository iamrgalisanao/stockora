'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isDuplicateScan, useLastScan, useScannerInput } from '../../lib/use-scanner';
import { detectScannerCapabilities } from '../../lib/mobile';

/**
 * Shared scanner control (2D.6B, ADR 0014 §10). One control across every workflow — hardware wedge and
 * manual entry are always available; the native BarcodeDetector camera path is offered only when the device
 * supports it (feature-detected). Every path converges on `onScan`, with duplicate-scan suppression so a
 * wedge's trailing Enter burst or a camera re-detect never double-fires.
 */
export function ScannerControl({ onScan, placeholder = 'Scan or type a code', autoFocus = true }: {
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScan = useLastScan();
  const [value, setValue] = useState('');
  const [cameraMsg, setCameraMsg] = useState<string | null>(null);
  const caps = useRef(detectScannerCapabilities());
  const stopCamera = useRef<(() => void) | null>(null);

  useScannerInput(inputRef, autoFocus);

  const submit = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    if (isDuplicateScan(code, lastScan.current, Date.now())) { setValue(''); return; }
    lastScan.current = { code, at: Date.now() };
    onScan(code);
    setValue('');
    inputRef.current?.focus();
  }, [onScan, lastScan]);

  useEffect(() => () => { stopCamera.current?.(); }, []);

  const useCamera = useCallback(async () => {
    setCameraMsg(null);
    const Detector = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect: (s: unknown) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Camera scanning is not available here — use the hardware scanner or type the code.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      const detector = new Detector();
      let active = true;
      const stop = () => { active = false; stream.getTracks().forEach((t) => t.stop()); stopCamera.current = null; setCameraMsg(null); };
      stopCamera.current = stop;
      setCameraMsg('Point the camera at a barcode…');
      const tick = async () => {
        if (!active) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) { submit(codes[0].rawValue); stop(); return; }
        } catch { /* transient */ }
        if (active) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setCameraMsg('Camera permission was denied — use the hardware scanner or type the code.');
    }
  }, [submit]);

  return (
    <div>
      <div className="m-scan-row">
        <input
          ref={inputRef}
          className="m-input"
          inputMode="text"
          autoCapitalize="characters"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(value); } }}
        />
        <button type="button" className="m-btn secondary m-scan-add" onClick={() => submit(value)}>Add</button>
      </div>
      {caps.current.camera && (
        <button type="button" className="m-btn secondary" onClick={useCamera}>Scan with camera</button>
      )}
      {cameraMsg && <p className="m-sub" style={{ marginTop: 8, marginBottom: 0 }}>{cameraMsg}</p>}
    </div>
  );
}

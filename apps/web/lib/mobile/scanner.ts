/**
 * Scanner adapter abstraction (2D.6A, ADR 0014 §10). Every scan — hardware wedge, native BarcodeDetector,
 * camera-library fallback, or manual typing — converges on one `onScan(code)` path. Barcode detection and
 * camera are FEATURE-DETECTED enhancements; the keyboard wedge and manual entry are always available so no
 * device is ever locked out of the workflow.
 *
 * 2D.6A ships the capability detection and the adapter interface + the two guaranteed adapters (wedge,
 * manual) reusing the existing scan-input coalescing. The camera/native adapters are wired into workflow
 * screens in 2D.6B; here we only prove they can be detected and selected.
 */

import type { ScannerCapabilities } from '@iw/contracts';

export type ScannerAdapterKind = 'keyboard-wedge' | 'native-detector' | 'camera-fallback' | 'manual';

/** Detect which scan paths this device/browser can offer right now. */
export function detectScannerCapabilities(): ScannerCapabilities {
  const hasWindow = typeof window !== 'undefined';
  const nativeBarcodeDetector = hasWindow && 'BarcodeDetector' in window;
  const camera = hasWindow && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  return {
    keyboardWedge: true, // hardware wedges type into a focused field — always possible
    nativeBarcodeDetector,
    camera,
    manual: true, // manual entry is the guaranteed baseline
  };
}

/** Preferred adapter given detected capabilities and any operator override. */
export function preferredAdapter(caps: ScannerCapabilities, override?: ScannerAdapterKind): ScannerAdapterKind {
  if (override) return override;
  // A hardware wedge is the fastest, most reliable warehouse path when present; camera is the fallback.
  if (caps.nativeBarcodeDetector && caps.camera) return 'native-detector';
  if (caps.camera) return 'camera-fallback';
  return 'keyboard-wedge';
}

export interface ScannerAdapter {
  readonly kind: ScannerAdapterKind;
  readonly available: boolean;
  /** Begin delivering scans to `onScan`. Returns a stop function. */
  start(onScan: (code: string) => void): () => void;
}

/**
 * Coalesce guard shared by every adapter: the same code within `windowMs` is a duplicate (a wedge's trailing
 * Enter burst, a double tap, a camera re-detect) and must not fire twice. Mirrors the desktop scan behaviour.
 */
export function makeCoalescer(windowMs = 800): (code: string, onScan: (c: string) => void) => void {
  let last: { code: string; at: number } | null = null;
  return (code, onScan) => {
    const value = code.trim();
    if (!value) return;
    const now = Date.now();
    if (last && last.code === value && now - last.at < windowMs) return;
    last = { code: value, at: now };
    onScan(value);
  };
}

/**
 * Keyboard-wedge adapter — the always-available baseline. Hardware scanners emit keystrokes ending in Enter;
 * this listens on the document and assembles a code between Enters. Manual typing into a field is the same
 * path from the operator's point of view.
 */
export class KeyboardWedgeAdapter implements ScannerAdapter {
  readonly kind: ScannerAdapterKind = 'keyboard-wedge';
  readonly available = true;

  start(onScan: (code: string) => void): () => void {
    if (typeof document === 'undefined') return () => {};
    const coalesce = makeCoalescer();
    let buffer = '';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (buffer) coalesce(buffer, onScan);
        buffer = '';
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buffer += e.key;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }
}

/** Manual adapter — the operator types/pastes a code and submits it explicitly. Always available. */
export class ManualAdapter implements ScannerAdapter {
  readonly kind: ScannerAdapterKind = 'manual';
  readonly available = true;
  private coalesce = makeCoalescer();
  private sink: ((code: string) => void) | null = null;

  start(onScan: (code: string) => void): () => void {
    this.sink = onScan;
    return () => {
      this.sink = null;
    };
  }

  /** Called by the UI when the operator submits a manually entered code. */
  submit(code: string): void {
    if (this.sink) this.coalesce(code, this.sink);
  }
}

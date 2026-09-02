import { useEffect, useRef } from 'react';

/**
 * Coalesce guard shared by every input path (hardware wedge, manual type, camera): the same code
 * submitted again within `windowMs` is a duplicate (a scanner's trailing Enter burst, a double tap)
 * and must not resolve twice.
 */
export function isDuplicateScan(
  code: string,
  last: { code: string; at: number } | null,
  now: number,
  windowMs = 800,
): boolean {
  if (!last) return false;
  return last.code === code && now - last.at < windowMs;
}

/**
 * A small scanner-input controller for a *safe* screen. Rather than attaching arbitrary global key
 * listeners app-wide, this arms a single document listener only while `enabled`, and only refocuses
 * the provided input when a printable key arrives elsewhere — so a keyboard-wedge scan lands even if
 * the field lost focus. Hardware scanners type fast then press Enter; that Enter is handled by the
 * input itself. Manual typing and camera scans converge on the same submit path.
 */
export function useScannerInput(inputRef: React.RefObject<HTMLInputElement>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = inputRef.current;
      if (!el) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Ignore keys already going to a form field (including our own input) or modifier combos.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1) el.focus(); // a printable key elsewhere -> arm the scan field
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inputRef, enabled]);

  // Keep the field focused on mount so a wedge scan is captured immediately.
  useEffect(() => {
    if (enabled) inputRef.current?.focus();
  }, [inputRef, enabled]);
}

/** Small helper to hold the last-accepted scan across renders. */
export function useLastScan() {
  return useRef<{ code: string; at: number } | null>(null);
}

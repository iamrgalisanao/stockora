# Phase 2A.2B — Barcode Scanner UX (backend + UI)

**Status: ✅ Complete.** Second half of 2A.2. Fast identity resolution from a scanner, keeping the
existing `BarcodeResolver` authoritative — barcode matching is never duplicated in the frontend, and
identity never carries stock availability.

## Backend
- The plain resolver contract is **unchanged**: `GET /api/resolve?code=` returns identity only and
  excludes inactive/archived records (404 on miss).
- **New operator diagnostic** (`GET /api/resolve/diagnose?code=`, gated behind `product.manage`):
  explains *why* a code doesn't resolve — `RESOLVED` / `NOT_FOUND` / `INACTIVE` / `ARCHIVED` /
  `AMBIGUOUS` — instead of a bare not-found. This is the deliberate exception to the identity-only,
  active-only contract, kept on a privileged path rather than baked into normal resolution.
- Contract: `SCAN_OUTCOMES` / `ScanOutcome`, `ScanDiagnosis { code, outcome, reason, result }`
  (`result` identity-only, present only when `RESOLVED`).

## Web UI
- **Scan** (Overview → Scan): a single field that all inputs converge on.
  - **Scanner-input controller** (`useScannerInput`) arms a document key listener **only on this safe
    screen**, refocusing the field when a printable key arrives elsewhere — so a keyboard-wedge scan
    (fast keys + Enter) lands even without explicit focus. No arbitrary global listeners elsewhere.
  - **Duplicate guard** (`isDuplicateScan`): the same code within 800 ms is coalesced, so a scanner's
    trailing Enter/burst resolves **once**.
  - **Camera** (progressive enhancement): uses the native `BarcodeDetector` + `getUserMedia` when
    available, feeding detections into the same submit path; a clear message when unsupported.
  - **Identity panel** on success — name, variant, SKU, barcode, status — with **Open Product** and
    **View Stock**. `View Stock` fires a *separate* inventory-balances query; availability is never
    mixed into the resolve response.
  - **Failed scans** show the diagnostic outcome + reason (e.g. "Product OLD-1 is ARCHIVED").
- Hardware wedge, manual entry, and camera all resolve through the one `BarcodeResolver` endpoint.

## Tests
- **e2e** (`scanner-resolver.e2e-spec.ts`, 4): resolve returns identity only (no stock fields);
  unknown → 404 and non-active hidden from the plain resolver; diagnostic returns
  RESOLVED/NOT_FOUND/ARCHIVED/INACTIVE; the diagnostic is gated behind `product.manage` (a viewer can
  use the plain resolver but not the diagnostic).
- **Browser-verified**: manual/wedge input resolves once under a duplicate Enter burst; identity panel;
  View Stock as a separate query; archived + not-found diagnostics.

## Deferred (as scoped)
Transactional scanning (scan-to-receive/pick/count) is out of scope for 2A.2 — this slice is
find-and-identify. Search terms and scan history are intentionally **not** persisted (no new
audit/privacy surface); a local recent-items list can come later if needed.

---
**2A.2 complete.** Next: **2A.3 — Import / Export** (the remaining onboarding accelerator before
hardening).

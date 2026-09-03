# Phase 2D.3C — Serial Traceability UX

**Status: ✅ Complete.** Final slice of 2D.3 ([ADR 0012](adr/0012-serial-tracking.md)). The engine was already
complete (2D.3A/B); this slice adds identity **visibility** and **safe operational selection** — no new ADR.
**This completes 2D.3 Serial Tracking.**

## Serial history (new backend capability)

`GET /serials/:id/history` reconstructs a serial's full movement timeline. The registry keeps only the *last*
movement, so the timeline is assembled from the document items that carry the serial (their
`serialNumbers`/`observedSerials` arrays), each resolved to its originating document and ordered by time:

```
RECEIVED · ISSUED · TRANSFERRED_OUT · TRANSFERRED_IN · RETURNED · RESTOCKED · DAMAGED · DISPOSED ·
ADJUSTED_IN · ADJUSTED_OUT · COUNT_FOUND · COUNT_LOST
```

Every event links back to its receipt / release / transfer / return / adjustment / count (`documentType` +
`documentId` + `documentNumber`). Only posted/received documents contribute (actual state changes). The
serial list also gained an `inInventory` filter (physically-present states only).

## Serial Explorer & Detail

- **Explorer** (`/serials`): filters for product, warehouse, status, serial number, and "currently in
  inventory", plus the reconciliation banner; each row links to the detail.
- **Detail** (`/serials/:id`): summary + current state/location/lot, and the **movement-history timeline**
  with clickable document links.

## `<SerialPicker/>` — the shared selection/capture control

One component used by release, transfer, return, and disposition (and available to adjustment/count):

- **`mode="select"`** (RECEIPT capture) — only existing eligible serials appear, fetched by product +
  warehouse + status (+ lot); wrong-warehouse / wrong-status / wrong-lot serials are never eligible, so they
  can't be chosen. Manual click-to-select **and** scan-to-add.
- **`mode="capture"`** (ISSUE capture) — no existing serials; the operator scans/types NEW serial numbers to
  register at issue. The distinction is explicit in the component contract.
- Exact-count enforcement (`Selected N / required`), duplicate-scan suppression, multi-select for qty > 1,
  and a hard gate: the workflow can't post until `value.length === requiredCount`.

### Wiring

- **Release detail** — serialized lines reveal a picker at post (select for RECEIPT, capture for ISSUE);
  "Release to stock" is disabled until every serialized line is satisfied.
- **Transfer detail** — dispatch selects the exact serials at the source; **receive shows the dispatched set
  read-only** (no generic picker → no accidental substitution).
- **Return create** — serialized lines scan the returned serials from the ISSUED feed (a non-ISSUED or unknown
  serial can't be added; the backend rejects it too).
- **Return disposition** — picks from the line's QUARANTINED serials for restock / damage / disposal.

## Tests

`test/serial-traceability.e2e-spec.ts` (5): the timeline is complete + time-ordered with resolvable document
links; picker eligibility excludes wrong warehouse / status / lot; the return-scan feed resolves only ISSUED
serials; "currently in inventory" excludes issued/disposed; a historical ISSUED serial stays readable with its
history and the explorer is org-scoped (cross-org 404 on both the serial and its history). Full suite green
(48 suites / 348 tests).

**Browser-verified** the unit lifecycle end-to-end: received SN-001 → opened its Serial Detail (timeline
`Received · GR-000003`) → released it through the SerialPicker (eligibility shown, exact-count gate enforced) →
detail updated to `Issued` with the timeline now `Received → Issued (RL-000002)`, the same serial id intact
throughout.

## Definition of done

> An authorized user can find any serialized unit, see its current physical state and complete movement
> history, and safely select or scan the exact serial identities required by operational workflows without
> bypassing status, warehouse, or lot rules. ✅

**2D.3 Serial Tracking is complete** (2D.3A core+receiving, 2D.3B propagation, 2D.3C traceability UX). Next:
2D.4 — Supplier Analytics.

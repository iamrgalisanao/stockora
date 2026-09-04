# Phase 2D.6 - Mobile Scanner PWA

**Status: In progress — 2D.6A shipped.** Final Phase 2D item. Architecture is locked by
[ADR 0014](adr/0014-mobile-scanner-pwa.md): the mobile PWA is an online-authoritative warehouse client with an
offline command journal, explicit conflicts, and progressive enhancement for platform features. ADR 0014
explicitly locks the operational rules (server sole authority; first valid committed transaction wins; sync
always revalidates; conflicts never silently merged/reallocated; stable exactly-once idempotency keys;
Background Sync as enhancement only; IndexedDB as a temporary journal; bounded/rechecked offline auth; local
tab vs. cross-device coordination; upgrades never destroy unsynced work; feature-detected scanner fallbacks).

## Scope

2D.6 is more than a responsive mobile UI. It must support scanner-first warehouse work during unreliable
connectivity without weakening the existing inventory invariants.

Core rule:

> Offline scans capture operational intent. They do not mutate authoritative stock until synchronized and
> accepted by the server.

## Slices

### 2D.6A - PWA + Device Foundation ✅ Shipped

```text
Web App Manifest                       app/manifest.ts -> /manifest.webmanifest (installable, standalone, /m)
service worker (Workbox strategies)    public/sw.js — precache shell, network-first nav, cache-first static,
                                       NEVER caches /api/*, activation gated on SKIP_WAITING
installable standalone shell           app/(mobile) route group + mobile.css
offline application shell              /m + /offline precached; offline fallback page
IndexedDB local database              lib/mobile/db.ts — versioned migrations, command/meta/worklist/conflict stores
persistent-storage request            lib/mobile/device.ts — navigator.storage.persist() + estimate
device installation ID                lib/mobile/device.ts — generated UUID (never fingerprinted)
connectivity state + authenticated probe  lib/mobile/connectivity.ts + GET /api/health/mobile (authenticated)
service-worker update/version UX       lib/mobile/sw-register.ts — update-ready surfaced, activation gated on empty queue
Web Locks sync mutex                  lib/mobile/sync-lock.ts — one queue drainer per device
BroadcastChannel coordination         lib/mobile/channel.ts — typed message set
scanner adapter abstraction           lib/mobile/scanner.ts — capability detection + wedge/manual adapters
wake-lock progressive enhancement     lib/mobile/wake-lock.ts — feature-detected, auto-reacquire
command envelope (frozen)             lib/mobile/command.ts + contracts PendingCommand (capture only; sync in 2D.6C)
```

Definition of done — **met**:

> The app can install as a warehouse PWA, retain a bounded offline shell and local device identity, coordinate
> one sync worker per device, detect real API connectivity, and expose scanner capability fallbacks without
> caching sensitive authenticated data.

Verified live: manifest served + installable; SW active with scope `/`; IndexedDB journal writes a QUEUED
command and reports the pending count; device installation ID generated; persistent storage requested;
`/health/mobile` proves ONLINE with session identity + scope; Web Locks election acquires/releases; scanner
capabilities detected (preferred adapter resolves by device); no hydration errors on a clean load. Coverage:
`apps/api/test/mobile-health.e2e-spec.ts`; web validated by typecheck + production build + live smoke.

### 2D.6B - Mobile Workflows ✅ Shipped

```text
shared shell + scanner controls    components/mobile/{WorkflowRunner,ScannerControl,StatusBadge,MobileHeader}
receive against known receipt       /m/receive  -> RECEIVE (qty + lot/batch + serials, exact-count gate)
pick/release against a release       /m/pick     -> RELEASE_PICK (serials + cached FEFO, "revalidation required")
transfer dispatch / receive          /m/transfer -> TRANSFER_DISPATCH / TRANSFER_RECEIVE (no serial substitution)
cycle/physical count                /m/count    -> COUNT_SUBMIT (qty or observed serials; blind hides target)
return intake                       /m/return   -> RETURN_RECEIVE
mobile worklist read models         GET /mobile/work/{receiving,releases,transfers,counts,returns} (scoped, bounded)
offline worklist snapshots          lib/mobile/worklist.ts (fetch + IndexedDB cache; offline fallback)
work session (survives restart)     lib/mobile/work-session.ts (IndexedDB v2), distinct from PendingCommand
one online+offline command path     lib/mobile/submit.ts (SUBMISSION_UNKNOWN retry w/ same key; Web Locks drain)
task claiming + lease/takeover       POST/DELETE /mobile/work/:type/:id/claim (advisory, never authority)
duplicate-scan suppression          shared coalescer; exact-count + running counter
status feedback                     ✓ Synced / ⏳ Pending sync / ⚠ Needs attention
Pending Sync + Conflicts nav        /m/pending (Sync now), /m/conflicts (placeholder until 2D.6C)
```

Definition of done — **met**:

> Operators can claim/download bounded warehouse work, scan or manually enter identifiers quickly, and build
> local command intent for the supported workflows with clear scanned/synced/conflict counts.

Architectural note: online submit and offline capture share ONE command path (`POST /mobile/commands`), which
in 2D.6B durably ACKNOWLEDGES a command exactly-once by idempotency key but does NOT execute it against
inventory — execution, revalidation, and conflict resolution are 2D.6C. Verified live: the full offline
cycle-count scenario (open online → capture → reload restores the session → submit offline shows Pending, not
success → server inventory unchanged → reconnect + Sync now → Synced), plus `mobile-workflows.e2e-spec.ts`
(10) for scope/isolation/exclusion/tracking/claim/idempotency/gates/no-mutation.

### 2D.6C - Offline Command + Conflict Engine

```text
PendingCommand queue
idempotency keys
dependency ordering
manual Sync Now
startup/resume/reconnect sync
Background Sync enhancement
server command revalidation
normalized CommandResult
normalized ConflictType
conflict inbox
command receipts
optimistic aggregate/document versions
```

Definition of done:

> Queued mobile commands sync exactly once, preserve dependency order, revalidate against current server state,
> and surface explicit conflicts without silent merge, reallocation, or overwrite.

### 2D.6D - Resilience + Operational Hardening

```text
offline authorization window
offline read-only expiry
logout/local wipe
IndexedDB schema migrations
client command schema compatibility
service-worker update safety
storage persistence/eviction handling
multi-device race tests
network interruption tests
sync telemetry
mobile sync health surface
browser/device compatibility matrix
```

Definition of done:

> Unsynced work survives supported app upgrades and restart/interruption paths, authorization is rechecked on
> sync, revoked or stale work fails explicitly, and operational health is observable by administrators.

## Explicit Non-Goals

Online-only in the initial PWA scope:

```text
master-data editing
policy configuration
approval decisions
costing
supplier analytics
audit administration
imports
user management
```

## Production Readiness Acceptance

Before 2D.6 is marked complete:

```text
two online devices issue same serial -> one commit
online + offline device issue same serial -> offline conflict on sync
two devices consume last available quantity -> no negative availability
two devices consume same lot -> no overdraw
two FEFO previews race -> stale plan rejected
reservation confirmation races release -> invariant preserved
two devices dispatch same transfer -> one dispatch
two devices receive same transfer -> one receive
two cycle-count posts race -> one authoritative outcome
same mobile command retried 10 times -> one business transaction
two tabs on same device drain queue -> one local sync worker
device reconnects during app restart -> commands retained
device stays offline across app deployment -> queue survives/migrates safely
authorization revoked while offline -> queued commands rejected on sync
storage eviction simulation -> user warned and no false successful state
```

Every relevant scenario should finish with:

```text
inventory reconcile = OK
serial reconcile = OK
FIFO reconcile = OK
reservation reconcile = OK
```

## References

- [ADR 0014 - Mobile Scanner PWA and Offline Command Journal](adr/0014-mobile-scanner-pwa.md)
- [2A.2B - Scanner UX](PHASE-2A2B-SCANNER-UX.md)
- [2D.3 - Serial Tracking](PHASE-2D3C-TRACEABILITY-UX.md)
- [2D.5 - FIFO Costing](PHASE-2D5C-FIFO-UX-REPORTING.md)

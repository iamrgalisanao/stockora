# Phase 2D.6 - Mobile Scanner PWA

**Status: Planned.** Final Phase 2D item. Architecture is locked by
[ADR 0014](adr/0014-mobile-scanner-pwa.md): the mobile PWA is an online-authoritative warehouse client with an
offline command journal, explicit conflicts, and progressive enhancement for platform features.

## Scope

2D.6 is more than a responsive mobile UI. It must support scanner-first warehouse work during unreliable
connectivity without weakening the existing inventory invariants.

Core rule:

> Offline scans capture operational intent. They do not mutate authoritative stock until synchronized and
> accepted by the server.

## Slices

### 2D.6A - PWA + Device Foundation

```text
Web App Manifest
Workbox/service worker
installable standalone shell
offline application shell
IndexedDB local database
persistent-storage request
device installation ID
connectivity state + authenticated probe
service-worker update/version UX
Web Locks sync mutex
BroadcastChannel coordination
scanner adapter abstraction
wake-lock progressive enhancement
```

Definition of done:

> The app can install as a warehouse PWA, retain a bounded offline shell and local device identity, coordinate
> one sync worker per device, detect real API connectivity, and expose scanner capability fallbacks without
> caching sensitive authenticated data.

### 2D.6B - Mobile Workflows

```text
scanner-first UI
receive against known receipt
pick/release against assigned release
transfer scanning
cycle count scanning
return intake/disposition where ready
offline worklist snapshots
shared barcode/lot/serial controls
task claiming + lease display/takeover
large scan target
success/conflict feedback
duplicate-scan suppression
continuous scanning
undo last local scan
running quantity counter
```

Definition of done:

> Operators can claim/download bounded warehouse work, scan or manually enter identifiers quickly, and build
> local command intent for the supported workflows with clear scanned/synced/conflict counts.

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

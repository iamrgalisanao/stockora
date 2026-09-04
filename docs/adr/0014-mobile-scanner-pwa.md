# ADR 0014 - Mobile Scanner PWA and Offline Command Journal

**Status:** Accepted. **Date:** 2026-09-04. **Related:** [0001 Inventory Invariants](0001-inventory-invariants.md),
[0005 Reservations](0005-reservations.md), [0008 Expiry/FEFO](0008-expiry-fefo.md),
[0009 Cycle Counting](0009-cycle-counting.md), [0010 Transactional Outbox](0010-transactional-outbox.md),
[0012 Serial Tracking](0012-serial-tracking.md), [0013 FIFO Costing](0013-fifo-costing.md).

## Context

Warehouses need scanner-first workflows that tolerate weak Wi-Fi, interrupted sessions, and multiple workers
touching the same documents or stock identities. The mobile client must improve operational speed without
weakening the ledger, reservation, serial, lot, FEFO, and FIFO invariants already enforced by the server.

Current browser/PWA capabilities are uneven across platforms. A web app manifest and service worker are the
install/offline foundation, but Background Sync and Barcode Detection are still progressive enhancements rather
than universal dependencies. Camera access, IndexedDB, persistent storage requests, Web Locks, BroadcastChannel,
and Screen Wake Lock are useful building blocks, but each still needs feature detection and graceful fallback.

## Central Principle

> **The mobile PWA is an online-authoritative warehouse client with an offline command journal, not an offline
> inventory system that later syncs.**

Offline scans capture intent. They do not mutate authoritative stock. The server and database remain the only
inventory authority.

## Core Decisions

**1. The server/database remain authoritative.** Inventory quantity, serial state, lot availability,
reservations, document lifecycle, and FIFO/WAC valuation are decided by server commands inside short,
deterministic transactions with database constraints and row locks.

**1a. First valid committed transaction wins.** Under concurrency — two devices, or an offline device against
online activity — the **first command that validates and commits against current server state wins**. Any later
command touching the same stock, serial, lot, reservation, or document is revalidated against the new committed
state; if the precondition it captured no longer holds, it conflicts (Decision 6). There is no last-writer-wins,
no offline priority, and no client-supplied version that can override a committed server fact.

**2. Offline scans create commands, not stock mutations.** The device records intent such as "pick these
serials for release RL-100" or "observe this count set", never "stock = stock - 5". **Sync always revalidates
against current server state** — a queued command is applied by re-running full server validation at receive
time, never blind-replayed from the client's captured view.

**3. Every queued command has stable identity and versioning.** The `idempotencyKey` is generated once when
the command is captured and is **stable across every retry, app restart, service-worker upgrade, and IndexedDB
migration**. The server enforces exactly-once on that key, so a command retried any number of times yields at
most one business transaction (`ALREADY_PROCESSED` on repeats). `expectedVersion?` carries the optimistic
concurrency token the command was captured against; the server compares it to the current aggregate version to
detect staleness.

```text
PendingCommand
- commandId
- schemaVersion
- appVersion
- organizationId
- warehouseId
- deviceId
- userId
- commandType
- aggregateId?
- expectedVersion?
- dependsOnCommandId?
- sequence
- payload
- idempotencyKey
- capturedAt
- state
- attempts
- lastAttemptAt?
- conflict?
```

States:

```text
LOCAL_DRAFT
QUEUED
SYNCING
SYNCED
CONFLICT
FAILED
BLOCKED
CANCELLED
```

**4. Sync is multi-triggered.** Background Sync is allowed only as a progressive enhancement. The app must also
sync on user action, startup/resume, proven API connectivity restoration, service-worker start fallback, and
manual retry from the conflict/queue UI.

**5. Connectivity is proven, not assumed from `navigator.onLine`.** The client may use browser online/offline
events as hints, but the effective state is based on a lightweight authenticated API probe such as
`GET /health/mobile`.

```text
OFFLINE
CONNECTING
ONLINE
DEGRADED
```

**6. Conflicts are explicit and never silently merged or reallocated.** The default command behavior is atomic:
if any part of a command conflicts, the command is rejected/conflicted unless that workflow explicitly supports
partial acceptance. The client never auto-picks a different serial, lot, or quantity to make a stale command
succeed — reallocation is an operator decision surfaced through the conflict UI, never a silent client rewrite.

```text
CommandResult = ACCEPTED | ALREADY_PROCESSED | CONFLICT | REJECTED
```

Representative conflict types:

```text
SERIAL_ALREADY_USED
SERIAL_WRONG_STATE
INSUFFICIENT_STOCK
LOT_NO_LONGER_AVAILABLE
FEFO_PLAN_STALE
DOCUMENT_STALE
DOCUMENT_ALREADY_COMPLETED
RESERVATION_ALREADY_CONSUMED
TRANSFER_ALREADY_RECEIVED
COUNT_ALREADY_POSTED
ASSIGNMENT_CHANGED
WAREHOUSE_SCOPE_CHANGED
SESSION_EXPIRED
COMMAND_VERSION_UNSUPPORTED
AUTHORIZATION_CHANGED
```

Representative resolutions:

```text
RESCAN
REFRESH
REALLOCATE
REMOVE_ITEM
REAUTHENTICATE
SUPERVISOR_REVIEW
DISCARD_LOCAL_COMMAND
```

**7. Multi-context coordination is local only.** Use Web Locks to ensure only one tab/window/service-worker
context on a device drains the command queue at a time:

```text
navigator.locks.request("inventory-command-sync", ...)
```

Use BroadcastChannel for same-origin coordination:

```text
SYNC_STARTED
COMMAND_SYNCED
COMMAND_CONFLICT
AUTH_LOGOUT
APP_UPDATED
```

These mechanisms reduce duplicate local work. They do not replace server/database concurrency controls between
physical devices.

**8. Device identity is generated, not fingerprinted.** The PWA creates a `deviceInstallationId` UUID and stores
it in IndexedDB. The server records command provenance:

```text
commandId
deviceId
userId
warehouseId
capturedAt
receivedAt
```

Administrators may later label devices, but hardware fingerprinting is not used.

**9. Work claiming uses leases, not authority.** Work claims reduce operator collisions for releases, receiving,
transfers, counts, and returns. They do not guarantee correctness.

```text
WarehouseTaskClaim
- task/document
- claimedBy
- deviceId
- claimedAt
- leaseExpiresAt
```

Correctness still comes from server command validation and database locks.

**10. Scanner input has three first-class paths.**

```text
KeyboardWedgeAdapter
NativeBarcodeDetectorAdapter
CameraLibraryFallbackAdapter
ManualAdapter
```

Barcode Detection and wake lock are feature-detected enhancements. Hardware wedge and manual entry must always
remain available. Camera scanning requires HTTPS and explicit user permission.

**11. Local storage is IndexedDB — a temporary operational journal, not inventory truth.** Use IndexedDB for the
command queue, offline worklists, reference cache, scanner session state, conflicts, device metadata, receipts,
and migrations. It records intent awaiting sync and cached read models for display; it is never a system of
record for stock, and a divergence between IndexedDB and the server is always resolved in the server's favour.
Request `navigator.storage.persist()` where available, but design for eviction.

**12. Auth is bounded offline and rechecked online.** Do not store refresh tokens in IndexedDB or localStorage.
The device may keep an offline identity/permission snapshot for a bounded operating window, after which offline
mode becomes read-only. On sync, the server rechecks session validity, user status, permissions, warehouse scope,
and document state. Revoked access rejects queued commands.

**13. Local data is intentionally narrow.** Offline data may include product/SKU, barcode, lot, serial,
warehouse task, quantities, document references, and worklist snapshots. Do not cache credentials, unrestricted
API responses, sensitive reports, cost layers, supplier commercial pricing, admin settings, full audit history,
or unnecessary personal data. Sign-out/device handover must offer local wipe.

**14. App upgrades may not destroy unsynced work.** Service-worker and IndexedDB upgrades are versioned. If
commands are queued, app update/reload is blocked unless the queue is synced or the migration explicitly
supports those command schemas.

**15. Worklists are explicit offline read models.** Do not make the whole desktop app offline-capable. Download
bounded `OfflineWorkItem` snapshots for assigned or claimed mobile tasks and revalidate them when commands sync.

## Initial Offline Workflow Scope

Tier 1:

```text
cycle counting
serial scanning
picking against an assigned release
transfer scanning
receiving against known receipt
```

Tier 2:

```text
returns
disposition
```

Online-only initially:

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

## Slices

- **2D.6A - PWA + Device Foundation:** manifest/installability, Workbox/service worker, offline shell,
  IndexedDB database, persistent-storage request, device installation ID, connectivity state, service-worker
  update UX, Web Locks sync mutex, BroadcastChannel coordination, scanner abstraction, wake-lock enhancement.
- **2D.6B - Mobile Workflows:** scanner-first receive, pick/release, transfer, cycle count, and return screens;
  offline worklist snapshots; shared barcode/lot/serial controls; task claiming.
- **2D.6C - Offline Command + Conflict Engine:** `PendingCommand`, idempotency keys, dependency ordering,
  manual/reconnect/background-enhanced sync, server revalidation, conflict contract, conflict inbox, command
  receipts, optimistic document versions.
- **2D.6D - Resilience + Operational Hardening:** offline authorization window, logout/local wipe, IndexedDB
  migrations, client schema/version compatibility, service-worker update safety, storage persistence/eviction
  handling, multi-device race tests, network interruption tests, sync telemetry, compatibility matrix.

## Mandatory Race-Condition Acceptance Suite

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

After relevant tests:

```text
inventory reconcile = OK
serial reconcile = OK
FIFO reconcile = OK
reservation reconcile = OK
```

## Definition of Done (2D.6)

> Warehouse operators can use an installable scanner-first mobile PWA to capture authorized work during
> unreliable connectivity, synchronize intent exactly once when the server is reachable, resolve explicit
> conflicts without silent merges, and preserve all inventory, serial, lot, reservation, FEFO, and FIFO
> invariants under multi-device concurrency.

## References

- MDN: [Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- web.dev: [Web app manifest](https://web.dev/learn/pwa/web-app-manifest)
- web.dev: [Workbox](https://web.dev/learn/pwa/workbox/)
- OWASP: [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- MDN: [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- MDN: [Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
- MDN: [Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API)
- MDN: [MediaDevices.getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- MDN: [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- MDN: [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- MDN: [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- OWASP: [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

/**
 * Mobile Scanner PWA — shared contracts (Phase 2D.6, ADR 0014).
 *
 * 2D.6A introduces the FOUNDATION types only: the pending-command envelope, its state machine, the
 * connectivity model, the authenticated mobile health probe, and the scanner-capability shape. Actual
 * syncing, conflict resolution, and command execution land in 2D.6C — but the envelope is frozen here so
 * 2D.6B workflows cannot invent an incompatible offline shape later.
 *
 * Central principle (ADR 0014): the mobile PWA is an online-authoritative warehouse client with an offline
 * command JOURNAL. The device records intent; the server/database remain the sole inventory authority. The
 * first valid transaction to commit wins; sync always revalidates against current server state.
 */

/** Local lifecycle of a captured command. Authoritative acceptance is a server fact (2D.6C). */
export type PendingCommandState =
  | 'LOCAL_DRAFT' // being built on-screen, not yet queued
  | 'QUEUED' // committed to the local journal, awaiting sync
  | 'SYNCING' // in flight to the server
  | 'SYNCED' // server accepted (or ALREADY_PROCESSED) — a settled business fact
  | 'CONFLICT' // server rejected on a precondition; needs operator resolution
  | 'FAILED' // transient/transport failure; eligible for retry
  | 'BLOCKED' // a dependency has not synced yet
  | 'CANCELLED'; // discarded locally before it was accepted

/**
 * The command types that 2D.6 will capture offline. Frozen as a union now so the journal schema and the
 * 2D.6B workflows agree on identifiers; server handlers arrive in 2D.6C. Online-only actions
 * (master-data, policy, approvals, costing, imports, user management) are intentionally absent.
 */
export type MobileCommandType =
  | 'RECEIVE_AGAINST_RECEIPT'
  | 'PICK_FOR_RELEASE'
  | 'TRANSFER_SCAN'
  | 'CYCLE_COUNT_OBSERVE'
  | 'RETURN_INTAKE'
  | 'RETURN_DISPOSITION';

/**
 * The offline command envelope (ADR 0014 §3). Every field is set at capture time on the device.
 *
 * - `idempotencyKey` is generated once and is STABLE across every retry, app restart, service-worker
 *   upgrade, and IndexedDB migration — the server enforces exactly-once on it.
 * - `expectedVersion` is the optimistic-concurrency token the command was captured against; the server
 *   compares it to the current aggregate version to detect staleness (→ CONFLICT).
 */
export interface PendingCommand<TPayload = unknown> {
  commandId: string; // client UUID, primary key of the local journal
  schemaVersion: number; // envelope/payload schema this record was written with
  appVersion: string; // app build that captured it (compatibility gate on sync)
  deviceId: string; // deviceInstallationId (ADR 0014 §8)
  organizationId: string;
  warehouseId: string;
  userId: string;
  commandType: MobileCommandType;
  aggregateId?: string; // target document/aggregate (release id, receipt id, count id, …)
  expectedVersion?: number; // optimistic concurrency token captured for aggregateId
  payload: TPayload; // command-specific intent (scanned serials, counted set, quantities)
  idempotencyKey: string; // stable exactly-once key
  capturedAt: string; // ISO timestamp captured on-device
  state: PendingCommandState;
}

/** Effective connectivity, proven by an authenticated probe rather than assumed from `navigator.onLine`. */
export type ConnectivityState =
  | 'OFFLINE' // no reachable server
  | 'CONNECTING' // a probe is in flight / reconnecting
  | 'ONLINE' // authenticated probe succeeded recently
  | 'DEGRADED'; // reachable but slow/unhealthy, or session needs attention

/**
 * Response of the authenticated `GET /health/mobile` probe (ADR 0014 §5). Proves real API reachability AND
 * that the caller's session is still valid, echoing the scope the server currently grants so the client can
 * detect a warehouse-scope or authorization change (ADR 0014 §12) at reconnect.
 */
export interface MobileHealthResponse {
  status: 'ok';
  serverTime: string; // ISO — also a coarse clock-skew reference
  userId: string;
  organizationId: string;
  warehouseScope: string[] | null; // null = all warehouses; otherwise the permitted set
  /** Minimum app build the server will accept commands from (client compatibility gate, ADR 0014 §14). */
  minAppVersion: string;
  /** Current envelope schema the server understands (client compatibility gate). */
  commandSchemaVersion: number;
}

/** Which scanner input paths are usable on this device, from feature detection (ADR 0014 §10). */
export interface ScannerCapabilities {
  keyboardWedge: boolean; // always true — hardware wedge/manual entry are the guaranteed baseline
  nativeBarcodeDetector: boolean; // BarcodeDetector API present
  camera: boolean; // getUserMedia present (still needs HTTPS + permission at use)
  manual: boolean; // always true
}

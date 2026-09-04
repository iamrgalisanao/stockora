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
 * The command catalog captured by the 2D.6B scanner workflows. One command per physical action against a
 * server-backed document. Online-only actions (master-data, policy, approvals, costing, imports, user
 * management) are intentionally absent — those never happen offline. The server acknowledges these
 * idempotently in 2D.6B (`POST /mobile/commands`) and executes them against inventory in 2D.6C.
 */
export type MobileCommandType =
  | 'RECEIVE' // receive lines against a known goods receipt
  | 'RELEASE_PICK' // pick/issue a release line (lot + serials)
  | 'TRANSFER_DISPATCH' // dispatch a transfer (exact stock identities)
  | 'TRANSFER_RECEIVE' // receive a transfer (exact dispatched identities, no substitution)
  | 'COUNT_SUBMIT' // submit a cycle/physical count (quantity or observed serial set)
  | 'RETURN_RECEIVE'; // receive returned stock into quarantine

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
  /**
   * SUBMISSION_UNKNOWN (ADR 0014, 2D.6B): the command was sent but the client never saw the response — an
   * HTTP timeout is NOT a failure. When true, retry with the SAME idempotencyKey; the server returns the
   * existing receipt if it already processed it. Never mint a new command in this case.
   */
  mayHaveReachedServer?: boolean;
  /** Attempt counter + last transport error, for the queue/retry surface. */
  attempts?: number;
  lastError?: string;
  /** Server receipt once acknowledged (2D.6B intake / 2D.6C apply). */
  receipt?: MobileCommandReceipt;
}

/**
 * Server acknowledgement of a submitted command (2D.6B `POST /mobile/commands`). In 2D.6B a command is
 * durably RECEIVED (queued for exactly-once apply); it is NOT yet executed against inventory — that, plus
 * revalidation and conflict resolution, is 2D.6C. Re-submitting the same idempotencyKey returns this same
 * receipt (ALREADY_PROCESSED), so a timeout-driven retry can never double-apply.
 */
export interface MobileCommandReceipt {
  commandId: string;
  idempotencyKey: string;
  outcome: 'RECEIVED' | 'ALREADY_PROCESSED';
  /** Server-side apply status. 2D.6B leaves this ACKNOWLEDGED; 2D.6C moves it to APPLIED/CONFLICT. */
  applyStatus: 'ACKNOWLEDGED';
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Mobile worklists + work sessions (2D.6B)
// ---------------------------------------------------------------------------

/** The five scanner-first workflows, and the worklist path segment for each. */
export type MobileWorkType = 'receiving' | 'releases' | 'transfers' | 'counts' | 'returns';

/** Per-line tracking obligations, so the capture UI knows what identity it must collect before submit. */
export interface MobileTrackingRequirement {
  serialized: boolean; // product carries per-unit serials
  serialCaptureAtReceipt: boolean; // RECEIPT-mode serials are captured during receiving
  lotTracked: boolean; // batch-tracked product
  requireLot: boolean; // a lot must be captured before the command is executable
}

/** A cached lot allocation (advisory FEFO/allocation guidance — server revalidation is authoritative). */
export interface MobileLotAllocation {
  lotId: string;
  lotCode?: string | null;
  quantity: number;
  expiryDate?: string | null;
}

/** One actionable line within a work item, with everything the scanner screen needs and nothing more. */
export interface MobileWorkLine {
  lineId: string;
  productId: string;
  variantId?: string | null;
  sku: string;
  name: string;
  /** The quantity to work toward (expected to receive / need to pick / dispatched to receive). Omitted for
   *  a blind count so the target is never shown while counting. */
  targetQty?: number;
  uom?: string;
  tracking: MobileTrackingRequirement;
  /** Cached eligible serial identities (pick source set, transfer-receive expected set, count expected set).
   *  Advisory offline; the server is authoritative on sync. */
  eligibleSerials?: string[];
  /** Cached advisory allocation (e.g. FEFO suggestion) — labelled "revalidation required" in the UI. */
  suggestedAllocation?: MobileLotAllocation[];
}

/** An advisory work claim/lease (ADR 0014 §9). Reduces operator collisions; never a correctness mechanism. */
export interface MobileWorkClaim {
  documentId: string;
  workType: MobileWorkType;
  claimedById: string;
  claimedByName: string;
  deviceId: string;
  claimedAt: string;
  leaseExpiresAt: string;
}

/** A narrow, bounded work item — a server-backed document ready for a mobile action. */
export interface MobileWorkItem {
  workType: MobileWorkType;
  /** Transfers split into two physical actions; other workflows leave this undefined. */
  subAction?: 'dispatch' | 'receive';
  documentId: string;
  reference: string; // human document number (receiptNumber, releaseNumber, …)
  warehouseId: string;
  warehouseCode: string;
  status: string; // document status (e.g. APPROVED, IN_TRANSIT, COUNTING)
  /** Optimistic-concurrency token (server `updatedAt` epoch ms) captured into the command's expectedVersion. */
  version: number;
  blind?: boolean; // counts: expected quantities withheld while counting
  lines: MobileWorkLine[];
  claim: MobileWorkClaim | null;
  updatedAt: string;
}

/** Local lifecycle of the operator's on-screen work (distinct from the executable PendingCommand). */
export type MobileWorkSessionState = 'ACTIVE' | 'READY_TO_SUBMIT' | 'SUBMITTED' | 'ABANDONED';

/**
 * The operator's current screen/work — separate from `PendingCommand`, which is the executable intent. A
 * session holds in-progress capture (scanned serials, running quantities) so a reload or restart restores
 * exactly where the operator was. One session may yield one command on submit.
 */
export interface MobileWorkSession {
  sessionId: string;
  type: MobileWorkType;
  subAction?: 'dispatch' | 'receive';
  documentId: string;
  documentReference: string;
  documentVersion: number;
  warehouseId: string;
  userId: string;
  downloadedAt: string;
  claimedBy?: string;
  claimExpiresAt?: string;
  state: MobileWorkSessionState;
  /** Per-line captured progress, keyed by lineId. */
  localProgress: Record<string, MobileLineProgress>;
  /** Set once the session produces a command, linking the two. */
  commandId?: string;
  updatedAt: string;
}

/** Captured progress for one line within a session. */
export interface MobileLineProgress {
  lineId: string;
  quantity?: number;
  serialNumbers?: string[];
  lotId?: string;
  lotCode?: string;
  batchNumber?: string;
  expiryDate?: string;
}

// ---- command payloads (one per MobileCommandType) ----

export interface ReceiveCommandPayload {
  lines: Array<{ lineId: string; quantity: number; lotId?: string; batchNumber?: string; expiryDate?: string; serialNumbers?: string[] }>;
}
export interface ReleasePickCommandPayload {
  lines: Array<{ lineId: string; quantity: number; lotAllocations?: Array<{ lotId: string; quantity: number }>; serialNumbers?: string[] }>;
}
export interface TransferDispatchCommandPayload {
  lines: Array<{ itemId: string; serialNumbers?: string[] }>;
}
export interface TransferReceiveCommandPayload {
  /** Whole-transfer receive; serial identities are validated server-side against the dispatched set. */
  confirm: true;
}
export interface CountSubmitCommandPayload {
  entries: Array<{ itemId: string; countedQty?: number; observedSerials?: string[] }>;
}
export interface ReturnReceiveCommandPayload {
  lines?: Array<{ lineId: string; receivedQuantity: number }>;
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

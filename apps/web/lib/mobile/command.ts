/**
 * Pending-command journal API (2D.6A, ADR 0014 §3). Builds the frozen command envelope and persists it to
 * IndexedDB. Capturing intent is all 2D.6A does — nothing here mutates server stock. Actual sync,
 * revalidation, and conflict handling arrive in 2D.6C; the envelope shape is fixed now so 2D.6B workflows
 * can only produce compatible records.
 */

import type { MobileCommandType, PendingCommand, PendingCommandState } from '@iw/contracts';
import { COMMAND_SCHEMA_VERSION } from './constants';
import { STORES, idbCountByIndex, idbGetAll, idbPut } from './db';
import { APP_VERSION } from './device';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface CaptureCommandInput<TPayload> {
  deviceId: string;
  organizationId: string;
  warehouseId: string;
  userId: string;
  commandType: MobileCommandType;
  payload: TPayload;
  aggregateId?: string;
  expectedVersion?: number;
  /**
   * Provide a caller-owned idempotency key to make a specific business action exactly-once (e.g. deriving it
   * from the aggregate + scanned set). Omit to mint a fresh stable UUID. Either way it never changes after
   * capture — retries reuse this record's key.
   */
  idempotencyKey?: string;
}

/** Build the envelope in memory. Pure — does not persist. `state` starts at LOCAL_DRAFT. */
export function buildCommand<TPayload>(input: CaptureCommandInput<TPayload>): PendingCommand<TPayload> {
  return {
    commandId: uuid(),
    schemaVersion: COMMAND_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    deviceId: input.deviceId,
    organizationId: input.organizationId,
    warehouseId: input.warehouseId,
    userId: input.userId,
    commandType: input.commandType,
    aggregateId: input.aggregateId,
    expectedVersion: input.expectedVersion,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey ?? uuid(),
    capturedAt: new Date().toISOString(),
    state: 'LOCAL_DRAFT',
  };
}

/** Persist a command to the journal, moving it to QUEUED (ready for sync). Idempotent by commandId. */
export async function enqueueCommand<TPayload>(command: PendingCommand<TPayload>): Promise<PendingCommand<TPayload>> {
  const queued: PendingCommand<TPayload> = { ...command, state: 'QUEUED' };
  await idbPut(STORES.commands, queued);
  return queued;
}

/** Convenience: build + enqueue in one step. */
export function captureCommand<TPayload>(input: CaptureCommandInput<TPayload>): Promise<PendingCommand<TPayload>> {
  return enqueueCommand(buildCommand(input));
}

/** How many commands are still awaiting sync (QUEUED or BLOCKED) — drives the pending badge. */
export async function pendingCount(): Promise<number> {
  const [queued, blocked] = await Promise.all([
    idbCountByIndex(STORES.commands, 'by_state', 'QUEUED'),
    idbCountByIndex(STORES.commands, 'by_state', 'BLOCKED'),
  ]);
  return queued + blocked;
}

/** Count commands in a given local state (e.g. CONFLICT for the conflict badge). */
export function countByState(state: PendingCommandState): Promise<number> {
  return idbCountByIndex(STORES.commands, 'by_state', state);
}

/** All journalled commands, newest capture first — for the queue/debug surface. */
export async function listCommands(): Promise<PendingCommand[]> {
  const all = await idbGetAll<PendingCommand>(STORES.commands);
  return all.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/**
 * The one command path — online AND offline (2D.6B, ADR 0014). Every workflow builds a normalized
 * PendingCommand and hands it here; there is no second, online-only code path to drift out of sync.
 *
 *   buildCommand() -> enqueue (QUEUED, shown PENDING, never SUCCESS)
 *                  -> attempt server submit
 *                       ├─ accepted            -> receipt recorded, state SYNCED
 *                       ├─ definite rejection  -> state FAILED (needs attention)  [4xx/5xx WITH a response]
 *                       └─ no response          -> SUBMISSION_UNKNOWN: keep QUEUED, mayHaveReachedServer=true
 *
 * An HTTP timeout / dropped connection is NOT a failure: the command MAY have reached the server, so we retry
 * later with the SAME idempotencyKey and the server returns the existing receipt (exactly-once). We never mint
 * a new command for a retry.
 */

import type { MobileCommandReceipt, PendingCommand } from '@iw/contracts';
import { API_URL, getToken } from '../api';
import { STORES, idbGetAll, idbPut } from './db';
import { withSyncLock } from './sync-lock';

const SUBMIT_TIMEOUT_MS = 12000;

function envelopeToDto(c: PendingCommand) {
  return {
    commandId: c.commandId,
    idempotencyKey: c.idempotencyKey,
    deviceId: c.deviceId,
    warehouseId: c.warehouseId,
    commandType: c.commandType,
    aggregateId: c.aggregateId,
    expectedVersion: c.expectedVersion,
    schemaVersion: c.schemaVersion,
    appVersion: c.appVersion,
    payload: c.payload,
    capturedAt: c.capturedAt,
  };
}

/**
 * Attempt to submit one already-enqueued command. Persists the resulting state and returns the updated
 * command. Never throws — a transport failure becomes SUBMISSION_UNKNOWN, a definite rejection becomes FAILED.
 */
export async function submitCommand(command: PendingCommand): Promise<PendingCommand> {
  const token = getToken();
  if (!token) {
    // No session — cannot submit. Leave it queued for when the operator is authenticated again.
    return persist({ ...command, state: 'QUEUED', mayHaveReachedServer: false });
  }

  const attempts = (command.attempts ?? 0) + 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  await persist({ ...command, state: 'SYNCING', attempts });
  try {
    const res = await fetch(`${API_URL}/api/mobile/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(envelopeToDto(command)),
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (res.ok) {
      const receipt = (await res.json()) as MobileCommandReceipt;
      // The authoritative outcome comes from the receipt STATUS, never from HTTP 200 alone (ADR 0014).
      const state = receipt.status === 'APPLIED' ? 'SYNCED'
        : receipt.status === 'CONFLICT' ? 'CONFLICT'
          : receipt.status === 'REJECTED' ? 'REJECTED'
            : 'BLOCKED';
      return persist({ ...command, state, attempts, receipt, mayHaveReachedServer: false, lastError: receipt.message });
    }
    // A non-OK HTTP response (e.g. a validation 400) is a definite failure — surface for operator attention.
    let message = `Rejected (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* keep default */
    }
    return persist({ ...command, state: 'FAILED', attempts, lastError: message, mayHaveReachedServer: false });
  } catch (err) {
    clearTimeout(timer);
    // No response — an abort/timeout/network drop. The request MAY have reached the server. Keep it QUEUED and
    // flag it so a later retry reuses the same idempotencyKey (SUBMISSION_UNKNOWN, ADR 0014 §uncertain results).
    const reason = err instanceof DOMException && err.name === 'AbortError' ? 'Timed out — may have reached the server' : 'Network unavailable';
    return persist({ ...command, state: 'QUEUED', attempts, mayHaveReachedServer: true, lastError: reason });
  }
}

async function persist(command: PendingCommand): Promise<PendingCommand> {
  await idbPut(STORES.commands, command);
  return command;
}

const SUBMITTABLE = new Set(['QUEUED', 'FAILED', 'BLOCKED']);

/** A command may go to the server only if it has no dependency, or its dependency has already SYNCED. */
function dependencySatisfied(command: PendingCommand, stateById: Map<string, string>): boolean {
  if (!command.dependsOnCommandId) return true;
  return stateById.get(command.dependsOnCommandId) === 'SYNCED';
}

/**
 * Drain submittable commands under the single-owner sync lock (ADR 0014 §7) so two tabs never double-post.
 * Commands are processed sequentially in capture order, honouring dependency chains: a command whose
 * predecessor has not SYNCED stays BLOCKED and is skipped this round. Retries reuse the existing idempotency
 * key. CONFLICT/REJECTED are terminal here — they need the operator (conflict inbox), not an auto-retry.
 */
export async function syncPending(): Promise<{ owner: boolean; synced: number; conflicts: number; rejected: number; blocked: number; unknown: number; remaining: number }> {
  const { acquired, result } = await withSyncLock(async () => {
    const all = (await idbGetAll<PendingCommand>(STORES.commands)).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const stateById = new Map(all.map((c) => [c.commandId, c.state]));
    let synced = 0, conflicts = 0, rejected = 0, blocked = 0, unknown = 0;
    for (const c of all) {
      if (!SUBMITTABLE.has(c.state)) continue;
      if (!dependencySatisfied(c, stateById)) { blocked += 1; stateById.set(c.commandId, 'BLOCKED'); continue; }
      const after = await submitCommand(c);
      stateById.set(c.commandId, after.state);
      if (after.state === 'SYNCED') synced += 1;
      else if (after.state === 'CONFLICT') conflicts += 1;
      else if (after.state === 'REJECTED') rejected += 1;
      else if (after.state === 'BLOCKED') blocked += 1;
      else if (after.mayHaveReachedServer) unknown += 1;
    }
    const remaining = (await idbGetAll<PendingCommand>(STORES.commands)).filter((c) => SUBMITTABLE.has(c.state)).length;
    return { synced, conflicts, rejected, blocked, unknown, remaining };
  });
  if (!acquired || !result) return { owner: false, synced: 0, conflicts: 0, rejected: 0, blocked: 0, unknown: 0, remaining: 0 };
  return { owner: true, ...result };
}

/** All commands currently needing operator attention in the conflict inbox (CONFLICT or REJECTED). */
export async function listConflicts(): Promise<PendingCommand[]> {
  const all = await idbGetAll<PendingCommand>(STORES.commands);
  return all.filter((c) => c.state === 'CONFLICT' || c.state === 'REJECTED').sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/** Discard a local command the operator has chosen not to keep (conflict resolution DISCARD_LOCAL_COMMAND). */
export async function discardCommand(commandId: string): Promise<void> {
  const all = await idbGetAll<PendingCommand>(STORES.commands);
  const c = all.find((x) => x.commandId === commandId);
  if (c) await idbPut(STORES.commands, { ...c, state: 'CANCELLED' });
}

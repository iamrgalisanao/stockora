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
      // ACCEPTED or ALREADY_PROCESSED are both settled outcomes — the command is exactly-once on the server.
      return persist({ ...command, state: 'SYNCED', attempts, receipt, mayHaveReachedServer: false, lastError: undefined });
    }
    // A response arrived: this is a DEFINITE outcome, so no retry ambiguity. Surface for operator attention.
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

/**
 * Drain all submittable commands under the single-owner sync lock (ADR 0014 §7) so two tabs never double-post.
 * Returns a small summary for the Pending Sync UI. Commands are retried with their existing idempotencyKey.
 */
export async function syncPending(): Promise<{ owner: boolean; synced: number; failed: number; unknown: number; remaining: number }> {
  const { acquired, result } = await withSyncLock(async () => {
    const all = await idbGetAll<PendingCommand>(STORES.commands);
    const submittable = all.filter((c) => c.state === 'QUEUED' || c.state === 'FAILED');
    let synced = 0;
    let failed = 0;
    let unknown = 0;
    for (const c of submittable) {
      const after = await submitCommand(c);
      if (after.state === 'SYNCED') synced += 1;
      else if (after.state === 'FAILED') failed += 1;
      else if (after.mayHaveReachedServer) unknown += 1;
    }
    const remaining = (await idbGetAll<PendingCommand>(STORES.commands)).filter((c) => c.state === 'QUEUED' || c.state === 'FAILED').length;
    return { synced, failed, unknown, remaining };
  });
  if (!acquired || !result) return { owner: false, synced: 0, failed: 0, unknown: 0, remaining: 0 };
  return { owner: true, ...result };
}

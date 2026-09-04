/**
 * Mobile work sessions (2D.6B, ADR 0014). A session is the operator's CURRENT on-screen work — distinct from
 * a `PendingCommand`, which is the executable intent a session produces on submit. Sessions persist to
 * IndexedDB so a reload, restart, or connectivity blip restores exactly where the operator was. This
 * separation is what lets 2D.6C reconcile in-progress capture against live server state cleanly.
 */

import type { MobileLineProgress, MobileWorkItem, MobileWorkSession, MobileWorkType } from '@iw/contracts';
import { STORES, idbDelete, idbGet, idbGetAll, idbPut } from './db';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Find an ACTIVE session already open for a document (so re-opening resumes rather than duplicating). */
export async function findOpenSession(documentId: string, subAction?: 'dispatch' | 'receive'): Promise<MobileWorkSession | undefined> {
  const all = await idbGetAll<MobileWorkSession>(STORES.sessions);
  return all.find((s) => s.documentId === documentId && s.subAction === subAction && (s.state === 'ACTIVE' || s.state === 'READY_TO_SUBMIT'));
}

/** Open (or resume) a session for a work item, seeding empty per-line progress. */
export async function openSession(item: MobileWorkItem, userId: string): Promise<MobileWorkSession> {
  const existing = await findOpenSession(item.documentId, item.subAction);
  if (existing) return existing;
  const now = new Date().toISOString();
  const localProgress: Record<string, MobileLineProgress> = {};
  for (const line of item.lines) localProgress[line.lineId] = { lineId: line.lineId, serialNumbers: [] };
  const session: MobileWorkSession = {
    sessionId: uuid(),
    type: item.workType,
    subAction: item.subAction,
    documentId: item.documentId,
    documentReference: item.reference,
    documentVersion: item.version,
    warehouseId: item.warehouseId,
    userId,
    downloadedAt: now,
    claimedBy: item.claim?.claimedById,
    claimExpiresAt: item.claim?.leaseExpiresAt,
    state: 'ACTIVE',
    localProgress,
    updatedAt: now,
  };
  await idbPut(STORES.sessions, session);
  return session;
}

export async function getSession(sessionId: string): Promise<MobileWorkSession | undefined> {
  return idbGet<MobileWorkSession>(STORES.sessions, sessionId);
}

export async function saveSession(session: MobileWorkSession): Promise<MobileWorkSession> {
  const next = { ...session, updatedAt: new Date().toISOString() };
  await idbPut(STORES.sessions, next);
  return next;
}

/** Merge captured progress for one line and persist. */
export async function updateLineProgress(
  session: MobileWorkSession,
  lineId: string,
  patch: Partial<MobileLineProgress>,
): Promise<MobileWorkSession> {
  const prev = session.localProgress[lineId] ?? { lineId };
  const next: MobileWorkSession = {
    ...session,
    localProgress: { ...session.localProgress, [lineId]: { ...prev, ...patch, lineId } },
  };
  return saveSession(next);
}

export async function listSessions(type?: MobileWorkType): Promise<MobileWorkSession[]> {
  const all = await idbGetAll<MobileWorkSession>(STORES.sessions);
  const filtered = type ? all.filter((s) => s.type === type) : all;
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function abandonSession(sessionId: string): Promise<void> {
  const s = await getSession(sessionId);
  if (!s) return;
  await saveSession({ ...s, state: 'ABANDONED' });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await idbDelete(STORES.sessions, sessionId);
}

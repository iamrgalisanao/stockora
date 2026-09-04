/**
 * Device installation identity + local storage durability (2D.6A, ADR 0014 §8, §11).
 *
 * The device identity is GENERATED (a UUID), never fingerprinted. It is stored in IndexedDB and stamped on
 * every captured command as provenance. Persistent storage is REQUESTED but the journal is still designed
 * to survive eviction — local storage is never a system of record.
 */

import { STORES, idbGet, idbPut } from './db';

const DEVICE_KEY = 'deviceInstallationId';
const APP_VERSION_KEY = 'appVersion';

/** This client build. Sent with every command so the server can gate incompatible builds (ADR 0014 §14). */
export const APP_VERSION = '2.6.0';

interface MetaRecord {
  key: string;
  value: string;
  createdAt?: string;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for older engines — RFC-4122-ish, sufficient for a local device tag.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Get-or-create the stable device installation id. Idempotent; safe to call on every mobile app start. */
export async function getDeviceId(): Promise<string> {
  const existing = await idbGet<MetaRecord>(STORES.meta, DEVICE_KEY);
  if (existing?.value) return existing.value;
  const id = uuid();
  await idbPut<MetaRecord>(STORES.meta, { key: DEVICE_KEY, value: id, createdAt: new Date().toISOString() });
  // Record the build that first installed this device, for later diagnostics.
  await idbPut<MetaRecord>(STORES.meta, { key: APP_VERSION_KEY, value: APP_VERSION });
  return id;
}

export type PersistResult = 'persisted' | 'best-effort' | 'unsupported';

/**
 * Ask the browser to make our storage persistent (exempt from routine eviction). Progressive enhancement:
 * a 'best-effort' or 'unsupported' result is normal and the app must still work (ADR 0014 §11).
 */
export async function requestPersistentStorage(): Promise<PersistResult> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';
    if (await navigator.storage.persisted()) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

export interface StorageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** Rough storage headroom, for the eviction-awareness surface. */
export async function estimateStorage(): Promise<StorageEstimate> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return { usageBytes: null, quotaBytes: null };
    const e = await navigator.storage.estimate();
    return { usageBytes: e.usage ?? null, quotaBytes: e.quota ?? null };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

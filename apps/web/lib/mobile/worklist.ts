/**
 * Worklist fetch + offline cache (2D.6B, ADR 0014 §15). Online, the bounded server read model is fetched and
 * cached per workflow; offline, the last cached snapshot is served so an operator who lost connectivity after
 * download can keep working within the ADR-defined window. The cache is a derived read model — never the
 * source of truth for inventory, and never unsynced work.
 */

import type { MobileWorkItem, MobileWorkType } from '@iw/contracts';
import { api } from '../api';
import { STORES, idbGet, idbPut } from './db';

interface WorklistCacheRecord {
  cacheKey: string; // `list:${type}`
  type: MobileWorkType;
  items: MobileWorkItem[];
  cachedAt: string;
}

const key = (type: MobileWorkType) => `list:${type}`;

export interface WorklistResult {
  items: MobileWorkItem[];
  /** Whether these came from the live server (fresh) or the offline cache (stale). */
  source: 'live' | 'cache';
  cachedAt?: string;
}

/** Fetch the live worklist and refresh the cache; on any network failure, fall back to the cached snapshot. */
export async function loadWorklist(type: MobileWorkType): Promise<WorklistResult> {
  try {
    const items = await api.mobile.work(type);
    await idbPut<WorklistCacheRecord>(STORES.worklists, { cacheKey: key(type), type, items, cachedAt: new Date().toISOString() }).catch(() => {});
    return { items, source: 'live' };
  } catch {
    const cached = await idbGet<WorklistCacheRecord>(STORES.worklists, key(type)).catch(() => undefined);
    if (cached) return { items: cached.items, source: 'cache', cachedAt: cached.cachedAt };
    return { items: [], source: 'cache' };
  }
}

/** Read only the cached snapshot (no network) — used while offline. */
export async function cachedWorklist(type: MobileWorkType): Promise<WorklistResult> {
  const cached = await idbGet<WorklistCacheRecord>(STORES.worklists, key(type)).catch(() => undefined);
  return cached ? { items: cached.items, source: 'cache', cachedAt: cached.cachedAt } : { items: [], source: 'cache' };
}

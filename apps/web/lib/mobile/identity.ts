/**
 * Cached operator identity (2D.6B). Building a command needs the operator's org + user id even offline. We
 * cache the last authenticated identity in IndexedDB so a command captured offline still carries correct
 * provenance; online we refresh it (and detect a warehouse-scope / permission change, ADR 0014 §12).
 */

import type { AuthenticatedUser } from '@iw/contracts';
import { api } from '../api';
import { STORES, idbGet, idbPut } from './db';

const IDENTITY_KEY = 'operatorIdentity';

export interface OperatorIdentity {
  userId: string;
  organizationId: string;
  warehouseScope: string[] | null;
  permissions: string[];
}

interface IdentityRecord {
  key: string;
  value: OperatorIdentity;
  cachedAt: string;
}

function toIdentity(me: AuthenticatedUser): OperatorIdentity {
  return { userId: me.id, organizationId: me.organizationId, warehouseScope: me.warehouseScope, permissions: me.permissions };
}

/** Refresh identity from the server and cache it. Call on entering the mobile app while online. */
export async function refreshIdentity(): Promise<OperatorIdentity | null> {
  try {
    const me = await api.me();
    const identity = toIdentity(me);
    await idbPut<IdentityRecord>(STORES.meta, { key: IDENTITY_KEY, value: identity, cachedAt: new Date().toISOString() }).catch(() => {});
    return identity;
  } catch {
    return getCachedIdentity();
  }
}

export async function getCachedIdentity(): Promise<OperatorIdentity | null> {
  const rec = await idbGet<IdentityRecord>(STORES.meta, IDENTITY_KEY).catch(() => undefined);
  return rec?.value ?? null;
}

/** Best available identity: fresh if online, else the cached snapshot. */
export async function getIdentity(): Promise<OperatorIdentity | null> {
  return (await refreshIdentity()) ?? getCachedIdentity();
}

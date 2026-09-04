/**
 * Cached operator identity (2D.6B). Building a command needs the operator's org + user id even offline. We
 * cache the last authenticated identity in IndexedDB so a command captured offline still carries correct
 * provenance; online we refresh it (and detect a warehouse-scope / permission change, ADR 0014 §12).
 */

import type { AuthenticatedUser } from '@iw/contracts';
import { api } from '../api';
import { STORES, idbClearAll, idbGet, idbPut } from './db';
import { getDeviceId } from './device';

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
    // Device handover / user switch (ADR 0014 §13): if a DIFFERENT user is now signed in on this device, wipe
    // the prior user's local journal + sessions so their work can never leak to or be acted on by the new user.
    const cached = await getCachedIdentity();
    if (cached && cached.userId !== identity.userId) {
      const device = await getDeviceId(); // preserve the physical device identity across the wipe
      await idbClearAll().catch(() => {});
      await idbPut(STORES.meta, { key: 'deviceInstallationId', value: device, createdAt: new Date().toISOString() }).catch(() => {});
    }
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

/**
 * Wipe all local operator data on sign-out / handover (ADR 0014 §13) — journal, sessions, cached worklists,
 * conflicts, and identity — while preserving the physical device installation id. After this, no prior user's
 * captured work is reachable on the device.
 */
export async function wipeUserData(): Promise<void> {
  const device = await getDeviceId().catch(() => null);
  await idbClearAll().catch(() => {});
  if (device) await idbPut(STORES.meta, { key: 'deviceInstallationId', value: device, createdAt: new Date().toISOString() }).catch(() => {});
}

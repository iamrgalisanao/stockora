/**
 * Mobile Scanner PWA foundation (2D.6A, ADR 0014). Barrel for the device/offline building blocks: local
 * journal, device identity, proven connectivity, single-owner sync coordination, scanner adapters, wake lock,
 * command envelope, and service-worker lifecycle. Workflows (2D.6B) and the sync/conflict engine (2D.6C)
 * build on these; nothing here mutates authoritative server stock.
 */

export * from './constants';
export * from './db';
export * from './device';
export * from './connectivity';
export * from './sync-lock';
export * from './channel';
export * from './scanner';
export * from './wake-lock';
export * from './command';
export * from './sw-register';
export * from './work-session';
export * from './worklist';
export * from './submit';
export * from './identity';

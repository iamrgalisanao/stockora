/**
 * IndexedDB — the device's temporary operational journal (2D.6A, ADR 0014 §11). It is NOT inventory truth:
 * it holds captured command intent awaiting sync, cached read models for display, conflicts, and device
 * metadata. Any divergence from the server is always resolved in the server's favour.
 *
 * A tiny dependency-free wrapper with explicit, versioned migrations (ADR 0014 §14) so unsynced commands
 * survive schema upgrades. Everything here is browser-only and guarded so the module is import-safe on the
 * Next.js server.
 */

export const DB_NAME = 'iw-mobile';
/** Bump this AND add a migration step below whenever the object-store shape changes. */
export const DB_VERSION = 2;

export const STORES = {
  meta: 'meta', // device id, install/session snapshots — key: string
  commands: 'commands', // PendingCommand journal — key: commandId
  worklists: 'worklists', // cached MobileWorkItem read models (2D.6B) — key: `${workType}:${documentId}`
  conflicts: 'conflicts', // surfaced conflicts (2D.6C) — key: commandId
  sessions: 'sessions', // MobileWorkSession — the operator's in-progress work (2D.6B) — key: sessionId
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Versioned migrations. Each case falls through from the version the DB is being upgraded FROM, so a device
 * that skipped versions applies every step in order. Never drop a store that may hold unsynced commands.
 */
function migrate(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore(STORES.meta, { keyPath: 'key' });
    const commands = db.createObjectStore(STORES.commands, { keyPath: 'commandId' });
    commands.createIndex('by_state', 'state', { unique: false });
    commands.createIndex('by_idempotencyKey', 'idempotencyKey', { unique: true });
    commands.createIndex('by_aggregate', 'aggregateId', { unique: false });
    db.createObjectStore(STORES.worklists, { keyPath: 'cacheKey' });
    db.createObjectStore(STORES.conflicts, { keyPath: 'commandId' });
  }
  if (oldVersion < 2) {
    // Sessions arrived in 2D.6B. Additive — never drops the command journal, so unsynced work survives (§14).
    const sessions = db.createObjectStore(STORES.sessions, { keyPath: 'sessionId' });
    sessions.createIndex('by_document', 'documentId', { unique: false });
    sessions.createIndex('by_state', 'state', { unique: false });
    // A v1 install created `worklists` keyed by the (unused) `aggregateId`; re-key it to `cacheKey`. The
    // worklist cache is a derived read model — never unsynced work — so recreating it loses nothing.
    if (oldVersion === 1 && db.objectStoreNames.contains(STORES.worklists)) {
      db.deleteObjectStore(STORES.worklists);
      db.createObjectStore(STORES.worklists, { keyPath: 'cacheKey' });
    }
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB is not available in this context'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion);
    req.onsuccess = () => {
      // If another tab requests a newer version, close so it can upgrade (ADR 0014 §14).
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open connection'));
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
        t.onerror = () => reject(t.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      }),
  );
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbPut<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value as unknown as Record<string, unknown>) as IDBRequest<IDBValidKey>);
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<undefined> {
  return tx<undefined>(store, 'readwrite', (s) => s.delete(key) as unknown as IDBRequest<undefined>);
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

/** Count records in a store, optionally within an index range (used for the pending-command badge). */
export function idbCountByIndex(store: StoreName, index: string, value: IDBValidKey): Promise<number> {
  return openDb().then(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).index(index).count(IDBKeyRange.only(value));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB count failed'));
      }),
  );
}

/** Test/handover helper: clear the local journal (ADR 0014 §13 sign-out wipe uses this). */
export async function idbClearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(Object.values(STORES), 'readwrite');
    for (const s of Object.values(STORES)) t.objectStore(s).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('IndexedDB clear failed'));
  });
}

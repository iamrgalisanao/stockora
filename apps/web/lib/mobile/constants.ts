/**
 * Client-side mobile compatibility constants (2D.6A, ADR 0014 §14). These must move in lockstep with the
 * server's `apps/api/src/common/mobile.constants.ts`: the client stamps `schemaVersion`/`appVersion` on every
 * command, and the server refuses builds/schemas it can no longer accept.
 */

/** Envelope schema this client writes into the journal. Bump with any incompatible envelope change. */
export const COMMAND_SCHEMA_VERSION = 1;

/** Service-worker + app-shell cache generation. Bump to invalidate old shells on deploy. */
export const SHELL_CACHE_VERSION = 'v2';

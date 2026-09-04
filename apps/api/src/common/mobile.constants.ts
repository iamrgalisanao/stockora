/**
 * Mobile PWA compatibility gates (Phase 2D.6, ADR 0014 §14). The client sends its build and envelope schema
 * with every synced command; the server refuses builds/schemas it can no longer safely accept. Bump these
 * deliberately when the command envelope or its handling changes incompatibly.
 */

/** Minimum client app build the server will accept mobile commands from. */
export const MIN_APP_VERSION = '2.6.0';

/** Current mobile command-envelope schema the server understands (matches PendingCommand.schemaVersion). */
export const COMMAND_SCHEMA_VERSION = 1;

/**
 * How long a device may keep capturing work offline on one authorization snapshot before it goes read-only
 * (ADR 0014 §12, 2D.6D). 8 hours ≈ a warehouse shift; a reconnect that revalidates the session resets it.
 */
export const OFFLINE_AUTH_WINDOW_SECONDS = 8 * 60 * 60;

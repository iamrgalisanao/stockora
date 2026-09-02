# Phase 2A.4A — Sessions & Refresh Tokens (backend + UI)

**Status: ✅ Complete.** First slice of the 2A.4 release-readiness gate. Closes the outstanding
session-management gap: short-lived access tokens backed by rotating, revocable refresh-token sessions
with reuse detection.

## Backend
- **`Session` model** — one row per refresh-token session: `familyId` (rotation lineage),
  `refreshTokenHash` (SHA-256; the token itself is never stored), `expiresAt`, `revokedAt/Reason`,
  `replacedById`, plus `ip`/`userAgent`.
- **`SessionService`** owns the lifecycle:
  - **Create** on login/register (new family).
  - **Rotate** on every refresh — a fresh opaque token is minted, the predecessor is revoked and linked
    via `replacedById`.
  - **Reuse detection** — presenting an already-rotated/revoked token revokes the **entire family**
    (theft response), so a stolen token can't outlive its rotation.
  - **Revoke** (logout) and **revoke-all** (sign out everywhere).
- **Access tokens** are short-lived (`JWT_EXPIRES_IN`, default **15m**) and carry a `sid`; the
  `JwtStrategy` checks the session is live on every request, so **logout / logout-all invalidate access
  tokens immediately**, not just at expiry.
- **Endpoints:** `POST /auth/refresh` (rotate), `POST /auth/logout` (current session),
  `POST /auth/logout-all` (all sessions). `AuthTokenResponse` now returns `refreshToken` +
  `refreshExpiresIn`.
- **Config hardening:** env schema adds `REFRESH_TOKEN_TTL_DAYS` (default 30) and, in production,
  rejects a `JWT_SECRET` under 32 chars or one that looks like a placeholder.

## No CSRF surface
Tokens live in the `Authorization` header (not cookies), and the refresh token is sent in the request
body — there is no ambient credential a cross-site request could ride, so classic CSRF does not apply.

## Web UI
- Login/register store **both** tokens; `request()` transparently **refreshes on a 401 and retries
  once** (single-flight, so concurrent 401s share one rotation and never reuse a token). On refresh
  failure it clears tokens and the app returns to login.
- **Sign out** calls `POST /auth/logout` (revoking the session server-side) before clearing local
  tokens.

## Tests
- **e2e** (`sessions.e2e-spec.ts`, 6): issues an access+refresh pair; refresh **rotates** and
  invalidates the previous session immediately; **reuse** of a rotated token is rejected and burns the
  family; logout kills the current session (access + refresh); logout-all kills every session; unknown
  refresh token → 401.
- Browser-verified: silent auto-refresh on a forced 401 (token rotated, page kept), and sign-out
  revoking the refresh token server-side.
- **29 unit + 129 e2e green** (e2e bounded to 2 workers so the shared Postgres isn't saturated).

## Next
**2A.4B — API hardening**: tiered rate limiting, payload/body limits, security headers + CORS,
consistent error shape + structured logging, and health/readiness endpoints.

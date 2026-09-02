# Phase 2A.4B — API Hardening (backend)

**Status: ✅ Complete.** Second slice of the 2A.4 gate. Bounds public/API inputs, makes failures
observable and consistent, and adds the probes a real deployment needs.

## Rate limiting (tiered)
A small in-memory fixed-window limiter (single-instance; swap the store for Redis when scaling out) with
per-class budgets rather than one blind global number:

| Tier | Limit / 60s | Applied to |
|---|---|---|
| `auth` | 10 | `/auth/*` |
| `sensitive` | 30 | search, barcode resolve, import, export |
| `default` | 300 | everything else |

Scaled by `RATE_LIMIT_FACTOR`; keyed by tier + client IP; returns `429` with `Retry-After` and exposes
`X-RateLimit-Limit`/`Remaining`. The guard runs **before** auth work (cheap rejection of floods) and is
disabled under `NODE_ENV=test` so suites aren't throttled — the algorithm itself is unit-tested.

## Payload & input bounds
Request bodies are capped at **1 MB** (`express.json`/`urlencoded` limits) — oversized payloads get a
clean `413` before reaching a handler. This is on top of the existing DTO validation
(`whitelist` + `forbidNonWhitelisted`) and the import 2 MB / 5,000-row caps.

## Security headers & CORS
A middleware sets, for the whole API: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Permissions-Policy` (camera/mic/geolocation off), a locked
`Content-Security-Policy` (`default-src 'none'`), `Cross-Origin-Resource-Policy`, HSTS in production, and
removes `X-Powered-By`. CORS is a comma-separated **allowlist** from `CORS_ORIGIN`. (No CSRF surface —
auth is header-bearer, not cookies.)

## Consistent errors & structured logging
A global exception filter returns one shape for every failure —
`{ statusCode, error, message, path, timestamp, correlationId }` — ties each log line to the request's
correlation id (the same id the Audit Explorer groups by), logs 5xx at error with the stack and 4xx at
debug, and **never leaks internal detail on a 500**. It also honors status-bearing middleware errors
(e.g. body-parser's 413).

## Health & readiness
- `GET /api/health/live` — liveness, never touches the DB.
- `GET /api/health/ready` — readiness; `503` when the database is unreachable.
- `GET /api/health` — the back-compat combined check.

## Config validation
Env is fail-fast (zod). Production additionally rejects a `JWT_SECRET` under 32 chars or a
placeholder-looking secret (from 2A.4A).

## Tests
- **unit** (`rate-limit.spec.ts`, 5): allow-to-limit-then-block, remaining count, window reset, key
  isolation, prune.
- **e2e** (`hardening.e2e-spec.ts`, 4): liveness + readiness; security headers present + `X-Powered-By`
  gone; consistent error shape on a 404; oversized body → `413`.
- **Live-verified**: the `auth` tier returned `429` on the 11th rapid login; headers present on real
  responses. **34 unit + 133 e2e green.**

## Next
**2A.4C — Release engineering**: CI (lint/typecheck/test/build + dependency audit) and a
backup/recovery runbook — closing the 2A.4 gate.

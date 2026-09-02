# Phase 2A.4C — Release Engineering (CI, backup/recovery, gate)

**Status: ✅ Complete.** Final slice of 2A.4. Adds the automated checks that keep quality/security
regressions out of `main`, a verified backup/recovery path, and closes the release-readiness gate.

## CI (`.github/workflows/ci.yml`)
On every push/PR to `main`:
- **`verify` job** (with a `postgres:16` service): `npm ci` → build contracts → **lint** → **typecheck**
  → `prisma generate` + `migrate deploy` → **unit tests** → **e2e tests** → **build**. A red step blocks
  the merge.
- **`audit` job**: `npm audit --audit-level=high` surfaces known high/critical CVEs (advisory — reported,
  not a hard block on its own).

> ESLint is currently a placeholder script (the shared config is a tracked follow-up); the `lint` step
> is wired so enabling ESLint later needs no workflow change.

## Backup & recovery
- **`scripts/backup.sh`** — `pg_dump` custom-format, compressed, timestamped; **verifies the archive is
  readable** (`pg_restore --list`) before declaring success.
- **`scripts/restore.sh`** — `pg_restore --clean --single-transaction` into a target DB, with loud
  "this is destructive / verify before repointing" guardrails.
- **Verified**: a live dump of the dev database produced a 2.1 MB archive with 262 restorable objects.
  Because the ledger is append-only, a consistent logical dump fully reconstructs stock state.

## Release-readiness gate — how 2A.4's DoD is met

| DoD clause | Where |
|---|---|
| Repeatable builds | CI: `npm ci`, deterministic build/test on every PR |
| Controlled authentication/session behavior | 2A.4A: short access tokens + rotating refresh sessions, reuse detection, revoke-all |
| Bounded public/API inputs | 2A.4B: tiered rate limiting, 1 MB body cap, DTO validation, import caps |
| Observable failures | 2A.4B: one error shape + structured 5xx logging tied to correlation id; 2A.1F Audit Explorer |
| Recoverable data | 2A.4C: verified `backup.sh`/`restore.sh` over an append-only ledger |
| Automated checks preventing regressions | 2A.4C: CI (lint/typecheck/test/build) + dependency audit |
| Secret/config validation | 2A.4A/B: fail-fast env (zod), production secret-strength checks |
| Security headers / CORS | 2A.4B: header middleware + CORS allowlist |
| Health/readiness | 2A.4B: `/health/live`, `/health/ready` |

## Operational runbook (quick reference)
- **Liveness/readiness:** `GET /api/health/live` (process up), `GET /api/health/ready` (DB reachable, 503
  otherwise) — wire these to the orchestrator/load balancer.
- **Backup:** `DATABASE_URL=… scripts/backup.sh backups/` on a schedule; copy the dump offsite.
- **Restore drill:** periodically `scripts/restore.sh` a recent dump into a scratch DB and run the smoke
  check (health/ready → login → a balance query).
- **Env before deploy:** set a strong `JWT_SECRET` (≥32 chars in prod — enforced), `DATABASE_URL`,
  `CORS_ORIGIN` allowlist, and tune `REFRESH_TOKEN_TTL_DAYS` / `RATE_LIMIT_FACTOR` as needed.

---
**2A.4 Hardening complete → Phase 2A Operational Readiness is complete.** Next: **2B.1 Reservations**
(then Returns).

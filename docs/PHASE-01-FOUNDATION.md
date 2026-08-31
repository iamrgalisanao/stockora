# Phase 01 — Foundation / Auth / Organization

**Status: ✅ Complete and verified.** Maps to Roadmap step 01 (and lays the RBAC groundwork for
step 02) in [PHASE-0-ARCHITECTURE.md](PHASE-0-ARCHITECTURE.md).

## Objective

Stand up the monorepo, database, and the identity/tenancy/RBAC substrate that every later phase
builds on: register an organization with its first Administrator, authenticate, and enforce
tenant isolation + permission checks — all audited.

## What was built

### Monorepo (npm workspaces + Turborepo)
```
apps/api            NestJS API (the Inventory Control Engine backend)
apps/web            Next.js 14 web client (login + dashboard shell)
packages/contracts  Shared, stable types: permission codes, role bundles, auth DTOs
docker-compose.yml  PostgreSQL 16 (host port 5544 -> container 5432)
turbo.json          build / dev / lint / typecheck / test orchestration
```
> **Note:** the Phase 0 spec recommended pnpm; this machine could not install pnpm without admin
> rights (Corepack EPERM on `C:\Program Files\nodejs`), so we use **npm workspaces**. The monorepo
> structure is identical. Switching to pnpm later is a lockfile change, not a code change.

### Database (Prisma + PostgreSQL)
Foundation entities from Phase 0 §4: `organizations`, `users`, `memberships`, `roles`,
`permissions`, `role_permissions`, `audit_logs`. Migration: `prisma/migrations/*_init_foundation`.

- **Tenancy:** users are global identities; access to an org is a `Membership` (role + optional
  `warehouseScope`). `warehouseScope = []` means *all* warehouses; non-empty restricts.
- **RBAC:** 20 permission codes and 9 system roles are defined once in `@iw/contracts` and seeded
  per organization. The permission catalog is a global upserted table.

### API (NestJS)
- **Auth:** `POST /api/auth/register` (creates org + Administrator atomically in one transaction),
  `POST /api/auth/login` (bcrypt, enumeration-resistant), `GET /api/auth/me`. JWT bearer tokens.
- **Guards (deny-by-default, global):** `JwtAuthGuard` (authenticate; `@Public()` opts out) →
  `PermissionsGuard` (`@RequirePermissions(...)`).
- **Organizations:** `GET /api/organizations/current`, `PATCH /api/organizations/current`
  (requires `settings.manage`) — both tenant-scoped by the JWT.
- **Audit:** `AuditService` records `organization.registered`, `auth.login` (append-only, never throws).
- **Health:** `GET /api/health` (public, checks DB).
- **Config:** environment validated with zod at boot; the app refuses to start on invalid config.

### Web (Next.js)
Login/register form and a dashboard shell that calls `/me` + `/organizations/current` and renders
the user, org, and effective permissions. Token stored client-side (localStorage) — a refresh-token
/ httpOnly-cookie session is a Phase 2 hardening item.

## How to run

```bash
# 1. install (root)
npm install

# 2. start Postgres
npm run db:up

# 3. generate client + apply migration + seed demo org
npm run prisma:generate -w @iw/api
npm run api:migrate           # prisma migrate dev
npm run api:seed              # demo org: admin@demo.test / password123

# 4. run everything (turbo: builds contracts, then api + web in watch)
npm run dev
#   API -> http://localhost:4100/api    Web -> http://localhost:3000
```
Ports **5544** (Postgres) and **4100** (API) were chosen because 5432/5433/4000 are occupied by
other projects on this machine. Change them in `apps/api/.env` and `docker-compose.yml` if needed.

## Tests

```bash
npm run test -w @iw/api           # unit: RBAC bundles + PermissionsGuard (9 tests)
npm run test:e2e -w @iw/api       # e2e vs live Postgres: auth + org flow (8 tests)
```

**Verified results:** unit 9/9 ✅, e2e 8/8 ✅, api build ✅, web build ✅, turbo typecheck 4/4 ✅.
Live smoke test confirmed: health `db:ok`, JWT login, `/me` with 20 admin permissions
(`warehouseScope: null`), 401 unauthenticated, RBAC-gated org PATCH → 200.

## Acceptance criteria (met)

- [x] Monorepo builds and typechecks across all workspaces.
- [x] Postgres runs via Docker; Prisma migration applies cleanly.
- [x] Register creates org + Administrator atomically; duplicate email → 409.
- [x] Login issues a JWT; wrong password → 401.
- [x] Protected routes reject missing/invalid tokens (401).
- [x] `@RequirePermissions` enforces capability codes (403 when missing).
- [x] Tenant isolation: every query is scoped by `organizationId` from the token.
- [x] Auth events are written to the append-only audit log.

## Edge cases handled

- Unique org slug derivation with collision suffixing.
- Login enumeration resistance (constant-ish bcrypt work when the user doesn't exist).
- Multi-org accounts: login requires `organizationId` when a user has >1 membership.
- Revoked access: `loadPrincipal` rejects if membership/user/org is not ACTIVE (checked every request).

## Follow-ups (deliberately deferred)

- **ESLint** flat config across workspaces (`lint` scripts are placeholders today).
- **Refresh tokens / httpOnly cookie** session instead of localStorage bearer.
- **Rate limiting** on auth endpoints; **user management** endpoints (invite, assign role, set
  warehouse scope) — the first half of Roadmap step 02.
- Prisma 6 → 7/8 upgrade evaluation; move `package.json#prisma` to `prisma.config.ts`.

## Next phase

**Roadmap step 02 (finish) + 03:** user management & warehouse-scoped permissions, then the Product
Master. Then the critical path — **step 07 Inventory Ledger** and **step 08 Balance engine** — which
must exist before any operational document (receiving, transfers, etc.).

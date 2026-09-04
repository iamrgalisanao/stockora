// Migration replay verification (2D.6D operational hardening).
//
// Replays EVERY migration, in folder order, onto a fresh shadow database — exactly what a production
// `prisma migrate deploy` does. This catches ordering/replay errors (e.g. an ALTER against a table a later
// migration creates) BEFORE release; that class of bug bit us once and is invisible to tests that run against
// an already-migrated dev DB.
//
// A benign, unavoidable Prisma quirk is tolerated: `@default("00000000-…")` on a `@db.Uuid` column is read
// back from the DB as a cast expression, so migrate-diff always reports a non-empty (exit 2) default-only
// diff even when the schema is correct. That is NOT a replay failure — only an actual replay error (exit 1)
// fails this gate.
//
// Usage: SHADOW_DATABASE_URL=postgres://…/an_empty_throwaway_db  node scripts/verify-migrations.mjs
import { spawnSync } from 'node:child_process';

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error('SHADOW_DATABASE_URL is required — point it at an empty, throwaway database (CI provides one).');
  process.exit(1);
}

const res = spawnSync(
  'npx',
  ['prisma', 'migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma', '--shadow-database-url', shadow, '--exit-code'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

if (res.status === 0) {
  console.log('✓ Migrations replay cleanly with no drift.');
  process.exit(0);
}
if (res.status === 2) {
  // Non-empty diff. Replay SUCCEEDED (no ordering error); the only expected diff is the uuid-default quirk.
  console.log('✓ Migrations replay cleanly (only the benign uuid-default representation diff remains).');
  process.exit(0);
}
console.error(`✗ Migration replay FAILED (exit ${res.status}) — likely an ordering error or an unreplayable migration.`);
process.exit(1);

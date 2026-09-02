#!/usr/bin/env bash
# Restore an InventoryWarehouse dump produced by backup.sh into a target database.
# Usage: DATABASE_URL=postgres://user:pass@host:port/db ./scripts/restore.sh <dumpfile>
#
# DESTRUCTIVE: --clean drops existing objects first. Restore into a fresh/standby DB and verify
# before repointing the app. Never run against production without an explicit, confirmed decision.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL (target connection string)}"
FILE="${1:?Usage: restore.sh <dumpfile>}"
[ -f "$FILE" ] || { echo "No such dump: $FILE" >&2; exit 1; }

echo "→ Verifying archive"
pg_restore --list "$FILE" >/dev/null

echo "→ Restoring $FILE into target database"
echo "  (this drops and recreates objects — Ctrl-C now if the target is wrong)"
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
  --dbname="$DATABASE_URL" "$FILE"

echo "✓ Restore complete. Run a smoke check (GET /api/health/ready, a login, a balance query)"
echo "  before directing live traffic at this database."

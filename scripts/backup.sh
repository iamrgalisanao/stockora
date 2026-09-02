#!/usr/bin/env bash
# Point-in-time-ish logical backup of the InventoryWarehouse database.
# Usage: DATABASE_URL=postgres://user:pass@host:port/db ./scripts/backup.sh [outdir]
#
# Produces a compressed custom-format dump (pg_restore-friendly) named with a UTC timestamp.
# The append-only ledger means a consistent logical dump fully reconstructs stock state.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL (postgres connection string)}"
OUTDIR="${1:-backups}"
mkdir -p "$OUTDIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUTDIR/iw-${STAMP}.dump"

echo "→ Dumping to $FILE"
pg_dump --format=custom --no-owner --no-privileges --compress=9 --file="$FILE" "$DATABASE_URL"

# Integrity check: a backup you can't list is not a backup.
echo "→ Verifying archive is readable"
pg_restore --list "$FILE" >/dev/null

BYTES=$(wc -c < "$FILE")
echo "✓ Backup complete: $FILE (${BYTES} bytes)"
echo "  Retention/offsite copy is the operator's responsibility (e.g. push to object storage)."

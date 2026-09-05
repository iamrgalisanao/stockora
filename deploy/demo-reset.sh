#!/usr/bin/env bash
# Nightly reset for the PUBLIC DEMO deployment only.
#
# Drops and recreates the database (all migrations reapplied), then runs the
# seed script automatically — restoring the exact set of per-role demo logins
# (see apps/api/prisma/seed.ts) and discarding whatever visitors did during
# the day. Safe to run daily: it is a hard requirement, not an optimisation,
# that this NEVER runs against a real customer's data — see the DEMO_MODE
# guard below.
#
# Usage (from anywhere): /opt/stockora/deploy/demo-reset.sh
# Cron (as root), nightly at 02:00 server time:
#   0 2 * * * /opt/stockora/deploy/demo-reset.sh >> /var/log/stockora-demo-reset.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.prod"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"

echo "[$(date -Is)] demo-reset: starting"

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -Is)] demo-reset: ABORT — $ENV_FILE not found" >&2
  exit 1
fi

# Hard safety check: only ever run this against a deployment explicitly marked
# as the public demo. A missing or false DEMO_MODE aborts loudly rather than
# silently wiping data that might matter.
if ! grep -Eq '^DEMO_MODE=true$' "$ENV_FILE"; then
  echo "[$(date -Is)] demo-reset: ABORT — DEMO_MODE is not 'true' in $ENV_FILE. Refusing to wipe data." >&2
  exit 1
fi

echo "[$(date -Is)] demo-reset: DEMO_MODE confirmed — resetting database"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -w /app/apps/api api \
  npx prisma migrate reset --force --skip-generate

echo "[$(date -Is)] demo-reset: done"

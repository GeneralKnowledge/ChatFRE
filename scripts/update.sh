#!/usr/bin/env bash
# Pull latest images and recreate the stack with downtime kept short.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-auto}" # auto | local | server

compose_cmd() {
  if [[ "$MODE" == "server" ]] || {
    [[ "$MODE" == "auto" ]] && docker compose ps --services 2>/dev/null | grep -qx caddy
  }; then
    docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server "$@"
  else
    docker compose "$@"
  fi
}

if [[ "$MODE" == "auto" ]] && compose_cmd ps --services 2>/dev/null | grep -qx caddy; then
  echo "Detected server profile (caddy running)."
  MODE=server
elif [[ "$MODE" == "auto" ]]; then
  MODE=local
fi

echo "Updating ChatFRE (${MODE})…"
compose_cmd pull
compose_cmd up -d --remove-orphans
compose_cmd ps
echo
echo "Done. Tip: run ./scripts/backup.sh before risky upgrades."

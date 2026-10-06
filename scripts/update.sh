#!/usr/bin/env bash
# Pull latest images and recreate the stack with downtime kept short.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-auto}" # auto | local | cloudflare | server

detect_mode() {
  local services
  services="$(docker compose ps --services 2>/dev/null || true)"
  if echo "$services" | grep -qx caddy; then
    echo server
  elif [[ -f .env ]] && grep -qE '^OPEN_WEBUI_PORT=8080$' .env && grep -qE '^WEBUI_AUTH=false$' .env; then
    echo cloudflare
  else
    echo local
  fi
}

compose_cmd() {
  case "$MODE" in
    server)
      docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server "$@"
      ;;
    cloudflare)
      docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml "$@"
      ;;
    *)
      docker compose "$@"
      ;;
  esac
}

if [[ "$MODE" == "auto" ]]; then
  MODE="$(detect_mode)"
  echo "Detected mode: ${MODE}"
fi

echo "Updating ChatFRE (${MODE})…"
compose_cmd pull
compose_cmd up -d --remove-orphans
compose_cmd ps
echo
echo "Done. Tip: run ./scripts/backup.sh before risky upgrades."

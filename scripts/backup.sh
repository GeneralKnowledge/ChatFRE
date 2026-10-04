#!/usr/bin/env bash
# Backup ChatFRE Docker volumes (Open WebUI chats + FreeLLMAPI data + Caddy certs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
ARCHIVE="${OUT_DIR}/chatfre-${STAMP}.tar.gz"
mkdir -p "$OUT_DIR"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')}"

# Volume logical names from compose (works with or without server override).
mapfile -t VOLUMES < <(
  docker compose -f docker-compose.yml config --volumes 2>/dev/null
)

if [[ ${#VOLUMES[@]} -eq 0 ]]; then
  echo "ERROR: no compose volumes found. Is Docker running?" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Backing up volumes for project '${COMPOSE_PROJECT_NAME}'…"
backed_up=0
for vol in "${VOLUMES[@]}"; do
  full="${COMPOSE_PROJECT_NAME}_${vol}"
  if ! docker volume inspect "$full" >/dev/null 2>&1; then
    echo "  skip missing volume: $full"
    continue
  fi
  echo "  $full"
  mkdir -p "${TMP}/${vol}"
  docker run --rm \
    -v "${full}:/from:ro" \
    -v "${TMP}/${vol}:/to" \
    alpine:3.20 \
    sh -c "cd /from && tar cf - . | tar xf - -C /to"
  backed_up=$((backed_up + 1))
done

if [[ "$backed_up" -eq 0 ]]; then
  echo "ERROR: no volumes were backed up. Check COMPOSE_PROJECT_NAME (currently '${COMPOSE_PROJECT_NAME}')." >&2
  echo "Hint: docker volume ls | grep -E 'freellmapi|open-webui|caddy'" >&2
  exit 1
fi

tar -czf "$ARCHIVE" -C "$TMP" .
echo "Wrote ${ARCHIVE}"
ls -lh "$ARCHIVE"

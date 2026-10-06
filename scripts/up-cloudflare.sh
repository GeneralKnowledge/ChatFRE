#!/usr/bin/env bash
# Personal Cloudflare mode: no auth, Open WebUI on :8080.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

ensure_hex_secret() {
  local key="$1"
  if ! grep -qE "^${key}=[0-9a-fA-F]{64}$" .env; then
    local val
    val="$(openssl rand -hex 32)"
    if grep -qE "^${key}=" .env; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s/^${key}=.*/${key}=${val}/" .env
      else
        sed -i "s/^${key}=.*/${key}=${val}/" .env
      fi
    else
      printf '\n%s=%s\n' "$key" "$val" >> .env
    fi
    echo "Generated ${key}"
  fi
}

ensure_hex_secret ENCRYPTION_KEY

# Force Cloudflare-oriented defaults into .env if unset / commented placeholders.
set_default() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" .env; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s/^${key}=.*/${key}=${val}/" .env
    else
      sed -i "s/^${key}=.*/${key}=${val}/" .env
    fi
  else
    printf '\n%s=%s\n' "$key" "$val" >> .env
  fi
}

set_default WEBUI_AUTH false
set_default ENABLE_SIGNUP false
set_default OPEN_WEBUI_PORT 8080
set_default OPEN_WEBUI_BIND 0.0.0.0
set_default DEFAULT_MODELS auto

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "${FREELLMAPI_API_KEY:-}" ]]; then
  echo "NOTE: FREELLMAPI_API_KEY is empty — chat will not work until you set it."
fi

echo "Starting Cloudflare personal stack (no auth, port ${OPEN_WEBUI_PORT:-8080})…"
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d

echo
echo "Open WebUI origin:    http://YOUR_SERVER_IP:${OPEN_WEBUI_PORT:-8080}"
echo "Point Cloudflare at that origin (tunnel preferred, or proxied DNS → :8080)."
echo
echo "FreeLLMAPI (private): ssh -L 3001:127.0.0.1:3001 user@your-server"
echo "                      then http://127.0.0.1:3001 → Keys"
echo
echo "After copying the unified key into FREELLMAPI_API_KEY:"
echo "  docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d open-webui"
echo
echo "Security: auth is off. Anyone who can reach :8080 can use the chat."
echo "Prefer Cloudflare Tunnel and/or Cloudflare Access if the URL is public."

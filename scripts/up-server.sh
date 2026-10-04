#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit DOMAIN / CADDY_EMAIL before continuing."
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
ensure_hex_secret WEBUI_SECRET_KEY

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "${DOMAIN:-}" || "${DOMAIN}" == "chat.example.com" ]]; then
  echo "ERROR: Set DOMAIN in .env to your real hostname (DNS A/AAAA → this server)." >&2
  exit 1
fi

if [[ -z "${FREELLMAPI_API_KEY:-}" ]]; then
  echo "NOTE: FREELLMAPI_API_KEY is empty."
  echo "      Start the stack, configure FreeLLMAPI over SSH tunnel, then re-run."
fi

echo "Starting personal-server stack (auth + Caddy) for ${DOMAIN}…"
docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server up -d

echo
echo "Open WebUI (public):  https://${DOMAIN}"
echo "FreeLLMAPI (private): ssh -L 3001:127.0.0.1:3001 user@your-server"
echo "                      then http://127.0.0.1:3001"
echo
echo "First login:"
echo "  1. Ensure ENABLE_SIGNUP=true for the first boot (default in .env.example)"
echo "  2. Create your admin account at https://${DOMAIN}"
echo "  3. Set ENABLE_SIGNUP=false in .env and run this script again"
echo
echo "Wire models:"
echo "  1. Tunnel FreeLLMAPI, add provider keys, copy unified freellmapi-… key"
echo "  2. Set FREELLMAPI_API_KEY in .env"
echo "  3. docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server up -d open-webui"

#!/usr/bin/env bash
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

docker compose up -d
echo
echo "FreeLLMAPI (localhost): http://127.0.0.1:3001"
echo "Open WebUI (localhost): http://127.0.0.1:3000"
echo
echo "Next: open FreeLLMAPI → Keys, add provider keys, put unified key in"
echo "FREELLMAPI_API_KEY, then: docker compose up -d open-webui"
echo
echo "Remote access via SSH tunnel:"
echo "  ssh -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 user@your-server"

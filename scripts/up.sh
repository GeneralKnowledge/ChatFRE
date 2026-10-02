#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if ! grep -qE '^ENCRYPTION_KEY=[0-9a-fA-F]{64}$' .env; then
  KEY="$(openssl rand -hex 32)"
  if grep -qE '^ENCRYPTION_KEY=' .env; then
    # replace empty or placeholder value
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${KEY}/" .env
    else
      sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${KEY}/" .env
    fi
  else
    printf '\nENCRYPTION_KEY=%s\n' "$KEY" >> .env
  fi
  echo "Generated ENCRYPTION_KEY"
fi

docker compose up -d
echo
echo "FreeLLMAPI dashboard: http://127.0.0.1:3001"
echo "Open WebUI:           http://127.0.0.1:3000"
echo
echo "Next: open FreeLLMAPI → Keys, add provider keys, copy the unified key into"
echo "FREELLMAPI_API_KEY in .env, then run: docker compose up -d open-webui"

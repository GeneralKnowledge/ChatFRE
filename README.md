# ChatFRE

Thin self-host stack: **[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)** (LLM gateway) + **[Open WebUI](https://github.com/open-webui/open-webui)** (chat frontend).

```
Browser → Open WebUI (:3000) → FreeLLMAPI (:3001/v1) → free-tier providers
                 ↘ FreeLLMAPI dashboard (:3001) for keys & routing
```

ChatFRE no longer ships a custom chat UI. Provider routing, failover, and quotas live in FreeLLMAPI; the ChatGPT-like interface is Open WebUI.

## Quick start

### 1. Configure

```bash
cp .env.example .env
# Generate a stable encryption key for FreeLLMAPI's key vault:
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
# Or edit .env and set ENCRYPTION_KEY=... yourself
```

### 2. Start the stack

```bash
docker compose up -d
```

| Service | URL | Purpose |
| --- | --- | --- |
| Open WebUI | http://127.0.0.1:3000 | Chat |
| FreeLLMAPI | http://127.0.0.1:3001 | Provider keys, fallback chain, unified API key |

### 3. Wire FreeLLMAPI → Open WebUI

1. Open **http://127.0.0.1:3001** → **Keys**
2. Add at least one upstream provider key (Groq, OpenRouter, Gemini, …)
3. Copy the unified `freellmapi-…` key from the Keys page header
4. Put it in `.env`:

   ```bash
   FREELLMAPI_API_KEY=freellmapi-…
   ```

5. Recreate Open WebUI so it picks up the key:

   ```bash
   docker compose up -d open-webui
   ```

6. Open **http://127.0.0.1:3000** and chat. Models come from FreeLLMAPI (`auto`, `auto:fast`, concrete ids, …).

**Alternative:** in Open WebUI admin → connections, add an OpenAI-compatible endpoint:

- URL: `http://freellmapi:3001/v1` (from inside Docker) or `http://127.0.0.1:3001/v1` (if configuring from a browser-only flow that reaches the host)
- Key: your unified FreeLLMAPI key

## Common commands

```bash
docker compose up -d          # start
docker compose logs -f        # logs
docker compose ps             # status
docker compose down           # stop (keeps volumes)
docker compose down -v        # stop and wipe data volumes
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Yes | 64-char hex for FreeLLMAPI key encryption (`openssl rand -hex 32`) |
| `FREELLMAPI_API_KEY` | For chat | Unified key from FreeLLMAPI Keys page |
| `WEBUI_AUTH` | No | Default `false` (personal). Set `true` for login |
| `WEBUI_SECRET_KEY` | If auth on | Session secret |
| `OPEN_WEBUI_PORT` | No | Host port for Open WebUI (default `3000`) |
| `FREELLMAPI_PORT` | No | Host port for FreeLLMAPI (default `3001`) |
| `HOST_BIND` | No | Default `127.0.0.1`. Use `0.0.0.0` only on a trusted LAN |

Keep `ENCRYPTION_KEY` and the FreeLLMAPI volume stable when upgrading, or encrypted provider keys cannot be decrypted.

## Model routing

FreeLLMAPI accepts OpenAI-style `model` values:

- `auto` — your dashboard fallback chain
- `auto:smart` / `auto:fast` / `auto:reliable` / `auto:balanced` — ranking strategies
- Any concrete model id from `GET /v1/models`

Open WebUI lists whatever FreeLLMAPI exposes.

## Security notes

- Ports bind to **localhost** by default. FreeLLMAPI is single-user; do not expose it to the internet.
- Provider API keys stay inside FreeLLMAPI (encrypted at rest). Open WebUI only stores the unified gateway key.
- For multi-user, set `WEBUI_AUTH=true` and a strong `WEBUI_SECRET_KEY`.

## License

MIT. Upstream projects keep their own licenses (FreeLLMAPI, Open WebUI).

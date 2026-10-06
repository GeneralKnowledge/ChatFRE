# ChatFRE

Thin self-host stack: **[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)** (LLM gateway) + **[Open WebUI](https://github.com/open-webui/open-webui)** (chat UI).

```
Browser → Cloudflare → Open WebUI (:8080) → FreeLLMAPI (/v1) → free providers
FreeLLMAPI dashboard stays on localhost (SSH tunnel)
```

## Modes

| Mode | Command | Access |
| --- | --- | --- |
| **Cloudflare (personal)** | `./scripts/up-cloudflare.sh` | Origin `:8080`, no login |
| Local / SSH tunnel | `./scripts/up.sh` | `127.0.0.1:3000` + `:3001` |
| Caddy + login | `./scripts/up-server.sh` | `https://$DOMAIN` |

---

## Personal server with Cloudflare (no signup)

No accounts. Open WebUI listens on **port 8080** for Cloudflare (tunnel or proxied origin). FreeLLMAPI stays private on localhost.

### 1. Requirements

- Docker + Compose on the server
- Cloudflare in front (Tunnel recommended, or DNS proxy to `:8080`)
- Outbound HTTPS for LLM providers

### 2. Clone and configure

```bash
git clone -b cursor/open-webui-compose-135a https://github.com/GeneralKnowledge/ChatFRE.git
cd ChatFRE
cp .env.example .env
```

`.env` defaults for this mode (also set by the script):

```bash
WEBUI_AUTH=false
ENABLE_SIGNUP=false
OPEN_WEBUI_PORT=8080
OPEN_WEBUI_BIND=0.0.0.0
# FREELLMAPI_API_KEY=   # fill in step 5
```

If you use **Cloudflare Tunnel** only (cloudflared on the same box), prefer:

```bash
OPEN_WEBUI_BIND=127.0.0.1
```

### 3. Start

```bash
./scripts/up-cloudflare.sh
```

### 4. Point Cloudflare at port 8080

**Tunnel (preferred):** create a tunnel whose service URL is `http://127.0.0.1:8080` (with `OPEN_WEBUI_BIND=127.0.0.1`).

**Proxied DNS:** orange-cloud the hostname to your server and set the origin port to **8080** (or a Cloudflare Load Balancer / origin rule to `:8080`).

Optional but recommended when auth is off: put **Cloudflare Access** in front of the hostname so only you can open it.

### 5. Add provider keys (private)

```bash
ssh -L 3001:127.0.0.1:3001 user@your-server
# browser: http://127.0.0.1:3001 → Keys
```

Add 2–3 free keys (Groq + OpenRouter + Gemini/Cloudflare AI), copy the unified `freellmapi-…` key into `.env`:

```bash
FREELLMAPI_API_KEY=freellmapi-…
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d open-webui
```

### 6. Chat

Open your Cloudflare hostname. Model **`auto`**. No signup screen.

---

## Security note

With `WEBUI_AUTH=false`, anyone who can reach Open WebUI can use your free-tier quota. Prefer Cloudflare Tunnel and/or Access. Never publish FreeLLMAPI (`:3001`).

---

## Backup & update

```bash
./scripts/backup.sh
./scripts/update.sh              # auto-detects mode
./scripts/update.sh cloudflare   # force Cloudflare compose files
```

---

## Configuration reference

| Variable | Description |
| --- | --- |
| `ENCRYPTION_KEY` | FreeLLMAPI key vault (required; `openssl rand -hex 32`) |
| `FREELLMAPI_API_KEY` | Unified gateway key |
| `OPEN_WEBUI_PORT` | Host port (Cloudflare mode: `8080`) |
| `OPEN_WEBUI_BIND` | `0.0.0.0` for public origin, `127.0.0.1` for tunnel-only |
| `WEBUI_AUTH` | `false` = no login |
| `ENABLE_SIGNUP` | Ignored when auth is off; keep `false` |
| `DEFAULT_MODELS` | Default `auto` |
| `OPEN_WEBUI_MEMORY_LIMIT` | Default `2g` |

## License

MIT. Upstream projects keep their own licenses.

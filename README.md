# ChatFRE

Thin self-host stack: **[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)** (LLM gateway) + **[Open WebUI](https://github.com/open-webui/open-webui)** (chat frontend), with an optional **Caddy** HTTPS front door for personal servers.

```
Browser → Open WebUI → FreeLLMAPI (/v1) → free-tier providers
              ↗ optional Caddy (:443)
FreeLLMAPI dashboard stays on localhost (SSH tunnel)
```

## Modes

| Mode | Command | Access |
| --- | --- | --- |
| Local / SSH tunnel | `./scripts/up.sh` | `127.0.0.1:3000` + `:3001` |
| Personal server | `./scripts/up-server.sh` | `https://your.domain` (Caddy) + FreeLLMAPI via SSH |

---

## Local / SSH-tunnel quick start

```bash
cp .env.example .env
./scripts/up.sh
```

| Service | URL |
| --- | --- |
| Open WebUI | http://127.0.0.1:3000 |
| FreeLLMAPI | http://127.0.0.1:3001 |

Wire the gateway key:

1. Open FreeLLMAPI → **Keys** → add provider keys → copy unified `freellmapi-…` key  
2. Set `FREELLMAPI_API_KEY` in `.env`  
3. `docker compose up -d open-webui`

From your laptop to a remote host that only binds localhost:

```bash
ssh -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 user@your-server
```

---

## Personal server (recommended for a VPS)

Exposes **only Open WebUI** on ports 80/443 with Let's Encrypt. FreeLLMAPI remains on `127.0.0.1` so provider keys are not on the public internet.

### Requirements

- Docker + Docker Compose plugin
- A DNS **A/AAAA** record for your domain pointing at the server
- Inbound **80/443** open (for ACME + HTTPS)
- Outbound HTTPS (providers + Let's Encrypt)

### Setup

```bash
cp .env.example .env
```

Edit `.env`:

```bash
ENCRYPTION_KEY=          # openssl rand -hex 32  (or let the script generate it)
DOMAIN=chat.example.com
CADDY_EMAIL=you@example.com
WEBUI_SECRET_KEY=        # openssl rand -hex 32  (or let the script generate it)
ENABLE_SIGNUP=true       # first boot only
FREELLMAPI_API_KEY=      # add after FreeLLMAPI setup
```

```bash
./scripts/up-server.sh
```

Equivalent compose invocation:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server up -d
```

### First login

1. Open `https://your.domain` and create the admin account (`ENABLE_SIGNUP=true`)
2. Set `ENABLE_SIGNUP=false` in `.env` and re-run `./scripts/up-server.sh`
3. Configure FreeLLMAPI over SSH (not public):

   ```bash
   ssh -L 3001:127.0.0.1:3001 user@your-server
   # http://127.0.0.1:3001 → Keys → providers + unified key
   ```

4. Put `FREELLMAPI_API_KEY=freellmapi-…` in `.env` and recreate Open WebUI:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server up -d open-webui
   ```

### What is public vs private

| Surface | Public? |
| --- | --- |
| Open WebUI via Caddy `:443` | Yes (login required) |
| Open WebUI host port `:3000` | Localhost only |
| FreeLLMAPI `:3001` | Localhost only — use SSH tunnel |

Do **not** set FreeLLMAPI to `0.0.0.0` or put it behind the public reverse proxy without additional auth. It is a single-user key vault.

---

## Common commands

```bash
# Local
docker compose up -d
docker compose logs -f
docker compose down

# Server
docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server up -d
docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server logs -f caddy open-webui
docker compose -f docker-compose.yml -f docker-compose.server.yml --profile server down
```

## Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Yes | 64-char hex for FreeLLMAPI key encryption |
| `FREELLMAPI_API_KEY` | For chat | Unified key from FreeLLMAPI Keys page |
| `DOMAIN` | Server | Public hostname for Caddy / Let's Encrypt |
| `CADDY_EMAIL` | Server (recommended) | ACME contact email |
| `WEBUI_SECRET_KEY` | Server | Open WebUI session secret |
| `WEBUI_AUTH` | No | Default `false` locally; forced `true` in server override |
| `ENABLE_SIGNUP` | Server | `true` for first account, then `false` |
| `OPEN_WEBUI_PORT` | No | Localhost port for Open WebUI (default `3000`) |
| `FREELLMAPI_PORT` | No | Localhost port for FreeLLMAPI (default `3001`) |

Keep `ENCRYPTION_KEY` and the FreeLLMAPI volume stable when upgrading, or encrypted provider keys cannot be decrypted.

## Model routing

FreeLLMAPI accepts OpenAI-style `model` values:

- `auto` — dashboard fallback chain
- `auto:smart` / `auto:fast` / `auto:reliable` / `auto:balanced`
- Concrete model ids from `GET /v1/models`

## License

MIT. Upstream projects keep their own licenses (FreeLLMAPI, Open WebUI, Caddy).

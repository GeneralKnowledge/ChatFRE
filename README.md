# FreeLLM Chat

Self-hostable ChatGPT-like web app. **ChatFRE** owns the UI, conversation history, and GitHub export. **[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)** owns free-tier LLM routing, failover, and rate-limit tracking behind one OpenAI-compatible `/v1` endpoint.

## Architecture

```
Web UI → Chat API → Conversation Service → FreeLLMAPI (/v1/chat/completions)
                                      ↘ GitHub Service
```

Provider keys never live in ChatFRE. Add them in the FreeLLMAPI dashboard; ChatFRE only stores the unified `freellmapi-…` key server-side.

## Quick start

### 1. Start FreeLLMAPI

```bash
# Generate a stable encryption key for FreeLLMAPI's key vault
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
docker compose up -d
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001), add provider keys on **Keys**, then copy the unified API key from the Keys page header.

### 2. Start ChatFRE

```bash
pnpm install
cp .env.example .env.local
# Set:
#   FREELLMAPI_BASE_URL=http://127.0.0.1:3001/v1
#   FREELLMAPI_API_KEY=freellmapi-…
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- Next.js (App Router) + React + TypeScript + Tailwind
- SQLite via libSQL + Drizzle ORM (conversations only)
- FreeLLMAPI as the LLM gateway
- Zod validation, Vitest unit tests, Playwright ready
- pnpm

## Model selection

- **Route** (stored as `providerPreference`): FreeLLMAPI strategies such as `auto`, `auto:smart`, `auto:fast`, `auto:reliable`, `auto:balanced`
- **Model**: `auto` (use the route strategy) or a concrete model id from `GET /v1/models`
- Responses record FreeLLMAPI's `X-Routed-Via` header (which upstream provider served the turn)

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local development |
| `pnpm build` / `pnpm start` | Production build |
| `pnpm test` | Unit tests |
| `pnpm lint` | ESLint |
| `docker compose up -d` | Start FreeLLMAPI |

## GitHub export

Set `GITHUB_TOKEN` with `repo` scope. From a conversation, use **Export** to write Markdown under `chat-logs/`.

## License

MIT

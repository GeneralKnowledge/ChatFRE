# FreeLLM Chat

Self-hostable ChatGPT-like web app that routes across genuinely free LLM APIs with intelligent failover, quota-aware scheduling, streaming, and GitHub conversation export.

## Quick start

```bash
pnpm install
cp .env.example .env.local
# Add at least one provider key, e.g. GROQ_API_KEY=...
# Providers that allow anonymous access (LLM7, Kilo, OVHcloud) work without a key.
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- Next.js (App Router) + React + TypeScript + Tailwind
- SQLite via libSQL + Drizzle ORM
- Zod validation, Vitest unit tests, Playwright ready
- pnpm

## Architecture

```
Web UI → Chat API → Conversation Service → LLM Router / Scheduler → Provider adapters
                                                              ↘ GitHub Service
```

Provider definitions live in `config/providers.json` (data-driven). Runtime usage/health is tracked separately. API keys stay server-side.

## Scheduler (single-user)

- Hard limits (RPM, concurrency, TPM) via token buckets
- Daily/monthly quotas are budget signals — **not** converted into tiny constant RPM
- Long-window binding: `remainingQuota >= burstRPM * remainingMinutes` → quota not binding
- Interactive queue priority, failover on 429/5xx, observed rate-limit headers

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local development |
| `pnpm build` / `pnpm start` | Production build |
| `pnpm test` | Unit tests (scheduler, adapters, GitHub) |
| `pnpm lint` | ESLint |

## GitHub export

Set `GITHUB_TOKEN` with `repo` scope. From a conversation, use **Export** to write Markdown under `chat-logs/`.

## Disabled providers

Google Gemini, Hugging Face, and Ollama Cloud remain in config with `enabled: false` and documented reasons. Do not delete them.

## License

MIT

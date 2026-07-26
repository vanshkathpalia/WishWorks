# 2. Tech stack

| Layer | Choice | Why (and rejected alternative) |
|-------|--------|-------------------------------|
| Language | **TypeScript everywhere** | One language across API/UI/scripts; proven comfort zone. Python rejected as a second runtime — only adopt if a data task truly demands pandas. |
| Monorepo | **npm workspaces** (plain, no Turborepo yet) | Two packages to start (`api`, `web` later). Turborepo is overhead until the task graph is real; add it when `web` lands (P3). |
| API | **Fastify + Zod** (`fastify-type-provider-zod`) | Schemas validate + type + document in one place. Express rejected (older idiom, no schema story). |
| DB | **PostgreSQL 16 + Prisma** | Typed queries, one migration history. SQLite rejected: we want JSONB for marketplace payloads and this DB lives a long time. |
| Excel I/O | **exceljs** | Read Meesho/Flipkart templates, write filled ones. Critical-path library for P0. |
| LLM | **Claude API** (`claude-sonnet-5` for copy generation) | Generates titles/descriptions/bullets grounded in the keyword bank. Deterministic code does scoring/validation — the LLM never invents numbers. |
| HTTP clients | **native fetch** + small wrapper | Flipkart API client with OAuth token cache/refresh (60-day tokens). |
| Autosuggest harvest | **fetch against public suggest endpoints**, rate-limited, cached | Cheapest real-buyer-query source. Playwright only if an endpoint requires a browser; keep it out of the default path. |
| UI (P3) | **Next.js 15 + Tailwind + shadcn/ui + Tremor** | Same stack as the NEEPCO project — zero learning cost. Not built in P0–P2; P0's "UI" is CLI commands + generated Excel/report files. |
| Jobs | **node-cron in-process** | Weekly keyword harvest, daily ops sync (P2). BullMQ/Redis rejected for now — no queue semantics needed. |
| Testing | **vitest** + a few fixture Excel files | Validators and generators are pure functions — cheap to test hard. |

## Repo layout (target)

```
WishWorks/
  docs/architecture/        this
  packages/
    db/                     Prisma schema + client (only code touching Postgres)
    core/                   generators, validators, scorers (pure functions)
  apps/
    api/                    Fastify (thin; also hosts CLI entry points)
    web/                    Next.js (P3 — does not exist yet)
  data/
    templates/              downloaded Meesho/Flipkart Excel templates (versioned)
    exports/                generated upload files (gitignored)
  .env / docs/key.md        secrets (gitignored)
```

## Environment variables (names only — values live in `.env`, catalogued in `docs/key.md`)

| Var | Bucket | Needed from |
|-----|--------|-------------|
| `DATABASE_URL` | app-generated (local Docker Postgres) | P0 |
| `ANTHROPIC_API_KEY` | vendor | P0 (content generation) |
| `FLIPKART_APP_ID` / `FLIPKART_APP_SECRET` | vendor (self-access app) | P2 |

Everything runs locally with just Docker Postgres + an Anthropic key. Flipkart creds are
P2-only — P0/P1 work without any marketplace credential.

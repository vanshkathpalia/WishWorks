# WishWorks Seller OS — operating manual

> **Non-technical user? Read `docs/guides/THE-FLOW.md`** — the whole flow end to end.
> Then `docs/guides/START-HERE.md` for the 66-field form.
> `docs/guides/SHIPPING-COST.md` — Meesho's shipping fee is set by the main image, but **nine
> tests found no way to steer it. Closed, don't re-run.** One rule survives: read the shipping
> figure before submitting any main-image change, to catch a bad one (we saw ₹256).
> **New session? Read `docs/reference/HANDOFF.md`**, then `docs/tracks/notion/TICKET_STATUS.md`
> for current state and `docs/tracks/notion/CORRECTIONS.md` for what we got wrong.
> The live work is `flipkart-autofill/` (Playwright bot that fills the Flipkart listing form).
> Tools first, docs second: an architecture-doc-first approach was tried and rejected.

## What this is (60 seconds)
Internal automation for WishWorks, a balloon/party-supplies business selling on **Flipkart**
and **Meesho**. #1 priority: make listing new products fast (Listing Factory). #2: generate
new combo ideas worth listing (Combo Generator). Later: Flipkart API ops sync, then the
intelligence dashboard. Full design: `docs/architecture/` (read `README.md` first).

## Hard constraints (do not re-litigate)
- Flipkart API **cannot create new products** (needs existing FSN); new products = Excel +
  dashboard QC. Meesho has **no public API** — Excel bulk upload via Supplier Panel.
  → Listing creation is generate→validate→review→upload; only Flipkart price/stock/orders
  are fully API-automated (P2).
- Deterministic code computes scores/validations; **Claude only writes copy and explains** —
  grounded in the keyword bank, never inventing attribute values.
- Money = integer paise. Timestamps = UTC. BusinessEvent log is append-only.

## Phases — we are on P0
P0 Listing Factory → P1 Combo Generator → P2 Ops Sync → P3 Dashboard.
Build order and done-checks: `docs/architecture/7-roadmap.md`. Don't build ahead.

## Stack
TypeScript, npm workspaces, Fastify+Zod, Postgres 16+Prisma (only `packages/db` touches DB),
exceljs, sharp, Claude API, node-cron, vitest. P0 UI = CLI (`wishworks …`), not web.

## How we work (user-set, 2026-07-19)
- **Speed over ceremony.** No roles/tracks/Notion. Lean docs.
- Non-obvious decisions → short `docs/learning/<n>-slug.md` note with the change.
- File-top summary comment on every code file.
- Git: show staged files + full commit message, wait for approval, then commit directly.
  **Never add a Co-Authored-By/AI line.**
- **Tickets live in the repo, never in Notion from here.** The Notion MCP on this Claude
  account points at a *different* project — do not write to it. Keep
  `docs/tracks/notion/TICKET_STATUS.md` current, log every mistake+fix in
  `docs/tracks/notion/CORRECTIONS.md`, and regenerate `NOTION_SYNC.md` at sync points for
  Vansh to paste into a Notion-connected Claude. Spec: `ADOPT_THIS_SYSTEM copy.md` §7–7c.
- Secrets: names in `docs/key.md` (gitignored) + `.env.example`; never commit values.

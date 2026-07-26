# 7. Roadmap — linear build order

No roles/tracks (user decision) — one straight campaign. Each level has a runnable
"done" check. Detail is full for P0/P1; P2/P3 are outlined.

## P0 — Listing Factory

| L | Deliverable | Done when |
|---|---|---|
| 1 | Scaffold: npm workspaces, `packages/db` (Prisma + Docker Postgres), `packages/core`, `apps/api` CLI entry | `npm run db:migrate` green; `wishworks --help` prints |
| 2 | Schema v1: Component, Product, ComboItem, Keyword, ListingContent, ChannelListing, BusinessEvent + seed of real WishWorks components | seed script loads actual component list |
| 3 | `product add` (interactive) + cost rollup from components | a real combo SKU created with correct cost |
| 4 | Keyword Harvester (Flipkart + Meesho autosuggest, a–z expansion, rate-limited, weekly cron) | ≥300 real phrases in bank from category seeds |
| 5 | Content Generator (Claude, per-platform templates, keyword grounding, versioned output) | `generate <sku>` yields both platforms' copy w/ full attribute maps |
| 6 | Pre-QC Validator (image specs + auto-resize via sharp, data completeness, title limits) | `validate <sku>` catches seeded violations; green on a good product |
| 7 | Meesho export adapter (fill real bulk template + image-link patching) | generated Excel opens clean; column snapshot test green |
| 8 | Flipkart export adapter (category catalog Excel) | generated file matches template |
| 9 | **BOSS: first real listing** — a new combo through the whole pipeline, uploaded to both platforms | passes Meesho QC and Flipkart QC **first try**; `mark-live` recorded; events logged |

## P1 — Combo Generator

| L | Deliverable | Done when |
|---|---|---|
| 10 | KitTemplates + candidate generation (constrained combinatorics, dedup) | ≥100 sane candidates from real components |
| 11 | Signal collectors (search-result counts, prices, review mass; cached, rate-limited) + seasonality calendar | signals stored for top candidates |
| 12 | Opportunity score + explanations + `opportunities` command | ranked top-20 with human-readable reasons |
| 13 | **BOSS:** accept top candidates → through Listing Factory → live | ≥3 generator-born combos live on both platforms |

## P2 — Ops Sync (outline)

Flipkart self-access app + OAuth client (token cache) → price/stock push from canonical model
→ order ingestion (API) + Meesho order CSV import → stockout/price-mismatch alerts →
BusinessEvents wired everywhere. **Boss:** a price change made once propagates to Flipkart
via API and flags the Meesho manual step; orders flow in daily untouched.

## P3 — Dashboard & Intelligence (outline)

Next.js app over the accumulated data: command center (revenue/orders/alerts), product
intelligence per SKU, combo prediction-vs-outcome review, Seller A (12mo) + Seller B (1mo)
historical imports, AI analyst over calculated facts. Scope per
`wishworks_seller_intelligence_platform_planning.md`.

## Standing rules (lightweight — no track ceremony)

- Every non-obvious decision → a short note in `docs/learning/` (plain-integer filenames),
  created with the change.
- File-top summary comment on every code file.
- BusinessEvents from the first live listing onward — no silent state changes.
- Show staged files + full commit message before committing; no AI co-author line.
- Templates from marketplaces are versioned in `data/templates/`; a failing snapshot test —
  not a corrupt upload — is how we learn a platform changed its format.

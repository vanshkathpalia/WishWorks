# WishWorks Seller OS

Internal automation for WishWorks — a balloon and party-supplies business selling on
**Flipkart** and **Meesho**. It prepares listing images to spec and fills the ~66-field
Flipkart listing form, so putting a new product up takes minutes instead of an afternoon.

**Nothing goes live without a human looking at it.**

---

## Start here

| If you are… | Read |
|---|---|
| **Doing the listing work** (non-technical) | **[docs/guides/THE-FLOW.md](docs/guides/THE-FLOW.md)** — the whole flow, start to finish |
| Filling the 66 listing fields | [docs/guides/START-HERE.md](docs/guides/START-HERE.md) |
| Wondering *why* the image rules are what they are | [docs/image-playbook.md](docs/image-playbook.md) — formats, AI prompts, marketplace SEO |
| Picking up development | [docs/reference/HANDOFF.md](docs/reference/HANDOFF.md), then [docs/tracks/notion/TICKET_STATUS.md](docs/tracks/notion/TICKET_STATUS.md) |
| Auditing what we got wrong | [docs/tracks/notion/CORRECTIONS.md](docs/tracks/notion/CORRECTIONS.md) |

---

## The two commands

```bash
cd flipkart-autofill

npm run images -- --crop-bottom=25 --crop-images=1 --erase-tag=150,30 --erase-images=2,3,4
                                     # downloads → clean plates for the AI
npm run images -- --final            # AI output → upload-ready, descriptions embedded
npm start                            # fill the Flipkart listing form
```

`npm test` — 61 end-to-end tests over the image pipeline.

---

## Layout

```
CLAUDE.md                  operating manual for AI sessions (must stay at root)
flipkart-autofill/         the working tools
  src/images.ts            image pipeline
  src/fill.ts, scan.ts     Flipkart form filler
  images/1-raw → 2-clean → 3-final
  image-meta/<ID>.json     picture descriptions — Meesho + Flipkart
  products/<ID>.json       the 66 Flipkart listing fields — Flipkart only
  categories/              shared defaults per category
  tests/                   vitest suite
docs/
  guides/                  how to actually use it (non-technical)
  image-playbook.md        formats, AI prompts, SEO — with sources and confidence levels
  learning/                one note per non-obvious decision
  tracks/notion/           tickets + corrections ledger (repo-local, never Notion)
  reference/HANDOFF.md     handover notes
  samples/                 real marketplace files used for testing
```

Next up is the **GUI pivot** — an Electron app so a non-technical partner on Windows can run
all of this without a terminal. Build order is in [CLAUDE.md](CLAUDE.md).

---

## Hard constraints

- **No API can create a new product.** Flipkart needs an existing FSN; Meesho has no public
  API. Listing creation is generate → validate → human review → upload.
- **Deterministic code enforces every spec. AI only writes copy and edits images** — it never
  enforces a rule and never invents attribute values.
- Money = integer paise. Timestamps = UTC.

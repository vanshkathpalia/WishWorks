# WishWorks Seller OS — operating manual

> **Non-technical user? Read `docs/guides/THE-FLOW.md`** — the whole flow end to end.
> Then `docs/guides/START-HERE.md` for the 66-field form.
> **Every AI prompt lives in its own file, and that file is nothing but the prompt** — so
> select-all-copy always works. Edit them there, never inline in another doc:
> `docs/guides/PROMPT-read-pack.md` → `PROMPT-main-image.md` → `PROMPT-infographic.md` build the
> images; `PROMPT.md` then describes the finished ones and returns the listing JSON.
> `docs/image-playbook.md` is the *reasoning* behind them, not a thing to copy from.
> `docs/guides/SHIPPING-COST.md` — Meesho's shipping fee is set by the main image, but **fourteen
> tests found no way to steer it. Closed, don't re-run.** Two rules survive: read the shipping
> figure before submitting any main-image change, to catch a bad one (we saw ₹256); and the
> **20px border (`--border=20`) is the one axis never tested** — still live if anyone wants it.
> **New session? Read `docs/reference/HANDOFF.md`**, then `docs/tracks/notion/TICKET_STATUS.md`
> for current state and `docs/tracks/notion/CORRECTIONS.md` for what we got wrong.
> The live work is `flipkart-autofill/` (Playwright bot that fills the Flipkart listing form).
> Tools first, docs second: an architecture-doc-first approach was tried and rejected.

## What this is (60 seconds)
Internal automation for WishWorks, a balloon/party-supplies business selling on **Flipkart**
and **Meesho**. #1 priority: make listing new products fast (Listing Factory). #2: generate
new combo ideas worth listing (Combo Generator). Later: Flipkart API ops sync.

## Hard constraints (do not re-litigate)
- Flipkart API **cannot create new products** (needs existing FSN); new products = Excel +
  dashboard QC. Meesho has **no public API** — Excel bulk upload via Supplier Panel.
  → Listing creation is generate→validate→review→upload; only Flipkart price/stock/orders
  are fully API-automatable.
- Deterministic code computes scores/validations; **Claude only writes copy and explains** —
  grounded in the keyword bank, never inventing attribute values.
- Money = integer paise. Timestamps = UTC.

## Where we are
P0 Listing Factory works today, driven from the terminal. **Next: the GUI pivot** — Vansh's
business partner is non-technical, on Windows, and cannot use `npm run …`. Build order:

- **A. Make the engine callable.** Every CLI in `src/` does argv parsing + `console.log` +
  `process.exit` inside `main()`, so none of it can be driven by a GUI. Split each into a core
  function (options in, structured result out, progress callback) with the CLI as a thin wrapper.
  All tests and every `npm run …` must keep working — they are the proof the refactor changed
  no behaviour. `paths.ts` and `encode.ts` are already extracted this way.
- **B. Electron shell + tab 1** (AVIF → JPG/PNG): window, tab bar, drag-and-drop a folder,
  pick format + quality, thumbnails and results.
- **C. CI build → the real `.exe`** (unsigned, GitHub Actions). Get an installer into the
  partner's hands while the app still does one thing — install problems surface early.
- **D. Remaining tabs**, in order: Flipkart login (live "you're logged in" indicator instead of
  terminal dots) → prepare images → finish → check → fill listing.

Don't build ahead of the current step.

## Stack
TypeScript + tsx (no build step), Playwright (drives real Chrome via `profile/`), sharp,
vitest. No database, no server, no workspaces — none of that was ever built and P0 doesn't
need it. P0 UI = CLI (`npm run …`); the GUI pivot above replaces it with Electron.

## How we work (user-set, 2026-07-19)
- **Speed over ceremony.** No roles/tracks/Notion. Lean docs.
- **Reduce before adding.** Delete closed experiments and dead code — but **"closed" and
  "untested" leave the same trace, and so do "done" and "not started yet"**. The `--border` flag
  (an unrun experiment) and `NOTION_BOARD_SEED.md` (a spec for a board not yet built) were both
  nearly deleted as dead weight in one session. Staleness argues for *updating* a file, never for
  deleting it. Ask before removing anything that still answers an open question or specifies work
  not yet done. See C-036 and `docs/learning/5-closed-is-not-untested.md`.
- Non-obvious decisions → short `docs/learning/<n>-slug.md` note with the change.
- File-top summary comment on every code file.
- Git: show staged files + full commit message, wait for approval, then commit directly.
  **Never add a Co-Authored-By/AI line.** **Short subject line, then one `-` bullet per thing
  fixed or added.** No paragraphs, no rationale essays — that belongs in `TICKET_STATUS.md`.
- **Tickets live in the repo, never in Notion from here.** The Notion MCP on this Claude
  account points at a *different* project — do not write to it. Keep
  `docs/tracks/notion/TICKET_STATUS.md` current (it is the source of truth) and log every
  mistake+fix in `docs/tracks/notion/CORRECTIONS.md`. **The Notion board has never been built**
  — `NOTION_BOARD_SEED.md` is the spec Vansh pastes into a Notion-connected Claude when he wants
  it; keep it in sync with TICKET_STATUS rather than letting it drift.
- Secrets: names in `docs/key.md` (gitignored) + `.env.example`; never commit values.

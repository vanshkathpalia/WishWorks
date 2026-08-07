# WishWorks Seller OS — operating manual

> **Non-technical user? Read `docs/guides/THE-FLOW.md`** — the whole flow end to end.
> Then `docs/guides/START-HERE.md` for the 66-field form.
> **Every AI prompt lives in its own file, and that file is nothing but the prompt** — so
> select-all-copy always works. Edit them there, never inline in another doc:
> `docs/guides/PROMPT-read-pack.md` → `PROMPT-main-image.md` → `PROMPT-infographic.md` →
> `PROMPT-infographic-sizes.md` build the images (→ `1.png`, `2.png`, `3.png`). Two of those
> steps offer a **choice of prompt, and you send one, not all**: the hero is either
> `PROMPT-main-image.md`, or the experimental `PROMPT-main-image-bordered.md` (9% border + badges,
> the only measured difference between a ₹60 and a ₹49 main image — see `SHIPPING-COST.md`), or
> `PROMPT-add-border.md` when the plain photo already exists and only needs framing;
> the infographic is either counts-only (`PROMPT-infographic.md`) or the same items with
> measured sizes (`PROMPT-infographic-sizes.md`).
> The hero always puts the garland top-left. `PROMPT-layout-{right,both-sides,corners,arch}.md`
> are **follow-up messages** that move it and change nothing else — three lines each, deliberately
> not four copies of the hero prompt, so a fix to the counts/props/SEO rules is made once.
> Then, in one chat, `PROMPT-meta.md` describes the finished ones and writes the Meesho
> copy (→ `image-meta/<ID>.json`) and `PROMPT-product.md` fills the Flipkart fields
> (→ `products/<ID>.json`). **Those two are split because the ANSWER got truncated, not the
> prompt** — ChatGPT silently dropped the tail of a combined reply (WW-081). Send them back to
> back in the SAME chat: the photos must still be in context when the second one runs.
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

**Costing a kit** is `PROMPT-inventory.md` → the app's **Inventory cost** panel (`inventory-core.ts`,
`categories/materials.json`). It is the one prompt **not** copied verbatim: the app appends the
current price list, because the prompt asks for names copied exactly from it. **OCR was built and
then removed** — `tesseract.js` worked, but reading the image only gives a string, and picking
which price row it is needs a fuzzy matcher whose mistakes are invisible in a total. Don't
reinstate it; the image sits beside the table and that is the check. See WW-115.

## Where we are
P0 Listing Factory works today, driven from the terminal. **Next: the GUI pivot** — Vansh's
business partner is non-technical, on Windows, and cannot use `npm run …`. The full spec —
tabs, the four rules it exists to enforce, and how each part gets tested — is
**`docs/guides/GUI-SPEC.md`**; keep it current. Build order:

- **A. Make the engine callable.** ✅ *image half done.* `images-core.ts` (`runImages`) and
  `finish-core.ts` (`runFinish`) are options in, structured result out, `onRow` progress; the
  CLIs are thin wrappers imported by nothing. The browser CLIs (`login`, `scan`, `fill`,
  `check`, `start`) are **WW-066b** and get the same treatment when WW-069 builds their tab —
  the result shape should follow what the tab draws. All tests and every `npm run …` must keep
  working untouched; they are the proof the refactor changed no behaviour. Pattern to follow:
  `paths.ts`, `encode.ts`, `images-core.ts`, `finish-core.ts`. **Do not try to collapse a core
  and its CLI into one file** behind an entry-point check — `import.meta.main` is stripped by
  tsx and the `argv[1]` comparison breaks on symlinked paths; both were measured, see
  `docs/learning/6-core-files-not-an-entry-point-guard.md`.
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

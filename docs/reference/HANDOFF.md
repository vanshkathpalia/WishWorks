# WishWorks — session handoff (2026-07-20)

> ⚠️ **Written 2026-07-20 and now partly superseded.** It is still the best explanation of
> *why* the autofill bot works the way it does. For current state, read these first:
> - **[`../tracks/notion/TICKET_STATUS.md`](../tracks/notion/TICKET_STATUS.md)** — the live ledger, 40 tickets
> - **[`../tracks/notion/CORRECTIONS.md`](../tracks/notion/CORRECTIONS.md)** — 19 mistakes, causes, fixes
> - **[`../guides/THE-FLOW.md`](../guides/THE-FLOW.md)** — how the pipeline is actually run today
>
> Added since: the whole image pipeline (`npm run images`, three folders, 39 tests), AI
> prompts, and the finding that Meesho serves 512×512 `.avif` — not WebP as assumed below.

Read this for background on the autofill bot: what exists, why it was built this way, what is
verified, and what to do next.

---

## 1. The business

WishWorks sells **balloons / party decoration** on **Flipkart** and **Meesho** (seller account
name "WishWorks", based in Hisar). Vansh is an experienced full-stack dev (TypeScript,
Fastify, Prisma, Next.js) — no need to simplify technical explanations.

**The #1 pain:** creating a new Flipkart listing means filling ~66 attribute fields by hand on
the "Additional Description" tab, plus 21 on "Price, Stock and Shipping", per product. It is
slow and repetitive. Everything else (analytics, dashboards, combo generation) is secondary
until listing is fast.

---

## 2. How we work (learned the hard way this session)

- **Runnable tools over documents.** An architecture doc set was written first and Vansh
  rejected it — *"very very bad architecture… this isn't helping me with anything."* The docs
  still exist under `docs/architecture/` as background, but the working mode is: pick the next
  hectic manual task, build the tool that kills it.
- Speed over ceremony. No roles/tracks/Notion. Lean docs.
- `docs/learning/<n>-slug.md` note for genuinely non-obvious decisions, file-top comment on
  each code file.
- Git: show staged files + full commit message, wait for approval, then commit. **Never** add
  a Co-Authored-By / AI line.
- **Verify claims before making them.** Several hours were lost this session to checks that
  were written on assumption and were wrong (details in §6). Test against the real thing.

---

## 3. Platform constraints (verified July 2026 — do not re-litigate)

| | Reality |
|---|---|
| Flipkart API | `POST /listings/v3` needs an **existing FSN** (13–16 chars), max 10 SKUs/batch. **Cannot create new products.** Price / stock / orders / returns are fully automatable. |
| New Flipkart product | Dashboard form or category Excel + QC (24–72h). No API path. |
| Meesho | **No public seller API** (partner-gated: Unicommerce/EasyEcom/Fynd). Supplier Panel bulk Excel only. Images: ~2000×2000 JPG, 200–600 KB. |

Consequence: listing creation is **generate → validate → human review → submit**. Only ops
(Flipkart price/stock/orders) can ever be fully hands-off.

---

## 4. What was built: `flipkart-autofill/`

A Playwright bot that fills the Flipkart listing form on Vansh's own logged-in seller account.

**Origin:** a friend's Python bot (`flipkart_bot.py`, `listing_bot.py`, kept at repo root for
reference) does this with blind keyboard macros — `keyboard.send('tab')` × N, `press('down')`
× N. Its author admits it "sometimes fills wrong items." It encodes *position*, not identity,
so one extra field shifts everything after it and it still prints "Process Complete!". It is
also Windows-only (`ctypes.WinDLL`), so it cannot run on Vansh's Mac at all.

**Ours differs on two axes that matter:**
1. **Targets fields by their visible label** in the DOM, not by Tab counts.
2. **Reads every value back after typing it** and reports `mismatch` with the actual content.
   It can be wrong, but never silently wrong.

Dropdowns are selected by typing the option text, never by counting arrow presses.

### Commands

```bash
cd flipkart-autofill
npm run login                      # once — OTP; Ctrl+C is safe
npm run scan balloon-decoration    # per category, per tab: discovers the fields
npm run fill -- products/<x>.json  # types everything; never clicks Save
```

### Files

```
src/connect.ts   launches real Chrome w/ persistent profile; active-tab detection; login check
src/fields.ts    THE ENGINE — label discovery, companion/furniture detection, fill+verify
src/scan.ts      calibration: writes categories/<name>.json + coverage report
src/fill.ts      merges defaults + product values, fills, verifies, reports
src/login.ts     one-time login, auto-detects the session

categories/balloon-decoration.json                  ← scanned field list (71 entries)
categories/balloon-decoration.defaults.json         ← constants for Additional Description tab
categories/balloon-decoration.pricing.defaults.json ← constants for Price/Stock/Shipping tab
products/example-black-gold-birthday-kit.json       ← one product's specifics
```

**How the data layers work:** all `categories/<category>.*.defaults.json` files are merged
automatically, then the product's own `values` override them. Fields belonging to a different
tab report "not on this tab", so one product file serves every tab. Any value still reading
`TODO_…` aborts the run before anything is typed.

**Why scan exists (the key advantage over the friend's bot):** Flipkart's attributes are
per-category. This category has hand-fan / blowout / cracker / battery attributes. A different
vertical has a completely different set. `npm run scan <other-category>` writes a separate
template — **no code changes ever**.

---

## 5. Current state — what is verified working

- Login persists (`./profile`, gitignored). Session detection is honest.
- Scan captured **71 entries on the Additional Description tab**, which reconciles exactly:
  **66 real attributes + 3 unit pickers + 2 FSN entries = 71.** Field names are correct
  (`Model Name`, `Pack of`, `Series`, `Design`, `Shape`, `Balloon Type`, `Width/Height/Depth/
  Diameter/Weight`, `Handle`, `Foldable`, `Gift Pack`, warranty block, …).
- Scan reads Flipkart's own tab counters (`(0/66)`) and prints a coverage verdict, so
  "am I missing fields?" is answered by the tool, not by eyeballing.
- Defaults + example product are aligned to the real scanned names: **35 values** will be typed.
- Typecheck clean. Engine unit-tested against replica DOMs (two layouts).

### NOT yet done
- **`npm run fill` has never been run against the real form.** This is the immediate next step.
- The **Price, Stock and Shipping (0/21)** tab has not been scanned yet.
- `categories/balloon-decoration.json` still holds the older naming (`Weight #2`,
  `FSN #2`) — a re-scan will rewrite these as `Weight (unit)` and tag FSN as furniture.
  Delete the file first for a clean capture.
- Nothing has been committed to git (the repo is not even a git repo yet).

---

## 6. Bugs found and fixed this session (context for why the code looks like it does)

Each of these cost real time; the fixes are deliberate, don't "simplify" them away:

1. **Scanned the wrong tab.** Flipkart opens "Add New Listing" in a *new* tab; the code used
   `pages()[0]`. Now picks the tab with the most inputs. Scan also refuses to save a page with
   <5 fields (it had silently saved the dashboard's search box as a "field").
2. **Fields silently dropped.** Duplicate/junk labels caused `Model Name`, `Pack of`, `Series`,
   `Design` to vanish. Now nothing is ever dropped — duplicates become `X #2`, unlabelled
   become `UNLABELED_n`.
3. **Labels read from the wrong place.** Flipkart uses a two-column layout, so the label is a
   *sibling* cell, not an ancestor's first line. Captured `inch`, `kg`, `0/5000`, `string`
   before the fix; a JUNK filter now rejects units, counters, and placeholders.
4. **Login lost on every Ctrl+C.** Chrome only flushes cookies on graceful shutdown, and
   Playwright's default signal handling kills it first. Fixed with
   `handleSIGINT/SIGTERM/SIGHUP: false` + our own graceful close. **Verified by experiment.**
5. **Stale Chrome held the profile lock.** Chrome allows one process per profile dir; a
   leftover from a previous run made every new launch start session-less — looked exactly like
   "it logged me out". Now cleared automatically before launch.
6. **Login check was a lie.** It tested for *cookie files on disk*; a stale `connect.sid`
   persisted long after the server invalidated it, so it reported "logged in" while every page
   showed the login screen. Now checks the actual redirect — Flipkart bounces unauthenticated
   requests to `/?referral_url=…`. Also: the app lives at `/index.html#dashboard`; the bare
   domain serves the public marketing site.
7. **`/^Search+Check/` regex bug** — matches "Searc" + repeated "h", not repeated "Search", so
   companion-dropdown detection silently never fired. Now `/^(?:Search)+Check/`.

**Meta-lesson worth carrying forward:** every one of #4–#7 was a check written on assumption.
Verify against the real system before reporting something as working.

---

## 7. What's next (in order)

1. **Re-scan cleanly** (`rm categories/balloon-decoration.json` first) — expect
   `✅ 66 captured vs 66 on the form — complete.`
2. **First real fill:** `npm run fill -- products/example-black-gold-birthday-kit.json` on the
   Additional Description tab. Expect dropdowns (`Shape`, `Hand Crafted`, `Gift Pack`) to be
   the likeliest mismatches — they need option text matching Flipkart's list exactly. Tune from
   the report.
3. **Scan the Price/Stock/Shipping tab**, so `balloon-decoration.pricing.defaults.json`
   (HSN 95030020, 10×8×10cm, 0.16 kg, Express, GST_5, WishWorks Hisar) goes live.
4. **Ship one real listing end to end** through QC — the true done-check.
5. `git init` + first commit (ask for approval on the message; no AI co-author line).

**Later** (design already sketched in `docs/architecture/`, don't build ahead):
auto-generating the product JSON copy with Claude + a keyword bank, image resize/compress to
QC spec, the same scan/fill treatment for Meesho's panel, then the combo generator and
dashboard.

---

## 8. Environment facts

- macOS, Chrome 150, Node 24, Playwright 1.61 (1.54 could not attach to Chrome 150's CDP).
- **Attaching to an already-open Chrome is impossible:** Chrome ≥136 blocks
  `--remote-debugging-port` on the default profile, and a Chrome not started with the flag
  can't be attached to at all. Hence our own persistent-profile Chrome. Don't retry this path.
- `flipkart-autofill/profile/` holds the login and is gitignored. Never commit it.

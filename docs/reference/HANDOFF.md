# WishWorks — handoff into the GUI build

> **Written 2026-07-31, at the end of the CLI phase.** Level one — the terminal pipeline — is
> finished and proven end to end. The next chat builds the desktop app (level two).
>
> **Read in this order:**
> 1. **[`../../CLAUDE.md`](../../CLAUDE.md)** — how we work, the hard constraints
> 2. **[`../guides/GUI-SPEC.md`](../guides/GUI-SPEC.md)** — **the requirements document for
>    level two. Build from it.** Platform, screens, folder memory, prompt panels, release loop
> 3. **[`../guides/THE-FLOW.md`](../guides/THE-FLOW.md)** — the nine steps the app puts a face on
> 4. **[`../tracks/notion/TICKET_STATUS.md`](../tracks/notion/TICKET_STATUS.md)** — live ledger
> 5. **[`../tracks/notion/CORRECTIONS.md`](../tracks/notion/CORRECTIONS.md)** — 41 mistakes and
>    what caused them. C-038 through C-041 are from this week and all four are still relevant
>
> Sections 1-4, 6 and 8 below are the original 2026-07-20 handoff and still explain **why the
> autofill bot is built the way it is**. Sections 5 and 7 are current as of today.

---

## 0. Where this stands, 2026-07-31

**Level one is done.** The whole pipeline runs from the terminal and has been driven end to end
against the live Flipkart form: images in, descriptions embedded, 30 fields filled and read back,
listing saved.

```
108 tests   ·   npm run verify (22 engine checks)   ·   typecheck   —   all green
```

**What got fixed this week**, all of it found by running the thing rather than reading it:

| | |
|---|---|
| **WW-066** | The image engine is callable — `runImages()` / `runFinish()`, options in, structured result out. **This is what the GUI imports.** The browser CLIs are WW-066b, done per screen |
| **WW-080** | One product, any filename. `ANP 3` / `ANP-3` / `ANP003` / `image-meta-ANP003` all resolve to one file, everywhere. No renaming step |
| **WW-084/86/88** | `paste` became the pre-flight check: both length ends against each field's real target, Model Name drift between the two JSONs, banned and urgency words, commas on the Flipkart side only, emoji |
| **WW-087** | Buyer-language SEO rules into both prompts — name items the way buyers search, say *where* the kit is used, attributes over prose |
| **WW-094** | Chrome's profile moved to the OS user-data dir. It had to: a packaged app's own folder is read-only, and Chrome answers that by silently starting with no session |
| **WW-074** | **Closed.** Flipkart's Description keeps line breaks — the bot can fill it |
| **WW-095** | That field is **5000 characters, not 1400.** Every listing so far used 28% of the largest piece of search surface in the listing |
| **WW-096** | **Emoji in the Description made every save return HTTP 500.** The listing could not be saved at all. Template is plain ASCII now and `paste` blocks emoji before the form |

**The two that cost the most were only findable by running the last step.** Nothing had ever been
saved through this tool until this week — the emoji bug sat undetected for five days because the
final step had never once been executed. *A pipeline is proven only as far as the last step
actually run.*

### The one thing still open in level one

**`Balloon Type` reads back `Latex` when three values are sent.** The probe says
`<input> kind=text` with no pills, so either the field is genuinely single-value (fix the data)
or `fields.ts` mis-detects a multi-select (fix the code). **Unanswered question: does that field
have a dropdown arrow, or accept more than one value?** Until it is settled the ⚠️ guard blocks
`npm start`'s auto-save on every run — correctly, but it makes the auto-save useless.

Also worth doing and unrelated to the GUI: **WW-055**, a live listing still carrying
`Net Weight = 10000 g` from an old test. It is the only open item that costs money at settlement.

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
  rejected it — *"very very bad architecture… this isn't helping me with anything."* Those docs
  were deleted 2026-07-26; the working mode is: pick the next hectic manual task, build the
  tool that kills it.
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

## 5. Current state

Everything in §4 still holds. Added since, and all of it exercised on real listings:

- **The image pipeline** — `npm run images` (three folders, raw → clean → final) and
  `npm run finish` (the already-clean shortcut). Descriptions embedded as EXIF, read back by
  `npm run check`.
- **`npm run paste -- <ID>`** — prints the four marketplace values with real line breaks and
  runs every mechanical listing rule. This is the gate before anything goes live.
- **The prompts**, one file each, nothing but the prompt: `PROMPT-read-pack` →
  `PROMPT-main-image` → `PROMPT-infographic` build the images; then `PROMPT-meta` and
  `PROMPT-product`, back to back in the same chat, write the copy and the 66 fields.
- **`npm start`** fills the Flipkart form and now **saves automatically** once every field reads
  back clean. Nothing auto-saves while any field reads ⚠️ — that guard is the safety model.

### Not proven

- **The Price / Stock / Shipping tab has never been run against the live form** (WW-015). It is
  the oldest open risk and the highest-value thing to try next.
- **Meesho has no bot at all.** Step 9 is hand-typed. WW-093 is to `scan` its panel the way
  Flipkart's 66 fields were scanned — the same engine fills it, and it is the biggest single
  time saving left.
- Whether any marketplace reads the EXIF descriptions (C-019). Writing them is free.

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

## 7. What's next — level two, the desktop app

**Requirements live in [`../guides/GUI-SPEC.md`](../guides/GUI-SPEC.md). Build from that, not
from this file.** The short version:

**Electron, shipping both a `.dmg` and a `.exe`.** A Vercel web app was specced in full and
rejected — the engine is Node code that already works, Electron runs Node, and a browser cannot
drive a logged-in Flipkart session at all. The record is in GUI-SPEC so it is not re-argued.

**A mobile app is not wanted** (decided 2026-07-31): Flipkart does not allow creating a listing
from its app, and the photos live on a laptop. Nothing in this project needs a phone.

```
WW-067  Electron shell + step 1 (AVIF → JPG) + per-step folder memory
WW-068  GitHub Actions → the .exe AND .dmg, plus electron-updater   ← deliberately early
WW-089  The listing frame: selector, step rail, state read from disk
WW-069  Remaining image steps: prepare → finish → check
WW-090  Prompt panels (steps 3, 4, 5) with paste's checks inline
WW-066b Split the browser CLIs, one per screen as it is built
WW-093  scan the Meesho Supplier Panel, then fill it
```

**The contract at every step:** all 108 tests, `npm run verify` and every `npm run …` keep
passing untouched. They are the proof the GUI changed no behaviour.

**The release loop** — fix and test on the Mac, build a `.dmg`, confirm the *packaged* app works,
only then push a build for the partner. Most iterations never leave the Mac. But a `.dmg` proves
packaging, not platform: WW-061 was Windows-only, so one early `.exe` still has to run on the
partner's real machine.

**Three things that only bite once packaged**, all in GUI-SPEC: swap `playwright` for
`playwright-core` (and require Chrome to be installed), `profile/` in the user-data dir (done,
WW-094), and `sharp` built per platform on its own runner.

---

## 8. Environment facts

- macOS, Chrome 150, Node 24, Playwright 1.61 (1.54 could not attach to Chrome 150's CDP).
- **Attaching to an already-open Chrome is impossible:** Chrome ≥136 blocks
  `--remote-debugging-port` on the default profile, and a Chrome not started with the flag
  can't be attached to at all. Hence our own persistent-profile Chrome. Don't retry this path.
- `flipkart-autofill/profile/` holds the login and is gitignored. Never commit it.

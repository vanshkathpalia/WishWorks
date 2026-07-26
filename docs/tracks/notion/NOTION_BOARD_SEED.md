# NOTION_BOARD_SEED — WishWorks Seller OS

> **You are a Claude with the Notion MCP connected to Vansh's WishWorks workspace.** The
> repo-aware session cannot reach it (its MCP points at a different account/project), so it
> wrote this file for you. Everything you need is here — do not ask the repo for more.
>
> **Order of operations:**
> 1. Create the **Segments** DB (§2) — 6 lenses.
> 2. Create the **Tasks** DB with the schema in §3, then create every ticket in §5.
> 3. Create the **Corrections** DB (§4) and load **C-001…C-036** from `CORRECTIONS.md`.
> 4. Create the **Documentation** DB (§6) and **Learning** DB (§7).
> 5. Report back what you created.
>
> Scope: **P0 (current) + P1 (next)** only. Do not create P2/P3 detail.
>
> **Currency.** Rewritten **2026-07-26** against `TICKET_STATUS.md` at WW-065 / C-036. The
> previous version of this file was frozen at 2026-07-21 (it said "load C-001…C-011" when there
> are now 36) — **if the board does not exist yet, everything here is the first load; if it does,
> reconcile rather than duplicate.** There is no `NOTION_SYNC.md`; it was deleted 2026-07-26
> because a delta file that has to be hand-regenerated goes stale faster than the ledger it
> summarises. `TICKET_STATUS.md` in the repo is the single source of truth.

---

## 1. What this project is

**WishWorks Seller OS.** Internal automation for a balloon & party-supplies business selling
on **Flipkart** and **Meesho**.

**Goal (user-set, 2026-07-21):** automate our listing work, understand both marketplaces
properly, and make selling easier. **Not** a data-analytics or seller-intelligence platform —
that framing was explicitly deprioritised, and the docs carrying it were deleted 2026-07-26.

**Hard constraints — do not re-litigate:**
- No API can create a new product. Flipkart needs an existing FSN; Meesho has no public API.
  Listing creation is therefore generate → validate → human review → upload.
- Deterministic code computes scores and enforces specs. **AI only writes copy and edits
  images** — it never enforces a rule and never invents attribute values.
- Money = integer paise. Timestamps = UTC.

**Working style:** speed over ceremony. No roles, no tracks, lean docs. Tools first, docs
second — an architecture-doc-first approach was tried and rejected (C-001).

**What is actually running today:** a TypeScript CLI toolkit in `flipkart-autofill/` — tsx (no
build step), Playwright driving real Chrome, sharp, vitest. **No database, no server, no
monorepo.** 61 tests + a 22-check engine harness, all green.

**The current focus is the GUI pivot** (WW-066…WW-069, §5). Vansh's business partner is
non-technical, on **Windows**, and cannot use `npm run …`. Everything becomes an Electron app.

---

## 2. Segments DB (6 lenses)

Plain DB, one page per segment. Tasks relate to a segment.

| Segment | Covers |
|---|---|
| **Build** | Shipping features and tools |
| **Fix** | Bugs and regressions |
| **Research** | Marketplace rules, APIs, SEO — anything about the outside world |
| **Learn** | Concepts worth retaining (`docs/learning/`) |
| **Documenting help** | Docs written for humans (`START-HERE.md`, playbooks) |
| **Diagnose** | The corrections ledger — mistakes, causes, patterns |

`Phase` is a **plain select on each task**, not a segment.

---

## 3. Tasks DB — property schema

| Property | Type | Options |
|---|---|---|
| **Name** | Title | `[P_n][L_n] <summary>` — **no `[ROLE]` segment** (Vansh ruled out roles 2026-07-19) |
| **ID** | Text | `WW-001` … |
| **Status** | Select | `Not started` · `In progress` · `Done` · `Blocked` · `Partial` |
| **Priority** | Select | `Critical` · `High` · `Medium` · `Low` |
| **Type** | Select | `Feature` · `Bug` · `Research` · `Docs` · `Chore` |
| **Phase** | Select | `P0` · `P1` · `P2` · `P3` |
| **Level** | Select | `L1` … `L6` (provisional — `docs/tracks/LEVELS.md` still doesn't exist, WW-026) |
| **Segment** | Relation | → Segments DB |
| **Affected** | Multi-select | see palette below |
| **Contract-touched** | Checkbox | ticks when a file format or field schema changes |
| **Blocked on** | Select | `—` · `Vansh` · `Flipkart` · `Meesho` |
| **Completed** | Date | |
| **Left at** | Text | one line: exactly where it stands |

`Partial` was added to `Status` because two real tickets are genuinely half-done (WW-058,
WW-053) and forcing them to `Done` or `Not started` would misreport the project.

**`Affected` palette — derived from this project's actual surfaces:**

`flipkart-autofill` · `scan` · `fill` · `login/session` · `images` · `finish` · `check` ·
`category-defaults` · `product-json` · `image-meta` · `prompts` · `flipkart-listing` ·
`meesho-listing` · `meesho-copy` · `image-specs` · `marketplace-seo` · `shipping-fee` ·
`gui/electron` · `windows-build` · `docs` · `project-system`

---

## 4. Corrections DB — **non-standard, WishWorks-specific**

Vansh asked for every mistake and its correction to be tracked, so a future more capable
model can be handed the whole trail and diagnose the failure patterns. Source of truth:
`docs/tracks/notion/CORRECTIONS.md`.

| Property | Type | Options |
|---|---|---|
| **Name** | Title | `C-0nn · <one-line description>` |
| **Class** | Select | `Design` · `Code` · `Fact` · `Process` |
| **Caught by** | Select | `Vansh` · `Assistant (own test)` · `Tooling` |
| **Status** | Select | `Fixed` · `Withdrawn` · `Open` |
| **Date** | Date | |
| **Cost** | Text | time and/or trust |
| **Related ticket** | Relation | → Tasks DB |

**Page body per entry:** What was claimed/built · Root cause · Fix · Lesson for the next model.

Create a board view grouped by **Class**, and a view filtered to `Caught by = Vansh` — that
view is the important one. It shows what reached the user unchecked.

**Load all 36 entries** (C-001 … C-036) verbatim from `CORRECTIONS.md`. Do not summarise them;
the wording is the point. Also copy the **"Patterns worth acting on"** section at the foot of
that file into the DB description — it is the single most useful page in the repo for a new
model, and its headline finding is that **the assistant has never once caught its own factual
error; every `Fact` entry was caught by Vansh.**

The four highest-value entries if you must triage: **C-001** (docs-first rejected), **C-029**
(three rounds of out-arguing a seller who was right about his own account), **C-035** (a
confidently-given number that arithmetic showed was unachievable), **C-036** (deleting an
untested experiment because "closed" and "untested" leave the same trace).

---

## 5. Tickets

### Defaults — set once, applies to every ticket below unless overridden

```
Phase: P0
Priority: Medium
Level: L3
Blocked on: —
Contract-touched: false
Segment: Build
```

Only differences are listed per ticket.

---

### ✅ Done — condensed

These shipped and are verified. Create with `Status: Done`, plus the `Completed` date and the
`Left at` line from `TICKET_STATUS.md`, and a one-paragraph body. Full detail lives in the repo;
**do not expand these into sub-tasks.**

**Foundation & form filler**
`WW-001` Research Flipkart + Meesho APIs · Research · L1 · 07-19
`WW-002` Draft architecture docs · Docs · L1 · 07-19 · *rejected — C-001*
`WW-003` Pivot to tools-first rule · Chore · L1 · 07-19
`WW-004` Review partner's Python bots · Research · L2 · 07-20
`WW-005` Playwright scaffold + persistent login · Feature · L2 · 07-20
`WW-006` Fix login cookie detection · Bug · L2 · 07-20 · *C-002*
`WW-007` Fix session lost between commands · Bug · L2 · 07-20 · *C-005*
`WW-008` `npm run scan` field discovery · Feature · 07-20
`WW-009` Fix scan capturing 0/wrong fields · Bug · 07-20 · *C-003*
`WW-010` Fix combobox label regex · Bug · 07-20 · *C-004*
`WW-011` `npm run fill` with read-back verification · Feature · 07-20
`WW-012` Fix false ⚠️ on multi-value fields · Bug · 07-20 · *C-006*
`WW-013` Category defaults + placeholder guard · Feature · L4 · 07-20
`WW-014` `START-HERE.md` non-technical handover · Docs · L4 · 07-20

**Image pipeline**
`WW-016` Research image formats + specs · Research · L5 · 07-21
`WW-017` AI image prompts · Feature · L5 · 07-21
`WW-018` Correct frame-fill + metadata claims · Bug · L5 · 07-21 · *C-007, C-008*
`WW-019` `npm run images` spec gate · Feature · L5 · 07-21 · *C-009, C-010*
`WW-028` Per-image AI descriptions · Feature · L5 · 07-21 · *C-013*
`WW-029` Crop scope + full-flow doc · Feature · L5 · 07-21
`WW-036` Accept `.avif` input · Bug · L5 · 07-21 · *C-017*
`WW-038` Image-pipeline test suite · Feature · L5 · 07-21
`WW-039` Richer image metadata · Feature · L5 · 07-21
`WW-040` Repo cleanup + doc rewrite · Docs · L1 · 07-21
`WW-041` `npm run finish` clean-image shortcut · Feature · L5 · 07-24
`WW-042` Meesho-residue metadata scan · Feature · L5 · 07-24
`WW-043` `npm run check` read descriptions back · Feature · L5 · 07-24
`WW-044` `finish` descriptions-file picker · Feature · L5 · 07-24
`WW-045` Main-image method (read pack → build decoration) · Docs · L5 · 07-24 · *C-020, C-021*
`WW-046` `.png`-save clarity · Docs · L4 · 07-25 · *C-022*
`WW-047` `finish` whole-tree recurse + collision guard + `--square` · Feature · L5 · 07-25
`WW-048` One merged Excel-fed prompt → both JSONs · Docs · L4 · 07-25
`WW-049` Harden the merged prompt after two live runs · Docs · L4 · 07-25 · *C-024*
`WW-050` Hero image must contain only what is in the box · Feature · L5 · 07-25 · *C-026*
`WW-062` Meesho title/description/pack-contents in the one prompt · Feature · L4 · 07-26 · *C-034*
`WW-064` Seller's image advice — piece count, 20px border, 32KB cap · Feature · L5 · 07-26 · *C-035*

**Shipping-fee research — the whole arc, now closed**
`WW-051` What sets Meesho's shipping fee · Research · L4 · 07-25 · *C-027 — conclusion later reversed*
`WW-052` `SHIPPING-COST.md` v1 · Docs · L5 · 07-25 · **Partial** — *superseded, C-028*
`WW-053` Rewrite: Meesho has no dimension fields · Docs · L5 · 07-25 · **Partial** — *superseded*
`WW-054` **Shipping fee = the main image. Settled by experiment** · Research · L5 · 07-25 · *C-029*
`WW-056` **Shipping optimisation — CLOSED, no lever found** · Research · L5 · 07-25
`WW-057` `metaprobe` — does Meesho read image metadata? **No.** · Research · L5 · 07-26

> **Give this arc its own Notion view, grouped by date.** Six tickets, one question, three
> reversals, and the assistant was wrong against Vansh's own account three rounds running
> (C-029). It is the best worked example in the project of *test the live system, don't
> out-argue the person operating it* — and of how much a wrong-but-well-sourced inference costs.

**Project system**
`WW-020` Reframe `docs/architecture/` · Docs · L1 · 07-26 · *resolved by deleting it*
`WW-024` Build tracking pair + corrections ledger · Docs · L1 · 07-21 · *C-011*
`WW-059` Pre-GUI code audit — 4 real defects · Bug · L2 · 07-26
`WW-060` Git: first commit + gitignore correctness · Chore · L1 · 07-26
`WW-065` Pre-GUI trim — dead code + fictional docs · Chore · L3 · 07-26 · *C-036*

---

## ⚠️ Do this first — the two that cost real money or block the partner

### ⛔ WW-055 · `[P0][L5]` Restore the true Net Weight on the live test listing

```
Status: Blocked    Priority: Critical    Type: Chore
Blocked on: Vansh    Affected: meesho-listing, shipping-fee    Segment: Fix
```

**A live listing is currently carrying `Net Weight = 10000 g`** from WW-054's test C. That test
correctly proved declared weight does not move the *displayed* fee — but the field is **not
inert**. The courier weighs the parcel at pickup and Meesho charges the difference back at
settlement, and a 10 kg declaration sitting on a live listing is also a compliance problem.

**Sub-tasks**
- [ ] Revert that listing to the true packed weight
- [ ] **Weigh one sealed kit on a kitchen scale.** The `160 g` used elsewhere looks
      under-declared for 40 latex balloons (~120 g) + pump (~60 g) + banner + 16 cutouts + LED
      — likely 300–400 g
- [ ] Photograph the packed parcel on the scale (weight-discrepancy charges are disputable in a
      ~7-day window, and evidence is what wins)

**Why Critical.** The only open item in the project that can cost money if left alone.
Under-declaring buys nothing — it doesn't lower the displayed fee either.

---

### ⬜ WW-061 · `[P0][L2]` `ensureProfileFree()` is macOS-only — silently no-ops on Windows

```
Status: Not started    Priority: Critical    Type: Bug
Affected: login/session, windows-build    Segment: Fix
```

**Blocks the Windows app, and it hits the partner but never Vansh.** `connect.ts` finds leftover
Chrome processes with `ps -A -o pid=,command=`, which doesn't exist on Windows: it throws, the
error is caught, `pids` stays empty, cleanup silently does nothing. The symptom is the single
most confusing one that function exists to prevent — **Chrome opens with no session, which is
indistinguishable from "it logged me out"** even though the cookies are saved and valid.

**Sub-tasks**
- [ ] Add a `tasklist`/WMI branch alongside the `ps` one
- [ ] **Test on the real Windows machine — do not assume.** This is the whole point of the ticket
- [ ] Confirm the session survives a force-quit → relaunch cycle on Windows

*Already fixed in passing:* `execSync("sleep 0.3")` (also Windows-only) → cross-platform
`Atomics.wait`; the `SingletonLock` cleanup was already portable.

---

## The GUI pivot — the current build order

New tickets, 2026-07-26. Vansh's business partner is non-technical, works on **Windows**, and
cannot run terminal commands. The whole toolkit becomes an Electron desktop app. Sequence agreed
with Vansh; **do not reorder and do not build ahead** — C is deliberately early so install
problems surface while the app still does one thing.

### ⬜ WW-066 · `[P0][L4]` A · Make the engine callable from something other than a terminal

```
Status: Not started    Priority: Critical    Type: Chore
Affected: flipkart-autofill, images, finish, check, gui/electron
Contract-touched: true    Segment: Build
```

**Goal.** Every file in `src/` does argv parsing, `console.log` and `process.exit` **inside
`main()`**, so none of it can be driven by a GUI. Split each into a core function — options in,
structured result out, progress callback — with the existing CLI kept as a thin wrapper.

**Sub-tasks**
- [ ] `images.ts` and `finish.ts` first — they carry the worst signatures: `processOne()` takes
      **10 positional args**, `finishOne()` takes 8. Convert to an options object *before*
      wiring any UI to them; this is where a GUI bug would hide
- [ ] Return structured rows + notes instead of printing them; the CLI formats, the GUI renders
- [ ] Progress callback so a UI can show per-image state
- [ ] **No behaviour changes.** All 61 tests, `npm run verify`, and every `npm run …` must pass
      unchanged — they are the proof the refactor changed nothing
- [ ] `paths.ts` and `encode.ts` are already extracted this way — follow their shape

**Definition of Done.** A plain Node script can run the full image pipeline and read results as
data, with no stdout parsing, and the test suite is untouched.

---

### ⬜ WW-067 · `[P0][L5]` B · Electron shell + tab 1 (AVIF → JPG/PNG)

```
Status: Not started    Priority: High    Type: Feature
Affected: gui/electron, images    Segment: Build
```

**Goal.** The smallest genuinely useful thing to hand the partner: a window, a tab bar,
drag-and-drop a folder, pick output format + quality, see thumbnails and per-file results.

**Sub-tasks**
- [ ] Window + tab bar shell (tabs 2-6 present but disabled)
- [ ] Drag-and-drop a folder; list what was found before doing anything
- [ ] Format + quality controls; show the 5 MB cap step-down when it fires
- [ ] Thumbnails + a result row per image, warnings included (soft source, Meesho residue)
- [ ] `docs/samples/2.avif` is the test input

**Definition of Done.** The partner converts a real folder of `.avif` downloads without typing a
command.

---

### ⬜ WW-068 · `[P0][L4]` C · CI build → the real Windows `.exe`

```
Status: Not started    Priority: High    Type: Chore
Affected: windows-build, gui/electron    Segment: Build
```

**Goal.** Get an unsigned installer into the partner's hands via GitHub Actions **while the app
still does one thing.** Finding out about install problems now beats finding out after six tabs
are built.

**Sub-tasks**
- [ ] GitHub Actions job producing an unsigned Windows `.exe`
- [ ] **Verify `sharp`'s native binary ships correctly** — the most likely packaging failure
- [ ] Confirm data folders resolve inside a packaged app (cwd is `/`, not the project — this was
      the WW-059 blocker; `paths.ts` should already handle it, but prove it *in the packaged app*)
- [ ] Partner installs it on his own machine and reports back
- [ ] Document the SmartScreen warning an unsigned build shows, so it doesn't read as a virus

**Definition of Done.** The partner has a working installed app on Windows, from a CI artifact.

---

### ⬜ WW-069 · `[P0][L5]` D · The remaining tabs

```
Status: Not started    Priority: Medium    Type: Feature
Affected: gui/electron, login/session, images, finish, check, fill    Segment: Build
```

**Goal.** In this order: **Flipkart login** → **prepare images** → **finish** → **check** →
**fill listing**.

**Sub-tasks**
- [ ] Login tab with a **live "you're logged in" indicator** instead of the terminal's dots — and
      it must distinguish *logged out* from *not yet navigated* (see WW-061's failure mode)
- [ ] Prepare-images tab (`images.ts`: crop / erase-tag / `--final`)
- [ ] Finish tab, including the descriptions-file picker from WW-044
- [ ] Check tab — read embedded descriptions back
- [ ] Fill-listing tab **last.** It drives a real browser against a live form; the read-back
      ✅/⚠️/⏭️ report must survive into the UI intact, and **nothing may auto-save while any
      field reads ⚠️**

**Definition of Done.** The partner lists one product end to end without a terminal.

---

## Open — everything else

### ⬜ WW-015 · `[P0][L4]` Verify Price/Stock/Shipping tab against the real form

```
Status: Not started    Priority: Critical    Type: Bug
Affected: flipkart-autofill, fill, flipkart-listing    Segment: Fix
```

**Goal.** The Additional Description tab is tested and working. The Price/Stock/Shipping tab has
**never been run against the live Flipkart form** — its field names came from an older script and
are unverified.

**Sub-tasks**
- [ ] Open the Price, Stock and Shipping tab on a real listing
- [ ] Run `npm start` on the same product; capture the full ✅/⚠️/⏭️ output
- [ ] Correct every field name that reports ⚠️ or ⏭️
- [ ] Re-run until clean — **only then** allow it to save

**Definition of Done.** One real listing completed end-to-end across both tabs, saved, visible in
Seller Hub.

> **Highest-risk open item in the listing path.** Everything else there is verified; this is not.

---

### ⬜ WW-063 · `[P0][L4]` Deterministic validator for the `meesho` block

```
Status: Not started    Priority: High    Type: Feature
Affected: meesho-copy, product-json    Segment: Build
```

Every rule WW-062 put in the prompt is mechanically checkable — char counts, double spaces,
commas in `pack_contents`, banned promo words, contact details, what the first 40 characters
carry. Per `CLAUDE.md` the deterministic half validates and Claude only writes copy, so this
belongs in code rather than the prompt's honour system.

**Sub-tasks**
- [ ] `npm run meesho -- --id=<ID>`: print the three values ready to copy, flag every violation
- [ ] Char limits are **unverified** (C-034) — treat them as warnings, not hard failures, until
      WW-022's template settles them
- [ ] Becomes a GUI tab under WW-069

---

### ⬜ WW-027 · `[P0][L6]` ANP/GTB prefix presets

```
Status: Not started    Priority: High    Type: Feature
Affected: category-defaults, product-json, images
```

Kit types have short codes — `ANP` (Annaprashan), `GTB` (Groom-To-Be). A product ID like
`ANP-1042` should pre-fill every field shared by all Annaprashan kits, on both marketplaces.

**Sub-tasks**
- [ ] One defaults file per prefix, layered over the existing category defaults
- [ ] Resolution order: prefix preset → category defaults → product `.json` (most specific wins)
- [ ] `images`/`finish` already key off the same ID — reuse it
- [ ] Document precedence in `START-HERE.md`

**Definition of Done.** Two kits of the same prefix listed with no duplicated field entry.

---

### ⬜ WW-034 · `[P0][L5]` Test whether Meesho rejects non-square uploads

```
Status: Not started    Priority: Low    Type: Research    Segment: Research
```

Settles C-014. Blogs say non-square is rejected; a live selling Meesho listing runs 512×212.
Upload a deliberately non-square test image in the Supplier Panel and see if it is refused. We
use square anyway — it costs nothing — so this is about retiring a contested claim, not changing
behaviour.

---

### ⛔ Blocked on Vansh — all cheap, high value

| ID | Ask | Why it matters |
|---|---|---|
| **WW-022** `[L5]` · Research · **Critical** | Download the balloon/party **category Excel template** from the Meesho Supplier Panel and send the **Guidelines sheet** | Every image spec currently cited comes from third-party blogs that contradict each other. One was wrong *and inverted* (C-007), another unsupported (C-008). This sheet is category-specific and authoritative — **it removes the whole class of error**, and settles WW-063's char limits too |
| **WW-035** `[L5]` · Chore · **Critical** | Get **higher-resolution originals** from the partner, or reshoot | Website downloads are 512×512 — half the 1000px zoom threshold. **No software fix exists** (C-018). Highest business impact of anything open |
| **WW-021** `[L5]` · Feature · High | Send **3–4 raw `.avif` downloads** from different listings and sizes | `--crop-bottom=N` and `--erase-tag=w,h` both exist but `N` has never been measured against real files. (Ticket text says `.webp`; Meesho actually serves `.avif` — C-017) |
| **WW-037** `[L5]` · Research · Medium | Run the live metadata round-trip | **Do NOT upload `docs/samples/METADATA-TEST-upload-this.jpg` as-is** — it is the partner's image with the Meesho tag still on it, so uploading is a duplicate. Correct order: run the full pipeline on a real product, upload *that*, download the served `.avif`, check whether the description survived. Settles WW-023 |
| **WW-023** `[L5]` · Research · Medium | Blocked on WW-037 | **Still open — and not answered by WW-057.** WW-057 proved metadata doesn't move the *shipping fee*. Whether it survives upload and affects *orders/SEO* is a different question. Measured so far: Meesho's `.avif` **does** carry EXIF, and `YCbCrPositioning` suggests pass-through from the original upload (C-019) |

> **The border test, if you want one more cheap experiment.** `--border=20` exists in both image
> tools, off by default. It is the **one axis the fourteen shipping tests never varied**, and the
> metadata probe proved the estimator is deterministic and noise-free — so a two-image A/B settles
> it in one sitting, no averaging. One caution from the existing data: making the product smaller
> in frame has already failed twice (V5 tiny-in-frame ₹69 vs V1's ₹63; V8 floating-on-white ₹256).
> A 20 px frame on 1500 px is a 1.3% margin, nothing like V5's 30%, so it isn't the same test —
> but don't assume the direction is favourable. **Read the fee before submitting either way.**

---

### ⚠️ WW-058 · `[P0][L4]` Inventory CSV + Notion inventory build spec — **Partial**

```
Status: Partial    Priority: Medium    Type: Docs
Blocked on: Vansh    Affected: docs, project-system    Segment: Documenting help
```

**Done.** Diagnosed the "fields aren't responding" report down to **one cell**: the Banner row
has an empty `specific material`, its VLOOKUP returns `#N/A`, and that propagates through the SUM
into `SKU Cost = #VALUE!`. Nothing else was broken. Also diagnosed the "properties didn't come
with it" complaint — **a Google Sheets CSV export is one tab only** and carries no formulas and
no dropdown lists, only last-computed values. Cleaned to `inventory for distribution -
Dropdown.clean.csv` (10 real lines; quantities sum to **88**, matching the sheet's own total).
Confirmed "cost of material" is a **line** cost, not a unit cost (20 balloons = ₹16 → ₹0.80 each).

**Still open — and this is the important half.** The tab exported was **Dropdown** (the kit
builder), **not `inventory calculation`** — the stock master Vansh called the most important one.
Unit costs in the spec are therefore derived, and stock/reorder columns are guesses.

**Sub-tasks**
- [ ] **Vansh: export the `inventory calculation` tab** (its own `gid`)
- [ ] Fill the Banner row's `specific material` so the sheet stops erroring at source
- [ ] Then build the 3 databases below

**The inventory DBs (build these once the right tab is in hand).** `docs/guides/NOTION-INVENTORY-SETUP.md`
was deleted 2026-07-26 with the rest of the Notion ceremony; its design is preserved here because
this ticket is still open:

| DB | Holds | Key point |
|---|---|---|
| **Materials** (master) | one row per raw material, with **unit** cost | the thing the spreadsheet lacked |
| **Kits** (per-SKU) | one row per sellable kit, rollup of its line costs | replaces `SKU Cost` |
| **Kit Lines** (junction) | kit × material × quantity | replaces VLOOKUP + SUM with relations + rollups |

Seed from **MKU003**. **Add a `Cost complete` checkbox** on Kits — Notion rollups *skip* blanks
rather than erroring, so a missing material cost would silently under-total, where the spreadsheet
at least screamed `#VALUE!`. That is a real regression risk in moving off Sheets, and the flag is
the guard.

---

### ⬜ Project-system leftovers

| ID | Title | Note |
|---|---|---|
| **WW-025** `[L1]` · Chore · Low | Wire the three maintenance triggers into `CLAUDE.md` | Post-commit hook, on-compaction refresh, on-demand "new status". **Reconsider whether this is wanted at all** — its spec file (`ADOPT_THIS_SYSTEM copy.md`) was deleted 2026-07-26 as unused ceremony, and Vansh's standing rule is speed over ceremony. Each trigger would have to show proposed updates and wait for approval |
| **WW-026** `[L1]` · Docs · Low | Backfill `docs/tracks/LEVELS.md` | Never existed. Every `Level` value on every ticket is a provisional guess. Low priority precisely because nothing depends on it |

---

### Phase 1+ — do not build ahead

| ID | Title | Phase | Status |
|---|---|---|---|
| `WW-031` | Meesho bulk-upload Excel generator | P0 · L6 | ⬜ — depends on WW-022's template |
| `WW-030` | Combo Generator | P1 · L1 | ⬜ |
| `WW-032` | Flipkart price/stock/orders API sync | P2 | ⬜ |
| `WW-033` | Intelligence dashboard | P3 | ⬜ — **deprioritised** by the 2026-07-21 reframe |

---

## 6. Documentation DB

One page per subsystem. Each page: file map · dependencies · what breaks if you change it ·
copy-ready commands. Update after any code change that alters its file map or behaviour.

| Page | Covers | Status |
|---|---|---|
| **flipkart-autofill** | `src/` file map, the scan→fill loop, why label-targeting beats keyboard macros (learning 1), category-defaults precedence, `verify-engine.ts` | Live |
| **Image pipeline** | `images.ts` 3-folder flow, squaring rules, the two sharp gotchas (C-009, C-010), `paths.ts` + `encode.ts` shared modules | Live |
| **finish / check** | The clean-image shortcut, whole-tree recursion, the position-collision guard, reading EXIF back | Live |
| **AI prompts** | The single merged Excel-fed prompt (66 fields + per-image descriptions + Meesho copy), why counts come from inventory and never from AI re-counting | Live |
| **Marketplace specs** | Formats, dimensions, colour space — **with source and confidence per row** | Live, contested — WW-022 |
| **Meesho copy contract** | title / description / pack_contents rules and their rejection triggers | Live, limits unverified — C-034 |
| **Shipping fee** | Settled: the main image sets it, deterministically, and it cannot be steered. **Exists to stop anyone re-running the 14 tests** | Live, closed |
| **Product `.json` contract** | Field names, defaults layering, placeholder guard, the `meesho` block | Live |
| **GUI app** | Electron shell, tab map, the core/CLI split from WW-066, Windows packaging notes | Planned — WW-066…069 |

---

## 7. Learning DB

One page per `docs/learning/` note, with **concepts-to-master checkboxes** and **interview
questions** (answers in toggles).

| Page | From |
|---|---|
| **Label targeting over keyboard macros** | `docs/learning/1-…` |
| **The `finish` shortcut for clean images** | `docs/learning/2-…` |
| **One-command regimes beat flag soup** | `docs/learning/3-…` |
| **Meesho's shipping fee is set by the main image** | `docs/learning/4-…` — *and cannot be steered* |
| **"Closed" and "untested" look identical to a deletion pass** | `docs/learning/5-…` — C-036 |
| **Deterministic gate, generative middle** | New — code enforces specs, AI does creative work |
| **Verify against the real artifact** | New — C-002…C-006. A false green costs more than a red |
| **Source your facts** | New — C-007, C-008. Search summaries are not sources; open the page |
| **The operator is the instrument** | New — C-029. When someone running the system reports what it does, they are the measurement and you are the hypothesis |

Suggested interview questions:
- *Why does `fill` read every value back after typing it?*
- *Why is the image tool run after the AI edit rather than before?*
- *A blog says Flipkart requires CMYK. What do you do?*
- *Which of the project's factual errors were caught by the assistant itself?* (None.)
- *The shipping fee is proven to be set by the main image. Why is that not actionable?*
- *A flag exists for an experiment nobody has run. Is it dead code?* (No — see C-036.)

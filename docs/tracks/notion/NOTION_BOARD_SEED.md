# NOTION_BOARD_SEED — WishWorks Seller OS

> **You are a Claude with the Notion MCP connected to Vansh's WishWorks workspace.** The
> repo-aware session cannot reach it (its MCP points at a different account/project), so it
> wrote this file for you. Everything you need is here — do not ask the repo for more.
>
> **Order of operations:**
> 1. Create the **Segments** DB (§2) — 6 lenses.
> 2. Create the **Tasks** DB with the schema in §3, then create every ticket in §5.
> 3. Create the **Corrections** DB (§4) and load C-001…C-011 from `CORRECTIONS.md`.
> 4. Create the **Documentation** DB (§6) and **Learning** DB (§7).
> 5. Apply `NOTION_SYNC.md`, then report back what you created.
>
> Scope: **P0 (current) + P1 (next)** only. Do not create P2/P3 detail.

---

## 1. What this project is

**WishWorks Seller OS.** Internal automation for a balloon & party-supplies business selling
on **Flipkart** and **Meesho**.

**Goal (user-set, 2026-07-21):** automate our listing work, understand both marketplaces
properly, and make selling easier. **Not** a data-analytics or seller-intelligence platform —
that framing was explicitly deprioritised.

**Hard constraints — do not re-litigate:**
- No API can create a new product. Flipkart needs an existing FSN; Meesho has no public API.
  Listing creation is therefore generate → validate → human review → upload.
- Deterministic code computes scores and enforces specs. **AI only writes copy and edits
  images** — it never enforces a rule and never invents attribute values.
- Money = integer paise. Timestamps = UTC.

**Working style:** speed over ceremony. No roles, no tracks, lean docs. Tools first, docs
second — an architecture-doc-first approach was tried and rejected (see C-001).

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
| **Status** | Select | `Not started` · `In progress` · `Done` · `Blocked` |
| **Priority** | Select | `Critical` · `High` · `Medium` · `Low` |
| **Type** | Select | `Feature` · `Bug` · `Research` · `Docs` · `Chore` |
| **Phase** | Select | `P0` · `P1` · `P2` · `P3` |
| **Level** | Select | `L1` … `L6` (provisional — `docs/tracks/LEVELS.md` doesn't exist yet) |
| **Segment** | Relation | → Segments DB |
| **Affected** | Multi-select | see palette below |
| **Contract-touched** | Checkbox | ticks when a file format or field schema changes |
| **Blocked on** | Select | `—` · `Vansh` · `Flipkart` · `Meesho` |
| **Completed** | Date | |
| **Left at** | Text | one line: exactly where it stands |

**`Affected` palette — derived from this project's actual surfaces:**

`flipkart-autofill` · `scan` · `fill` · `login/session` · `images` · `category-defaults` ·
`product-json` · `prompts` · `flipkart-listing` · `meesho-listing` · `image-specs` ·
`marketplace-seo` · `docs` · `project-system`

---

## 4. Corrections DB — **non-standard, WishWorks-specific**

Vansh asked for every mistake and its correction to be tracked, so a future more capable
model can be handed the whole trail and diagnose the failure patterns. Source of truth:
`docs/tracks/notion/CORRECTIONS.md`.

| Property | Type | Options |
|---|---|---|
| **Name** | Title | `C-00n · <one-line description>` |
| **Class** | Select | `Design` · `Code` · `Fact` · `Process` |
| **Caught by** | Select | `Vansh` · `Assistant (own test)` · `Tooling` |
| **Status** | Select | `Fixed` · `Withdrawn` · `Open` |
| **Date** | Date | |
| **Cost** | Text | time and/or trust |
| **Related ticket** | Relation | → Tasks DB |

**Page body per entry:** What was claimed/built · Root cause · Fix · Lesson for the next model.

Create a board view grouped by **Class**, and a view filtered to `Caught by = Vansh` — that
view is the important one. It shows what reached the user unchecked.

**Load all 11 entries** (C-001 … C-011) verbatim from `CORRECTIONS.md`. Do not summarise
them; the wording is the point.

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

These shipped and are verified. Create them with `Status: Done`, the `Completed` date and
`Left at` line from `TICKET_STATUS.md`, and a one-paragraph body. Full detail lives in the
repo; do not expand them.

`WW-001` Research Flipkart + Meesho APIs · Research · L1 · 2026-07-19
`WW-002` Draft architecture docs · Docs · L1 · 2026-07-19 · *rejected — see C-001*
`WW-003` Pivot to tools-first rule · Chore · L1 · 2026-07-19
`WW-004` Review partner's Python bots · Research · L2 · 2026-07-20
`WW-005` Playwright scaffold + persistent login · Feature · L2 · 2026-07-20
`WW-006` Fix login cookie detection · Bug · L2 · 2026-07-20 · *C-002*
`WW-007` Fix session lost between commands · Bug · L2 · 2026-07-20 · *C-005*
`WW-008` `npm run scan` field discovery · Feature · 2026-07-20
`WW-009` Fix scan capturing 0/wrong fields · Bug · 2026-07-20 · *C-003*
`WW-010` Fix combobox label regex · Bug · 2026-07-20 · *C-004*
`WW-011` `npm run fill` with read-back verification · Feature · 2026-07-20
`WW-012` Fix false ⚠️ on multi-value fields · Bug · 2026-07-20 · *C-006*
`WW-013` Category defaults + placeholder guard · Feature · L4 · 2026-07-20
`WW-014` `START-HERE.md` non-technical handover · Docs · L4 · 2026-07-20
`WW-016` Research image formats + specs · Research · L5 · 2026-07-21
`WW-017` AI image prompts (Step 0 / A / B) · Feature · L5 · 2026-07-21
`WW-018` Correct frame-fill + metadata claims · Bug · L5 · 2026-07-21 · *C-007, C-008*
`WW-019` `npm run images` spec gate · Feature · L5 · 2026-07-21 · *C-009, C-010*
`WW-024` Build tracking pair + corrections ledger · Docs · L1 · 2026-07-21 · *C-011*

---

### ⬜ WW-015 · `[P0][L4]` Verify Price/Stock/Shipping tab against the real form

```
Status: Not started    Priority: Critical    Type: Bug
Affected: flipkart-autofill, fill, flipkart-listing
```

**Goal.** The Additional Description tab is tested and working. The Price/Stock/Shipping tab
has **never been run against the live Flipkart form** — its field names came from an older
script and are unverified.

**Sub-tasks**
- [ ] Open the Price, Stock and Shipping tab on a real listing
- [ ] Run `npm start` on the same product; capture the full ✅/⚠️/⏭️ output
- [ ] Correct every field name that reports ⚠️ or ⏭️
- [ ] Re-run until the output is clean
- [ ] Only then allow it to save

**Clear criteria.** A full run on the live form with zero ⚠️ and no unexpected ⏭️.

**Definition of Done.** One real listing completed end-to-end across both tabs, saved, and
visible in Seller Hub.

> **Highest-risk open item in the project.** Everything else is verified; this is not.
> Do not let it save until a run comes back clean.

---

### ⬜ WW-020 · `[P0][L1]` Reframe `docs/architecture/` away from data-analytics

```
Status: Not started    Priority: High    Type: Docs
Affected: docs, project-system    Segment: Documenting help
```

**Goal.** Vansh reset the project's purpose on 2026-07-21: this is about automation and
understanding the marketplaces, not analytics. `docs/architecture/` still describes a seller
intelligence platform with a dashboard endpoint.

**Sub-tasks**
- [ ] Re-read `docs/architecture/1-overview.md` and `7-roadmap.md`
- [ ] Propose the reframe to Vansh **and wait for approval** — do not rewrite unilaterally
- [ ] Rewrite overview + roadmap around: Listing Factory → marketplace understanding → ops
- [ ] Mark the dashboard (P3) explicitly deprioritised, not deleted
- [ ] Update `CLAUDE.md`'s "What this is" paragraph to match

**Clear criteria.** A new reader gets "automate listings, understand Flipkart/Meesho" from
the first paragraph.

**Definition of Done.** Architecture docs and `CLAUDE.md` agree with the 2026-07-21 framing.

---

### ⬜ WW-025 · `[P0][L1]` Wire the three maintenance triggers into `CLAUDE.md`

```
Status: Not started    Priority: Medium    Type: Chore
Affected: project-system    Segment: Documenting help
```

**Goal.** `ADOPT_THIS_SYSTEM copy.md` §7c requires three refresh triggers. None are wired.

**Sub-tasks**
- [ ] Post-commit hook in `.claude/settings.json` (the PostToolUse `git commit` hook from §5d)
- [ ] On-compaction refresh instruction in `CLAUDE.md`
- [ ] "new status" on-demand regeneration instruction
- [ ] Each must **show proposed updates and wait for approval** before writing

**Definition of Done.** A commit triggers a proposed `TICKET_STATUS.md` update automatically.

---

### ⬜ WW-026 · `[P0][L1]` Backfill `docs/tracks/LEVELS.md`

```
Status: Not started    Priority: Low    Type: Docs
Affected: project-system    Segment: Documenting help
```

**Goal.** `docs/tracks/` had no contents until 2026-07-21. Level values on every ticket are
provisional guesses.

**Sub-tasks**
- [ ] Reconstruct levels from what's already built, marking cleared work `Done`
- [ ] Phase-tag each level
- [ ] Reconcile the `Level` property on all existing tickets

---

### ⛔ WW-021 · `[P0][L5]` Measure the Meesho watermark crop offset

```
Status: Blocked    Priority: High    Type: Feature
Blocked on: Vansh    Affected: images, image-specs
```

**Goal.** Meesho stamps a tag at the bottom-left of catalog images. Vansh crops it by hand
on every image, which leaves inconsistent non-square sizes. `npm run images --crop-bottom=N`
exists but `N` has never been measured against real files.

**Sub-tasks**
- [ ] **Vansh: send 3–4 raw `.webp` downloads** from different listings and different sizes
- [ ] Measure the tag's position on each
- [ ] Determine fixed-pixel offset vs percentage of height
- [ ] Set the default; show before/after for approval

**Clear criteria.** The tag is gone on all sample images with no product clipped.

---

### ⛔ WW-022 · `[P0][L5]` Replace blog-sourced specs with the category template's Guidelines sheet

```
Status: Blocked    Priority: Critical    Type: Research
Blocked on: Vansh    Affected: image-specs, marketplace-seo, docs
```

**Goal.** Every number in `docs/image-playbook.md` comes from third-party blogs that
contradict each other. One such number was already wrong **and inverted** (C-007), and
another claim was unsupported (C-008). The Guidelines sheet inside the category Excel
template from the Meesho Supplier Panel is category-specific, current, and authoritative.

**Sub-tasks**
- [ ] **Vansh: download the balloon/party category template and send the Guidelines sheet**
- [ ] Replace the spec table with its values
- [ ] Mark each remaining spec with its source type and confidence
- [ ] Log any further corrections in `CORRECTIONS.md`

**Clear criteria.** No number in the playbook rests on a blog when an official value exists.

> **Priority Critical for a reason.** Two of the three factual errors in this project came
> from blog-sourced image specs. This ticket removes the whole class of error.

---

### ⛔ WW-023 · `[P0][L5]` Resolve the image-metadata question

```
Status: Blocked    Priority: Medium    Type: Research
Blocked on: Vansh    Affected: marketplace-seo, images
```

**Goal.** A seller known to Vansh's partner adds descriptions/tags to image metadata and
reports notably more orders. The assistant claimed this does nothing; that claim was
unsupported and withdrawn (C-008). The question is genuinely open.

**Sub-tasks**
- [ ] **Vansh: ask him one question — "the image file's metadata, or text printed on the
      picture?"** These are completely different tactics that sound identical
- [ ] If metadata: test on 2 listings and compare against 2 controls
- [ ] If on-image text: fold into the Prompt B infographic workflow, which already does this
- [ ] Update the playbook with the answer either way

**Note.** `npm run images` already writes ImageDescription from the product's Model Name and
Search Keywords. Free, zero policy risk. Do not build strategy on it until confirmed.

---

### ⬜ WW-031 · `[P0][L6]` Meesho bulk-upload Excel generator

```
Status: Not started    Priority: Medium    Type: Feature
Affected: meesho-listing, product-json    Contract-touched: true
```

**Goal.** Meesho has no API — listings go up via the Supplier Panel's category Excel
template. Generate that sheet from the same product `.json` the Flipkart filler uses.

**Sub-tasks**
- [ ] Depends on WW-022 (the template must be in hand)
- [ ] Map product `.json` fields → template columns
- [ ] Generate with `exceljs`; never overwrite mandatory columns blindly
- [ ] Validate before write; refuse on missing mandatory fields, like WW-013 does

**Definition of Done.** One catalog uploaded to Meesho from a generated sheet with no manual
editing.

---

### ⬜ WW-027 · `[P0][L6]` ANP/GTB prefix presets

```
Status: Not started    Priority: High    Type: Feature
Affected: category-defaults, product-json, images
```

**Goal.** Vansh's kit types have short codes — `ANP` (Annaprashan), `GTB` (Groom-To-Be), etc.
A product ID like `ANP-1042` should pre-fill every field shared by all Annaprashan kits, on
both marketplaces, so only the genuinely per-product fields remain.

**Sub-tasks**
- [ ] One defaults file per prefix, layered over the existing category defaults
- [ ] `fill` resolves prefix → preset → category defaults → product `.json` (most specific wins)
- [ ] `images` already keys off the same ID — reuse it
- [ ] Document the precedence order in `START-HERE.md`

**Clear criteria.** A new ANP kit needs only its name, counts, description and dimensions.

**Definition of Done.** Two kits of the same prefix listed with no duplicated field entry.

---

### ⬜ WW-030 · `[P1][L1]` Combo Generator

```
Status: Not started    Priority: Low    Type: Feature    Phase: P1
```

**Goal.** Generate new combo ideas worth listing. **P1 — do not build ahead.** Gated on P0
being genuinely done (`docs/architecture/7-roadmap.md`).

---

## 6. Documentation DB

One page per subsystem. Start each `Status: Planned` unless noted.

| Page | Covers | Status |
|---|---|---|
| **flipkart-autofill** | `src/` file map, the scan→fill loop, why label-targeting beats keyboard macros, category defaults precedence | Live |
| **Image pipeline** | `src/images.ts`, the inbox→ready flow, squaring rules, the two sharp gotchas (C-009, C-010) | Live |
| **AI prompts** | Step 0 / Prompt A / Prompt B, why counts are hand-checked, why the model is never asked for a pixel size | Live |
| **Marketplace specs** | Image formats, dimensions, colour space — **with source and confidence per row** | Live, contested — see WW-022 |
| **Product `.json` contract** | Field names, defaults layering, placeholder guard | Live |

Each page: file map · dependencies · what breaks if you change it · copy-ready commands.
Update after any code change that alters its file map, dependencies or behaviour.

---

## 7. Learning DB

One page per `docs/learning/` concept, with **concepts-to-master checkboxes** and **interview
questions** (answers in toggles).

| Page | From |
|---|---|
| **Label targeting over keyboard macros** | `docs/learning/1-label-targeting-over-keyboard-macros.md` |
| **Deterministic gate, generative middle** | New — code enforces specs, AI does creative work. Applies to both the filler and the image tool |
| **Verify against the real artifact** | New — from C-002…C-006 and the memory note. A false green costs more than a red |
| **Source your facts** | New — from C-007, C-008. Search summaries are not sources; open the page |

Suggested interview questions for the last two:
- *Why does `fill` read every value back after typing it?*
- *Why is the image tool run after the AI edit rather than before?*
- *A blog says Flipkart requires CMYK. What do you do?*
- *Which of the project's factual errors were caught by the assistant itself?* (None.)

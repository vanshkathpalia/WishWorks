# NOTION_SYNC — delta to apply in Notion

> **How to use.** Paste this whole file into a Claude that has the Notion MCP connected to
> the **WishWorks** workspace (not the one connected to this repo's Claude Code session —
> that account is a different project). It applies the changes below, then this file resets
> to "nothing pending."
>
> **Overwritten in full at each sync point.** Never append. Per `ADOPT_THIS_SYSTEM copy.md` §7a.

**Sync generated:** 2026-07-21 (end of session)
**Covers:** project start (2026-07-19) → 2026-07-21. **First sync — the board does not exist yet.**

---

## ⚠️ First-time setup

The Tasks / Documentation / Learning / Corrections DBs have never been created for WishWorks.
**Build the board from [`NOTION_BOARD_SEED.md`](NOTION_BOARD_SEED.md) first** — it has the full
property schema and every ticket written out. Then apply the delta below.

---

## 1. Tickets — 40 total

Create every ticket from `NOTION_BOARD_SEED.md`, with Status from
[`TICKET_STATUS.md`](TICKET_STATUS.md) (the authoritative ledger).

| Status | Count | Notes |
|---|---|---|
| ✅ Done | 27 | The full P0 build: autofill bot, image pipeline, test suite, docs |
| ⬜ Not started | 5 | WW-015 (Critical), WW-020, WW-025, WW-026, WW-034 |
| ⛔ Blocked on Vansh | 4 | WW-021, WW-022 (Critical), WW-035 (Critical), WW-037 |
| ⬜ Future phase | 4 | WW-030 (P1), WW-031, WW-032 (P2), WW-033 (P3) |

`Phase = P0` on everything except WW-030 (P1), WW-032 (P2), WW-033 (P3).

**Surface these four on the default board view — every one is cheap and blocking:**

| Ticket | What Vansh needs to do | Why it matters |
|---|---|---|
| **WW-035** 🔴 | Get full-resolution originals from his partner | Website downloads are 512×512 — half the zoom threshold. Caps the quality of every listing. No software fix exists |
| **WW-022** 🔴 | Send the balloon-category Excel template's Guidelines sheet | Replaces every blog-sourced spec with an authoritative one. Blog specs have been wrong 3× |
| **WW-015** 🔴 | Run the Price/Stock/Shipping tab against the live form | Only untested part of the autofill bot |
| **WW-037** | Run a real product through the pipeline, upload, download the `.avif`, check the description survived | Settles the metadata question, open since day one |

## 2. Corrections DB — 19 entries

Load C-001 … C-019 verbatim from [`CORRECTIONS.md`](CORRECTIONS.md). Do not summarise; the
wording is the point.

Create a view filtered to **`Caught by = Vansh`** — that view is the important one. It shows
what reached the user unchecked.

**Highest-signal entries:**
- **C-007** — frame-fill percentage stated wrong *and inverted*; caught against live listings.
- **C-010** — image tool output was not square; its core promise, silently broken.
- **C-013** — built a feature ignoring a requirement Vansh had stated twice.
- **C-016 → C-019** — the metadata question answered confidently and wrongly, twice, in
  opposite directions. Read as a pair.
- **C-017/C-018** — the tool couldn't read `.avif`, the only format Meesho actually serves;
  and real downloads are 512×512.

**The pattern worth putting on the board:** every `Fact`-class error was caught by Vansh, none
by the assistant. Code bugs were caught by tests; factual claims were not.

## 3. Board overview page

> **WishWorks Seller OS.** Automate listing work for a balloon & party-supplies business on
> Flipkart and Meesho. Understand both marketplaces properly and make selling easier.
> Analytics/dashboards are **deprioritised** (user-set, 2026-07-21).

## 4. Documentation + Learning DBs

Per `NOTION_BOARD_SEED.md` §6 and §7. Mark the image-pipeline and AI-prompt pages **Live**;
the marketplace-specs page **Live, contested** (pending WW-022).

---

## Notes for the Notion-connected Claude

- Ticket titles omit `[ROLE]` on purpose — Vansh ruled out roles/tracks on 2026-07-19.
- `docs/tracks/LEVELS.md` doesn't exist yet (WW-026); `Level` values are provisional.
- The repo is the source of truth. If Notion and `TICKET_STATUS.md` disagree, the repo wins.

---

## Pending after this sync

**Nothing — this file resets to empty once applied.**

Next sync point: when Vansh says "done for the day" or "new status".

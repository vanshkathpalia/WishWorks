# GUI spec — what the Windows app must do

> **Status: NOT BUILT.** This is the spec, not a description. Tickets: WW-066 → WW-069.
> Keep it in sync with `docs/tracks/notion/TICKET_STATUS.md`; that file remains the source of
> truth for status, this one for *what goes in the app and why*.

## Who it is for

Vansh's business partner. Non-technical, on **Windows**, cannot use a terminal. Vansh is on a
Mac, so the app must be built and tested for a machine the author does not use — that is a real
risk, not a footnote (see WW-061, a Windows-only bug that has already bitten).

## Why, honestly

The obvious reason is "the partner can't use `npm run …`". That is true and it is the weaker
reason. The stronger one, earned on **2026-07-27**:

> **The CLI let its own author silently produce wrong files — twice in one day.**
>
> - **WW-077** — `npm run images -- --final` embedded no descriptions at all when a folder name
>   did not match its JSON. The images came out looking perfect. The only signal was one line
>   inside a results table, printed *after* the files were written.
> - **WW-078** — `npm run finish` asked *"which descriptions file for GTB 1?"*, offered `ANP-1`,
>   and when picked wrote **Annaprashan descriptions into Groom-To-Be photos and named the
>   output `ANP-1.*`**. Both products then sat in one flat output folder, indistinguishable.
>
> Same root cause both times: **the product ID is inferred from a folder name, and nothing
> showed the operator what that inference had decided before acting on it.**

Both are fixed in the CLI. Neither fix removes the underlying problem, which is that a terminal
can only *tell* you what it decided, in text that scrolls, after the fact.

## The four rules this app exists to enforce

Every one comes from something that actually went wrong. Do not treat them as style.

1. **Never ask a question whose consequence is invisible.** WW-078's menu was a perfectly clear
   prompt with an unstated side effect. If an answer changes a filename, the screen says so
   before the answer is accepted.
2. **Show the resolved pairing before writing anything.** *These photos → this description file
   → these output names.* One screen, then a Confirm button. Never a report afterwards.
3. **No flags to memorise.**
   `--crop-bottom=25 --crop-images=1 --erase-tag=150,30 --erase-images=2,3,4` is two checkboxes
   and two number fields.
4. **State you can see.** "Is this listing done?" currently means reading three folders and a
   results table that has scrolled off screen.

## Build order — do not build ahead

| Ticket | What | Why in this position |
|---|---|---|
| **WW-066** | Make the engine callable | **Gates everything.** ✅ **for the image engine (2026-07-27):** `images-core.ts` → `runImages()`, `finish-core.ts` → `runFinish()`. Options in, structured result out, `onRow` progress callback; `images.ts`/`finish.ts` are now flag-parsing + printing wrappers. The browser CLIs (`login`, `scan`, `fill`, `check`, `start`) are **WW-066b**, done per-tab in WW-069 — their result shape should be decided by the tab that draws it |
| **WW-067** | Electron shell + tab 1 (AVIF → JPG) | Smallest genuinely useful thing to hand over |
| **WW-068** | CI build → the real `.exe` | **Deliberately early.** Install problems surface while the app still does one thing, not after six tabs |
| **WW-069** | Remaining tabs | Login → prepare images → finish → check → fill listing |

**The WW-066 contract:** all 63 tests, `npm run verify`, and every `npm run …` must keep passing
untouched. They are the proof the refactor changed no behaviour — the tests run the real CLI as
a subprocess, so they pin the printed output too, not just the core. Held for the image half.

Two things the split gave the app that are worth knowing before building tabs 1 and 4:

- `runImages()` returns the stage-2 folder→description `pairings[]` and, when it refuses to run,
  `blocked.missing[]`. **Tab 4 renders rule 2's table from those** — it does not scrape stdout.
- `runFinish()` takes `id` (renames the output) and `metaId` (descriptions only) as **separate**
  options. WW-078 is therefore unrepresentable, not merely fixed: no code path lets a
  descriptions choice rename a listing. `cleanId()` and `numberedImages()` are exported so the
  tab can answer *"is this a listing, and what will it be called?"* before writing.

## The tabs

Numbered in the order the partner uses them, which is also the order to build them.

### Tab 1 — Convert images  ·  WW-067
Drag a folder in. Pick output format and quality. Thumbnails, then a result row per image.
Carries the warnings the CLI already produces: soft source (under 1000px), Meesho metadata
residue, 5 MB step-down.

*Engine:* `runImages({})` from `images-core.ts` — stage 1, no crop options.

### Tab 2 — Log in to Flipkart  ·  WW-069
A live **"you're logged in"** indicator, not the terminal's row of dots. Must distinguish
*logged out* from *not yet navigated* — that is WW-061's exact failure mode, where Chrome comes
up with no session in a way indistinguishable from "it logged me out".

*Blocked by:* WW-061 must land first or this tab cannot be trusted.

### Tab 3 — Prepare images  ·  WW-069
The clean-up step. Checkboxes and number fields, never flags:

- Crop bottom `[25]` px — apply to images `[1]`
- Paint out tag `[150]` × `[30]` px — apply to images `[2,3,4]`

Show a **before/after preview of image 1** before anything is written. The two methods exist for
a reason worth surfacing in the UI: image 1 gets cropped because the AI replaces it anyway;
2/3/4 get the tag painted out because there the tag sits level with real product labels and a
crop would eat them.

### Tab 4 — Finish images  ·  WW-069
**The tab that has to be right.** This is where WW-077 and WW-078 both happened.

Before any file is written, show the resolved pairing as a table:

```
Photos              Descriptions from        Output will be named
GTB 1  (4 photos)   image-meta/GTB-1.json    GTB-1.1.jpg … GTB-1.4.jpg
ANP 3  (4 photos)   ✖ none found             — cannot finish
```

- A missing description file **blocks that row**, with a "finish anyway, no descriptions"
  override that must be an explicit click, never a default.
- Choosing a description file **never renames anything**. If the chosen file is for a different
  product, say so on the row, in red, before Confirm.
- One output folder per listing, not the current flat dump where two products' files sit
  side by side.

### Tab 5 — Check  ·  WW-069
Read-only. Per listing: images present, descriptions embedded, product JSON valid, ready or not.
This is rule 4 made concrete.

### Tab 6 — Fill the Flipkart listing  ·  WW-069
**Last, deliberately.** It drives a real browser against a live form.

- The ✅ / ⚠️ / ⏭️ / ❌ read-back report survives into the UI intact — it is the whole safety
  model and must not be flattened into "done".
- **Nothing may auto-save while any field reads ⚠️.**

## Not in the app

- **Writing the copy.** That stays in Claude/ChatGPT via `PROMPT-meta.md`, `PROMPT-product.md`
  and the three image prompts.
  The app never calls an AI — no keys, no credits, no network beyond Flipkart itself.
- **Meesho upload.** No public API. Copy-paste by hand from `npm run paste -- <ID>`.
- **Anything Phase 2** (the 2,200-listing keyword bank). Not until the partner is using this.

## How it gets tested

The refactor and the app need different kinds of proof; do not substitute one for the other.

| What | How |
|---|---|
| WW-066 changed no behaviour | The existing 63 tests + `npm run verify` + every `npm run …`, all untouched and green |
| Engine logic | vitest against a temp dir, as now — real CLI, real files |
| The `.exe` installs and runs | **On the partner's actual Windows machine.** Not a VM, not assumed. `sharp`'s native binary and data-folder resolution in a packaged app (cwd is `/`, not the project) are the two known risks |
| The app does the right thing | Run one real listing end to end and compare its output to a CLI run of the same listing, file for file |
| Windows-specific paths | WW-061 must be tested on the real machine — it is Windows-only by definition |

## Open questions that touch the app

- **WW-071** — real cap on Flipkart's Search Keywords field (blogs say 3, or 5; prompt asks 6–8).
- **WW-074** — is Flipkart's Description control a `textarea` or a single-line input? If the
  latter, `el.fill()` strips every newline and the description template collapses — and the
  read-back would still show ✅, because it normalises whitespace before comparing.
- **WW-015** — the Price/Stock/Shipping tab has never touched the live form.
- **WW-055** — a live listing still carries `Net Weight = 10000 g`. Costs real money at
  settlement. Unrelated to the app, but it is the one open item that is actively expensive.

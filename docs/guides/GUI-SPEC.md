# GUI spec — what the web app must do

> **Status: NOT BUILT.** Platform flipped to a WEB APP on 2026-07-29 — see "The shape of the
> app". Tickets: WW-091 (spike, first), WW-067, WW-068,
> WW-089, WW-069, WW-090 — in that order.
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
| **WW-091** | **Spike: EXIF write + JPEG quality in the browser** | **Now the real gate.** Two afternoons that decide whether the whole plan holds. Write a description into a canvas-produced JPEG and read it back with `check.ts`'s own reader; encode at 4:4:4 and compare bytes and looks against `encode.ts`. If either fails, the finish step cannot be a web page and that must be known before anything is built on top |
| **WW-067** | Next.js shell + step 1 (AVIF → JPG) + per-step folder memory | Smallest genuinely useful thing to hand over. Folder memory via File System Access handles in IndexedDB belongs here — every later step inherits it |
| **WW-068** | ~~CI build → `.exe`~~ → **deploy to Vercel** | Shrinks from "solve Windows packaging" to `vercel deploy`. Still done early and for the same reason: get a link into the partner's hands while the app does one thing |
| **WW-089** | The listing frame: selector, step rail, derived state | Everything after this hangs off a chosen listing. Built after the deploy because step 1 is genuinely useful alone |
| **WW-069** | Remaining engine steps (1-7) | Prepare → finish → check. **Not** login/fill — see below |
| **WW-090** | Prompt panels (steps 3, 4, 5) + inline `paste` checks | Last, because it is the only part with no CLI equivalent to copy behaviour from — and by then the frame and the checks it renders both exist |
| **WW-092** | Step 8 as a browser extension | Separate deliverable, after the web app works. Until it exists, step 8 is `npm start` and the app says so |

**What this costs that Electron would not have:** `sharp`, `playwright` and `node:fs` are all
unavailable, so `images-core.ts` and `finish-core.ts` **cannot be imported by the web app as they
stand** — they are Node modules. Their *logic* ports (the crop/erase/square/encode decisions, the
ID matching, the description composition); their *I/O* does not. WW-066's split still pays off,
because a function that takes options and returns a result is portable in a way a CLI never was —
but this is a port, not a reuse, and planning it as reuse is how the estimate goes wrong.
`id.ts` and `image-meta.ts`'s pure functions (`normalizeId`, `composeDescription`, `buildExif`)
move across unchanged.

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

## The shape of the app — decided 2026-07-29

| | Decision | Why |
|---|---|---|
| Platform | **Next.js on Vercel, running in the browser** | Vansh's call, taken after Electron was recommended and argued: *"vercel is available on every computer, don't have to stress about forwarding the app… i myself am not that comfortable with commands"*. A link beats an installer for two non-identical machines, it removes WW-068's whole class of install problem, and it is the only shape that could later be sold |
| Prompt steps | **In the app, for both users** | The partner must be able to do a whole listing alone. The app still never calls an AI (see *Not in the app*) — it holds the prompt, takes the reply back, and files it |
| Scale | **One listing at a time** | Pick a listing, walk its steps, finish it. `finish`'s whole-tree mode stays in the CLI |

### The web app does the work IN THE BROWSER, not on Vercel

This is the decision that makes the rest possible, and it is not the obvious one. **Vercel serves
the page and nothing else — no image ever leaves the machine.**

- **Reading and writing folders:** the **File System Access API** (`showDirectoryPicker()`).
  Chrome and Edge on desktop, which is what both of you use. It also solves the remembered-folder
  requirement *properly*: a directory handle is storable in IndexedDB, so each step reopens its
  own folder — with one "allow" click per folder per session, which is the API's rule and cannot
  be avoided.
- **Image work:** in the browser. Chrome decodes AVIF natively, so `createImageBitmap` opens the
  Meesho downloads; crop, erase, pad and resize are all canvas operations. Nothing uploads.
- **Why not process on Vercel:** a serverless function caps request bodies at ~4.5 MB, so 40
  images at 1.4 MB each is dozens of round trips of the user's own files to a third party, for
  work their laptop does instantly. It would be slower, more fragile and worse for privacy.

**Two things must be prototyped before this plan is trusted** (WW-091). Both are solved problems
but neither is free, and both are things the current pipeline is *measurably* good at:

1. **Writing EXIF.** Canvas strips metadata, and embedding the description is the entire point of
   the finish step. Needs a small JPEG/EXIF writer in JS. `check.ts` already *reads* IFD0 by hand,
   so the shape is known and symmetric — that reader is the test oracle for the writer.
2. **JPEG quality control.** `canvas.toBlob` gives no control over chroma subsampling, and
   `encode.ts` deliberately uses **4:4:4** because party decorations are saturated reds and golds
   that 4:2:0 smears exactly at the edges. A WASM encoder (`@jsquash/jpeg`, mozjpeg) restores
   control, including the step-down-to-fit-5 MB loop. **Do not ship `toBlob` and call it done** —
   that is a silent quality regression on the one asset that decides whether anyone clicks.

### "Can the browser really crop images? Is Python better? What about a Worker?"

Asked 2026-07-29. Answered here so it is not re-asked.

**Yes, and the geometry is the easy half.** Crop, pad, square and resize are one `drawImage` call
each with source and destination rectangles. Erasing the Meesho tag is `getImageData` to sample
the surrounding background — the CLI already samples rather than assuming white — then
`fillRect`. Chrome decodes AVIF natively, so the Meesho downloads open with no library at all.
None of this is a stretch for a browser; it is what canvas is for.

The two genuinely hard parts are **EXIF writing** and **chroma subsampling**, and neither gets
easier by moving to a server — you would just be solving them somewhere else, slower. That is
what the WW-091 spike is for, and a WASM build of mozjpeg (`@jsquash/jpeg`) is the expected
answer to both quality controls. **Verify it in the spike; do not take it on faith here.**

**Python is not better for this, and it costs you what you have.** Pillow and OpenCV are fine
libraries, but `sharp` is libvips and already outruns Pillow; the pipeline is written, tested
(99 tests) and correct. Rewriting working image code in another language buys nothing and
re-opens every bug that has already been found and fixed. The bigger problem is that Python
**needs a server**, which is the exact thing this plan is avoiding.

**A Cloudflare Worker will not run this.** Workers are V8 isolates with a hard CPU budget and no
native binaries — no `sharp`, no Pillow. WASM runs there, but resizing forty 1500×1500 images
would blow the free CPU allowance, and you would be uploading the user's own files to a third
party to do work their laptop does instantly. The free tier is real; it is just the wrong tool.

**So: no server, of any kind.** Vercel serves static files — free, permanently, and nothing to
scale. That is not a compromise forced by cost; it is the better architecture here, and it is
also why there is nothing to secure.

### Step 8 cannot go on Vercel, and this is not a detail

**Filling the Flipkart form needs a real browser already logged in as WishWorks.** On Vercel that
would mean either running Playwright in a serverless function — which cannot hold a persistent
Chrome profile — or **storing your live Flipkart seller session on a server**. The second is the
only one that would work and it is not acceptable: those credentials sell things and take money.

So the web app covers steps 1-7 and 9. Step 8 has three futures, in order of preference:

| Option | Verdict |
|---|---|
| **Browser extension** | **The right answer, eventually — and it covers MEESHO too.** It runs inside the Chrome you are already logged into, on the real page, so whichever seller panel is open is the one it can fill. `fields.ts` is DOM code — label targeting, fill, read back — and ports almost directly. It also *deletes* `connect.ts` and with it every bug in HANDOFF §6.4-6.6: no profile lock, no cookie flush on Ctrl+C, no CDP attach that Chrome ≥136 blocks. Separate deliverable, separate ticket |
| **Keep the CLI for step 8 only** | **What to do now.** `npm start` already works and is proven. The web app links to it and says so plainly |
| Playwright on Vercel | **No.** Do not attempt it |

The app must be **honest about this on screen** rather than quietly missing a step: step 8's panel
says what to run, and step 9 (Meesho) is copy-paste by hand exactly as it is today.

#### What the extension costs, and what it would actually be worth

**Cost: nothing to build, nothing to run.** An extension is HTML/JS in a folder. Chrome loads it
unpacked from Developer Mode for free, forever, with no account — which is all two people need.
Publishing to the Chrome Web Store is a **one-time $5 developer registration** and only matters
if it is ever sold; an unlisted listing would also spare the partner the Developer Mode toggle.
There is no runtime billing of any kind, because there is no server: it runs on your machine, in
your session.

**The bigger prize is Meesho, not Flipkart.** Flipkart at least has `npm start` today. **Meesho
has no API and no bot — step 9 is entirely hand-typed**, every field, every listing. An extension
sees the Supplier Panel exactly as you do, so it could fill from `image-meta/<ID>.json` the same
way the Flipkart side fills from `products/<ID>.json`. That turns the *most* manual step in the
whole flow into a button, and it is the only route to it that exists.

**This is not theoretical — you already use one.** Vansh runs *Flipkart Lens*, a seller extension
that reads product data straight out of the panel using his own logged-in session. That is the
same mechanism, and it settles the one thing worth settling early: **Flipkart's seller pages are
reachable from a content script.** No credentials are handled, no server sees anything; the
extension simply runs inside a tab that is already authenticated. What it does *not* settle is
Meesho — different site, never scanned — or either platform's stance on automated filling.

Two things to know before counting on it:

- **Meesho's form has never been scanned.** `scan.ts` learned Flipkart's 66 fields by reading the
  live page; the Meesho panel needs the same treatment before anything can fill it. Budget that
  as real work, not a port.
- **The read-back safety model must survive.** ✅/⚠️/⏭️/❌ per field, and never save while any
  field reads ⚠️. An extension makes saving *easier*, which makes that rule matter more, not less.

### If it is ever sold

Noted, not designed. Selling it means multi-tenant auth, someone else's data, and — the real
blocker — somebody else's marketplace credentials. **Nothing in this plan should be shaped around
that today**; the browser-only design happens to be the right starting point for it anyway,
because there is no server holding anyone's files.

### The listing is the top-level object, not the tab

This is the structural change from the earlier draft. **You choose a listing first**, and every
step then operates on that listing. Without it, "which product am I looking at?" is answered
six different ways in six tabs, which is how WW-077 and WW-078 happened.

```
┌────────────────────────────────────────────────────────────┐
│  Listing:  [ GTB-2  ▾ ]   + New listing                    │
├──────────────────┬─────────────────────────────────────────┤
│ ✅ 1 Photos in   │                                          │
│ ✅ 2 Clean up    │        the step's own panel               │
│ ✅ 3 Hero image  │                                          │
│ ✅ 4 Infographic │                                          │
│ ⚠️ 5 Listing copy│                                          │
│ ⬜ 6 Finish      │                                          │
│ ⬜ 7 Check       │                                          │
│ ⬜ 8 Flipkart    │                                          │
│ ⬜ 9 Meesho      │                                          │
└──────────────────┴─────────────────────────────────────────┘
```

The left rail is the flow in `THE-FLOW.md`, in order. **Steps are jumpable, not a wizard** — you
can redo step 2 after step 6, which the CLI already allows and the pipeline is designed for.

### Step state: derive it, don't store it

Rule 4 is "state you can see", and a stored checklist drifts from the disk the moment anyone
touches a folder. So each step's ✅ is **computed from the filesystem on every open**:

| Step | ✅ when |
|---|---|
| 1 Photos in | the source folder holds numbered images |
| 2 Clean up | `2-clean/<ID>/` exists with the same count |
| 3 Hero image | `2-clean/<ID>/1.png` exists (a `.png` means the AI's file replaced our `.jpg`) |
| 4 Infographic | `2-clean/<ID>/2.png` exists |
| 5 Listing copy | `findById` resolves both `image-meta/` and `products/` |
| 6 Finish | the finished files exist for this ID |
| 7 Check | every finished image reads back a description |
| 8 Flipkart / 9 Meesho | **cannot be derived** |

Only the last two get stored — a per-listing `done.json` with a date, because nothing on this
machine can see a marketplace. Everything else is read fresh. **A ⚠️ instead of ✅ means the step
ran but something wants a look** (a `SMALL` note, a `paste` warning); it never blocks the next
step, matching the CLI.

### Each step remembers its own folder

The requirement in Vansh's words: *"each tab will open its respective folder each time so that we
save some time".* Concretely:

- Every step that opens a file picker has **its own remembered path**, stored per step, not one
  global "last folder". Converting reaches for `~/Downloads`; finishing reaches for the WhatsApp
  archive; they must not fight over one value.
- **First run has no memory**, so each step falls back to `~/Downloads` — the one folder that
  exists on every Windows machine. After the first pick, the app remembers.
- **Nothing is hardcoded.** `Whatsapp DW/GTB/GTB 1` is Vansh's layout on Vansh's Mac; the
  partner's machine will differ and the app must never ship a path from a developer's disk.
- Stored in Electron's `userData` as one small JSON (`{ "step2": "C:/Users/…/Downloads", … }`).
  It is a convenience cache: **delete it and the app still works.** Never put anything in it
  that the app needs to function.
- A **Settings** panel lists the remembered paths with a Clear button, so a wrong turn is
  recoverable without finding a JSON file.

### The prompt steps (3, 4, 5) — one panel each

The app never talks to an AI. Each prompt panel is the same three parts:

1. **Copy the prompt** — one button, copies that file's entire text. The prompt files are
   already "nothing but the prompt" for exactly this reason, so the button is `readFile` +
   clipboard, with no parsing that could drift from the file.
2. **What to attach** — spelled out on screen: which images, and for step 5 the Excel inventory
   rows, with a reminder that `PROMPT-meta.md` and `PROMPT-product.md` go **back to back in the
   same chat** because the photos must still be in context (WW-081).
3. **Bring the reply back** — a drop zone for the downloaded `.json`, or paste-the-text box.
   The app files it under the right folder **under whatever name it arrived with** — `findById`
   already treats `image-meta-GTB009.json` and `GTB-2.json` as one product (WW-080), so there is
   no renaming step and the app must not invent one.

Step 5's panel then runs `paste`'s checks immediately and shows the result inline: lengths at
both ends, Model Name drift, banned and urgency words, commas on the Flipkart side. **That is
the point of putting the prompts in the app** — today those problems surface only if you
remember to run `npm run paste`; here the reply is checked the moment it lands.

**Skipping is explicit and allowed.** A "skip this step" control on steps 3, 4 and 5, because
some listings genuinely do not need a new hero image. Skipping marks the step ⏭️, never ✅, so
the difference between *done* and *not needed* stays visible — same distinction as C-036.

## The steps

Numbered in the order they are used, which is also the order to build them.

### Step 1 — Convert images  ·  WW-067
Drag a folder in. Pick output format and quality. Thumbnails, then a result row per image.
Carries the warnings the CLI already produces: soft source (under 1000px), Meesho metadata
residue, 5 MB step-down.

*Engine:* `runImages({})` from `images-core.ts` — stage 1, no crop options.

### Step 2 — Log in to Flipkart  ·  WW-069
A live **"you're logged in"** indicator, not the terminal's row of dots. Must distinguish
*logged out* from *not yet navigated* — that is WW-061's exact failure mode, where Chrome comes
up with no session in a way indistinguishable from "it logged me out".

*Blocked by:* WW-061 must land first or this tab cannot be trusted.

### Step 3 — Prepare images  ·  WW-069
The clean-up step. Checkboxes and number fields, never flags:

- Crop bottom `[25]` px — apply to images `[1]`
- Paint out tag `[150]` × `[30]` px — apply to images `[2,3,4]`

Show a **before/after preview of image 1** before anything is written. The two methods exist for
a reason worth surfacing in the UI: image 1 gets cropped because the AI replaces it anyway;
2/3/4 get the tag painted out because there the tag sits level with real product labels and a
crop would eat them.

### Step 6 — Finish images  ·  WW-069
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

**Per-image notes must survive into the UI, and none of them may block.** `runFinish` returns
them on each row; the tab shows them next to that image's thumbnail:

| Note | Means |
|---|---|
| `SMALL 350x350` | states the size, prescribes nothing — a small main image is often deliberate, because Meesho prices shipping off it. Under ~500px it adds that Meesho may reject it |
| `NOT SQUARE 1024x1536` | the ratio, unlike the resolution, is never a deliberate choice |
| `MEESHO METADATA in source` | the file came from Meesho; the output is clean regardless |

The distinction is the whole design: **the ratio warning tells you what to do, the resolution
warning tells you what is true.** Do not let the UI flatten them into one severity, and do not
let either stop the write — the file and its metadata are still correct (learning note 7).

### Step 7 — Check  ·  WW-069
Read-only. Per listing: images present, descriptions embedded, product JSON valid, ready or not.
This is rule 4 made concrete.

**It also owns what `npm run paste` checks**, because these are the last things wrong before a
listing goes live and there is no other tab for them — the Meesho copy itself is pasted by hand
(see *Not in the app*), but the *checking* belongs here:

- a value **over its panel limit** — say how many characters will be silently cut
- a value **missing** — the AI's reply was truncated (WW-081), re-run that prompt
- a value **far under its limit** — unused search reach
- **`Model Name` / `Search Keywords` differing between `image-meta/` and `products/`** — they
  must be character-for-character identical, and ANP003 shipped with three versions of each

All four are warnings; the values are still correct to use. `paste` prints them as one summary
*after* the values, because a warning you have to scroll back for is one you ship — the tab has
the same obligation, and more room to meet it.

### Step 8 — Fill the Flipkart listing  ·  WW-069
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

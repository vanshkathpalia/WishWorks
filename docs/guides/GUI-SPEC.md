# GUI spec — what the desktop app must do

> **Status: NOT BUILT. This is the requirements document — build from it.**
> **Platform: Electron desktop app**, settled 2026-07-29 after a Vercel web app was specced and
> rejected; the record is in *Why not a web app* below, so it is not re-argued.
> Build in this order: **WW-067 → WW-068 → WW-089 → WW-069 → WW-090 → WW-066b → WW-093.**
> Keep it in sync with `docs/tracks/notion/TICKET_STATUS.md`; that file remains the source of
> truth for status, this one for *what goes in the app and why*.
>
> Read `docs/guides/THE-FLOW.md` first — this app is that flow with a face on it, and every
> screen below maps to a step in it.

## Who it is for

**Two users, and both matter — that changed on 2026-07-29.**

- **The partner.** Non-technical, on **Windows**, cannot use a terminal. He is the reason the
  app exists. The app must be built and tested for a machine its author does not use — a real
  risk, not a footnote (see WW-061, a Windows-only bug that has already bitten).
- **Vansh himself**, on a **Mac**. *"I'm not that comfortable with commands"* — and he runs the
  flow every day. **Ship a `.dmg` alongside the `.exe` from the first build.**

Why the Mac build is not an afterthought:

1. **It is nearly free.** `electron-builder` produces both targets from one config; a
   `mac`/`windows` matrix in the same CI job is a few lines. Locally, `--mac` needs no CI at all.
2. **It is how the app gets debugged.** Vansh uses this daily and can read a stack trace. Bugs
   found on his Mac never reach the partner. Shipping only the `.exe` means every bug is found
   by the person least able to describe it, on the machine nobody can inspect.
3. **It pays for itself even if the partner never adopts it.** He is doing this work today, by
   hand, in a terminal.

### The release loop — Mac first, always

Vansh's workflow, and it is the right one:

```
fix on the Mac  →  test in dev  →  build a .dmg  →  packaged app works?
                                                          │
                                        no ── fix again ──┘
                                        yes → push a build for the partner
```

**Most iterations never leave the Mac.** Only changes that survive a packaged `.dmg` are worth a
partner build, because every partner build costs him an install and costs you a round trip
through someone who cannot read a stack trace.

**What the `.dmg` proves, and what it does not.** It catches the entire packaging class —
`sharp`'s native binary loading, `paths.ts` resolving when the working directory is `/`, the app
folder being read-only. Those are most packaging bugs and you can find them all yourself.

It does **not** catch platform-specific ones: a different `sharp` binary, `\` versus `/`, where
Chrome is installed. **WW-061 was Windows-only.** So *"if the DMG works the EXE will work"* is
mostly true and not entirely — which is exactly why WW-068 puts **one** early `.exe` on the
partner's real machine while the app does one thing. After that smoke test passes, iterate on the
Mac with confidence.

**Auto-update makes this cheap.** `electron-updater` against GitHub Releases means the partner
never reinstalls by hand — he opens the app and it is current. Worth adding at WW-068, because it
converts "pushing a fix" from a support conversation into a no-op.

**Gatekeeper caveat, the Mac twin of SmartScreen:** an unsigned `.dmg` will not open on a
double-click. Right-click → Open, once, or `xattr -d com.apple.quarantine /Applications/…`.
Document it in the same place as the SmartScreen note. Signing needs a paid Apple Developer
account and is not worth it for two users.

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

Nothing here has an unknown in it except step 9's form, which one `scan` answers.

| # | Ticket | What | Why in this position |
|---|---|---|---|
| 0 | **WW-066** | Make the engine callable | **Done for the image half (2026-07-27).** `images-core.ts` → `runImages()`, `finish-core.ts` → `runFinish()`: options in, structured result out, `onRow` progress. The app **imports these directly** — same process, same Node, no IPC serialisation of image data |
| 1 | **WW-067** | Electron shell + step 1 (AVIF → JPG) + per-step folder memory | Smallest genuinely useful thing to hand over. Folder memory belongs here because every later step inherits it |
| 2 | **WW-068** | GitHub Actions → the real `.exe` | **Deliberately early.** Install problems surface while the app does one thing, not after nine steps. Distribution is a GitHub Releases link |
| 3 | **WW-089** | The listing frame: selector, step rail, state derived from disk | Everything after this hangs off a chosen listing |
| 4 | **WW-069** | Remaining image steps: prepare → finish → check | Wraps `runImages`/`runFinish`, which already return what these screens draw |
| 5 | **WW-090** | Prompt panels (steps 3, 4, 5) + the `paste` checks inline | The only part with no CLI whose behaviour can be copied, so it goes after the frame that hosts it |
| 6 | **WW-066b** | Split the browser CLIs the way WW-066 split the image ones | `login`, `scan`, `fill`, `check`, `start`. Do each when its screen is built, so the result shape follows what the screen draws. **`scan` done 2026-08-12** — `browser-core.scanTab()` plus a *Learn this tab* button beside each Fill button, because calibration that only exists as `npm run scan` is calibration the non-technical half of the business cannot do. The merge and the junk guard live in `listing.mergeScan()`, shared with the CLI: it is the code that decides what reaches disk, so it is the last thing that should exist twice |
| 7 | **WW-093** | `scan` the Meesho Supplier Panel, then fill it | **The one genuine unknown, and the biggest prize.** Step 9 is 100% hand-typed today |

**The contract, unchanged:** all 108 tests, `npm run verify`, and every `npm run …` keep passing
untouched at every step. They are the proof the GUI changed no behaviour.

**Two risks, both known, neither new:**

- **`sharp`'s native binary must ship inside the package.** It is a compiled `.node` file, not
  JavaScript, and packagers routinely leave it behind or ship the wrong architecture.
- **Data folders must resolve when the working directory is `/`, not the project.** `paths.ts`
  was written for exactly this (it resolves from its own file location, not `cwd`) — but that
  has never been proven *inside a packaged app*, which is the only place it matters.

Both are WW-068's job to prove, on the partner's real Windows machine, which is why WW-068 is
second and not last.

#### "Deliberately early" — what that actually means

It is not a warning about a problem. It is the strategy for avoiding one.

Packaging is the only part of this project whose failures **cannot be seen from a Mac**. `sharp`'s
native binary, folder resolution when the working directory is `/`, and Windows SmartScreen
flagging an unsigned installer — none of them appear in `npm run …`, in the 99 tests, or on
Vansh's machine. They appear the first time somebody double-clicks an installer on Windows.

So the choice is *when* to find out:

- **Build the installer after one screen** — if it fails, the app contains one screen. The cause
  is obvious, the fix is small, and everything built afterwards is built on something proven to
  ship.
- **Build it after nine screens** — if it fails, it fails on an app with nine screens and weeks
  of work inside it. Now you are bisecting a packaging problem across all of it, on a machine you
  do not own, while the partner still has nothing.

Same work either way. The difference is whether an unknown gets answered while it is cheap.
**Expect the first `.exe` to be broken** — that is the point of building it early, not a sign
anything has gone wrong. Also expect a SmartScreen "unknown publisher" warning on an unsigned
build; document it for the partner so it does not read as a virus.


## The shape of the app — decided 2026-07-29

| | Decision | Why |
|---|---|---|
| Platform | **Windows desktop app, Electron** | Weighed against a Next.js/Vercel web app and chosen because of one fact: **the engine is Node code that already works, and Electron runs Node.** See the decision record below |
| Prompt steps | **In the app, for both users** | The partner must be able to do a whole listing alone. The app still never calls an AI (see *Not in the app*) — it holds the prompt, takes the reply back, and files it |
| Scale | **One listing at a time** | Pick a listing, walk its steps, finish it. `finish`'s whole-tree mode stays in the CLI |
| Stack | **React 19 + plain CSS, electron-vite, electron-builder** | Decided 2026-07-31 with WW-067. Tauri was the real alternative and loses on one fact: a Rust shell still has to run `sharp` and Playwright, so it ships a Node sidecar plus a protocol. Full reasoning: `docs/learning/8-the-desktop-app-stack.md` |
| Where it lives | **inside `flipkart-autofill/`** | One `package.json`, one `node_modules`, one test runner; `runImages()` is a relative import. **Flagged:** the folder is named after one marketplace and now holds the whole app. A `git mv` is cheap today and expensive after WW-068 wires CI to the path |

### The process boundary — the rule every later tab inherits

- **Main** is the engine: it imports `images-core.ts` directly and owns fs, `sharp`, Playwright.
- **Renderer** is pure view — `contextIsolation: true`, `nodeIntegration: false`, and no `node:`
  import anywhere under `gui/renderer/`.
- **`gui/shared.ts` is the only contract** between them: channel names and their types, imported
  by main, preload and renderer alike, so a channel cannot be renamed on one side only.
- **IPC carries paths and small JSON. Never image bytes.** Thumbnails are `file://` URLs to the
  real files on disk.

Two things this forces, both easy to get wrong and both already handled in `gui/main.ts`:
`app.setName("WishWorks")` must run first (Electron would otherwise derive `userData` from the
package name and lose the Chrome profile WW-094 placed), and the `WW_*_DIR` overrides must be
set **before** the engine is imported (inside a package `paths.ts` resolves into the read-only
`app.asar`). See learning note 8.

### Why not a web app — the decision record

A Vercel-hosted web app was seriously considered on 2026-07-29 and **rejected after being
specced in full**. Recorded here so it is not re-proposed on the same reasoning.

The attraction was real: a URL needs no install, works on both machines, and is the only shape
that could later be sold. What killed it was the cost on the other side of the ledger:

| | Electron | Web app |
|---|---|---|
| Steps 1-7, the image pipeline | **imports `images-core.ts` / `finish-core.ts` unchanged** | rewrite: no `sharp`, no `node:fs`. Canvas strips EXIF, and `canvas.toBlob` gives no chroma control — a spike just to prove it is possible |
| Step 8, fill Flipkart | **`npm start`'s code, as-is** | impossible — needs a logged-in browser, and the only way to give a server one is to store the live seller session on it |
| Step 9, fill Meesho | **same code, after one `scan`** | impossible, same reason |
| Deliverables | **one app** | web app + a browser extension to win back steps 8-9 + a spike |

**The web version was not weaker because browsers are weak.** It was weaker because it would
have meant rebuilding working, tested code to run somewhere that cannot do the last two steps,
then building an extension anyway to get them back. Three deliverables where this is one.

The stated reasons for wanting it, and what happens to each:

- *"A Vercel link is on every computer."* GitHub Releases is also a link. The partner clicks it
  once, installs, and thereafter opens an icon — which he will do at least as reliably as
  finding a browser tab.
- *"I'm not comfortable with commands."* Correct, and unchanged: that is what the GUI is for,
  `.exe` or URL alike.
- *"We could sell it later."* This tool must read local folders and drive a logged-in browser.
  A SaaS can do neither without holding a customer's marketplace credentials on your server —
  a liability, not a business model. Desktop software sells fine.

**What this decision buys back:** the EXIF-writing and chroma-subsampling spike disappears
entirely. Those were never real problems — `sharp` solves both today and is tested. They were
problems the browser would have created.

### No mobile app — decided 2026-07-31

Raised and closed in one line, recorded so it is not revisited: **Flipkart does not allow
creating a listing from its app**, and the product photos live on a laptop. A phone can do
neither half of this flow. Nothing here needs one.

### Two corrections worth keeping

Both were mistakes made while planning, and both would mislead anyone reading the earlier drafts.

1. **Meesho is not a special case.** It was written up as needing a browser extension because
   *"Meesho has no API"*. Neither does the Flipkart path — `npm start` has never used Flipkart's
   API. It drives a real Chrome that is already logged in and fills fields by their visible label.
   **Corrected 2026-08-03 (C-046), because the earlier wording here was wrong and load-bearing:**
   this is the same *approach*, not the same code. `fields.ts` finds a label by anchoring on
   `[class*="EditAttributeItemWrapper"]` and three sibling selectors that are **Flipkart's
   styled-component class names**, hard-coded at the top of the file — point it at Meesho and it
   matches zero rows and reports every field missing. WW-093 is therefore not just "run `scan`
   once": it is lifting those four selectors into a per-site profile and finding Meesho's
   equivalents. Still not a blocker and still much less than a browser extension, but it is
   engine work, not calibration.
2. **A browser extension is now optional, not required.** It remains a reasonable future
   deliverable (it runs in the session you already have, and *Flipkart Lens* proves the pattern
   works), but Electron covers steps 8 and 9 without it. Demoted to WW-092, P3.


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

**The Meesho-only route sits on the Listing copy panel · added 2026-08-11 (WW-140).** Some
products never go on Flipkart, and for those the pair above is the wrong shape: they exist to
produce two *files* the app reads, and half of `PROMPT-meta.md` is image descriptions and Flipkart
title/keywords. `PROMPT-meesho-only.md` asks for the three things the Supplier Panel needs — name,
description, pack contents — and returns **three blocks of text and no file**, because with no
`products/<ID>.json` there is nothing downstream to read one and the panel is typed into by hand
regardless. It therefore has no drop zone and nothing for the checks below it to check, and the
screen says so rather than leaving somebody hunting for the download.

**Skipping is explicit and allowed.** A "skip this step" control on steps 3, 4 and 5, because
some listings genuinely do not need a new hero image. Skipping marks the step ⏭️, never ✅, so
the difference between *done* and *not needed* stays visible — same distinction as C-036.

## The steps

Numbered in the order they are *usually* used, which is also the order to build them.

### Not a wizard — every step opens at any time · corrected 2026-07-31

The numbering is a map, not a sequence, and **nothing gates anything**. Vansh's reasons, both of
which the earlier draft got wrong:

- **A run that died halfway needs one step re-run on its own.** Something goes wrong mid-listing,
  and the fix is to open step 6 for that one product — not to walk 1→6 again.
- **Most listings skip converting entirely.** Step 1 only earns its place when the photos arrive
  as AVIF; when they are already JPEGs there is nothing to convert and the step should be walked
  past, not completed.

This costs nothing to honour because of *Step state: derive it, don't store it* — every step's ✅
is computed from the filesystem when it opens, so a step entered "out of order" reads the same
disk and shows the same truth. A stored cursor would have been the thing that made order matter.
**Steps not yet in the app are still reachable**; their panel names the command that does the job
today, which is more use than a disabled tab.

**And leaving a step must never cost you what you typed into it · added 2026-08-11 (WW-139).** The
freedom to wander is worth nothing if wandering wipes the screen. A panel is **hidden, not
unmounted**, once visited — half a costed kit survives a trip to the prompts and back. Only *typed*
state needs this; every ✅ is still derived from disk, so nothing here reintroduces a stored cursor.
Two things follow for any new panel: it mounts on **first visit** (a panel that polls or opens a
browser must not start doing so at launch), and anything it subscribes to on a **shared** IPC
channel — today only `row` — has to ignore what is not its own, because more than one panel is now
alive at a time.

### Step 1 — Convert images  ·  WW-067  ·  built 2026-07-31
Drag a folder in. Thumbnails, then a result row per image. Carries the warnings the CLI already
produces: soft source (under 1000px), Meesho metadata residue, 5 MB step-down.

*Engine:* `runImages({})` from `images-core.ts` — stage 1, no crop options.

**"Pick output format and quality" was dropped, not forgotten.** The engine has no such options
and should not grow them: it writes JPEG at 4:4:4 and 1500×1500, stepping quality down only to
stay under Meesho's 5 MB cap — one correct answer per marketplace, already tested. PNG at 1500²
is several times larger and buys nothing on a listing page; a quality slider is a control whose
only use is making the output worse. Reversible in one option on `ImagesOptions` if that is wrong.

**Loose images are accepted, not just a folder.** The first build shipped an `openDirectory`
picker, which greys out every image file — you could stand in the folder looking at `1.avif` and
be unable to select it. Two buttons now, *Choose images…* and *Choose a folder…*, because
**Windows cannot show one dialog that takes both** (it honours whichever property came first) and
the two machines have to behave alike. Drag-and-drop takes either. Every format the engine reads
goes in — AVIF, WebP, HEIC/HEIF, PNG, TIFF, GIF, BMP, JPEG — and a JPEG comes out.

**What is picked is copied into the workspace, not read in place** — `runImages()` takes no input
path and `<WW_IMAGES_DIR>/1-raw/<product>/` is fixed. The product ID comes from the folder's name,
or for loose files the name of the folder they were sitting in. Originals are never touched.

**The workspace is not fixed.** It defaults to `userData/workspace` and Settings can move it.
Changing it **relaunches the app**, because `paths.ts` resolves `IMAGES_DIR` and friends into
consts at import time and a fresh `import()` would not re-evaluate them — only the cache-busted
URL reloads, not its static imports. One restart is honest; a setting that half-applies is not.
Nothing is moved when it changes, so a wrong choice costs nothing.

### Step 2 — Log in to Flipkart  ·  WW-069
A live **"you're logged in"** indicator, not the terminal's row of dots. Must distinguish
*logged out* from *not yet navigated* — that is WW-061's exact failure mode, where Chrome comes
up with no session in a way indistinguishable from "it logged me out".

*Blocked by:* WW-061 must land first or this tab cannot be trusted.

### Step 3 — Prepare images  ·  folded into step 1, 2026-07-31
**This was never a separate step and the spec was wrong to make it one.** Cropping and painting
are stage-1 options on `runImages()` — the same call that converts — so a separate "prepare" step
would have to re-run stage 1 from `1-raw` and convert everything a second time. The CLI has always
done it in one command:

```
npm run images -- --crop-bottom=25 --crop-images=1 --erase-tag=150,30 --erase-images=2,3,4
```

The controls therefore live on **step 1**, as checkboxes and number fields, never flags:

- Crop bottom `[25]` px — apply to images `[1]`
- Paint out tag `[150]` × `[30]` px — apply to images `[2,3,4]`

On by default with those values, because the photos this step exists for are Meesho downloads and
they all carry the tag. The two methods differ for a reason worth surfacing in the UI: image 1
gets cropped because the AI replaces it anyway; 2/3/4 get the tag painted out because there the
tag sits level with real product labels and a crop would eat them.

Still owed: a **before/after preview of image 1** before anything is written.

*Found by:* the first real run through the app produced uncropped images with the tag still on
them, because the app called `runImages({})` with no options — exactly what this spec said to do.

### Step 6 — Finish images  ·  WW-069
**The tab that has to be right.** This is where WW-077 and WW-078 both happened.

Before any file is written, show the resolved pairing as a table:

```
Photos              Descriptions from        Output will be named
GTB 1  (4 photos)   image-meta/GTB-1.json    GTB-1-<its own title>-1.jpg … -4.jpg
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

### Step 8 — Fill the Flipkart listing  ·  WW-069 + WW-066b
**Last, deliberately.** It drives a real browser against a live form.

- The ✅ / ⚠️ / ⏭️ / ❌ read-back report survives into the UI intact — it is the whole safety
  model and must not be flattened into "done".
- **Nothing may auto-save while any field reads ⚠️.**

### Step 9 — Fill the Meesho listing  ·  WW-093
**The biggest single time saving in the app, and the only screen with real unknowns.** Today this
step is typed by hand, field by field, for every listing.

It is not a new mechanism — it is step 8 pointed at a different site. What has to happen first:

1. `npm run scan` against the Supplier Panel, exactly as it was done for Flipkart's 66 fields.
   Nobody knows yet what those fields are called or how many there are.
2. Map `image-meta/<ID>.json`'s `meesho` block onto them — the values `npm run paste` already
   prints (title, description, pack contents) plus whatever else the scan turns up.
3. The same ✅/⚠️/⏭️/❌ read-back. **Nothing may auto-save while any field reads ⚠️.**

Until it exists the screen shows the `paste` output with a Copy button per value, which is
today's flow with the terminal removed — useful on its own, and the fallback if the panel turns
out to resist scripting.

### Step 10 — Run the whole flow  ·  WW-106  ·  designed 2026-08-03, not built

One button on a listing that already has its images and its JSON. It runs the steps that exist,
in order, and **stops for review instead of publishing**.

```
finish  →  check  →  fill Flipkart  →  fill Meesho  →  STOP, you press Submit
```

**Two decisions, made by Vansh on 2026-08-03. Do not re-litigate them.**

- **It fills, it does not submit.** Both forms are left on screen, filled, for a human to send.
  A wrong listing live on two marketplaces is slow and public to undo, and the pipeline was
  always *generate → validate → review → upload*. The Submit button stays human.
- **Meesho gets the Excel bulk-upload file first, browser automation later.** The spreadsheet
  format changes rarely; a web form changes constantly, and Flipkart's already needed
  `inspect.ts` to re-derive selectors once. Ship the file so the flow is complete end to end,
  then put WW-093's browser fill on top. Nothing is wasted — the field mapping is the same work
  either way.

#### The report is the feature, not the automation

The automation is sequencing code we already have. **What makes this worth building is that when
something goes wrong it says which of three things happened**, because "it failed" tells the
person running it nothing they can act on.

| | what it means | what the app does |
|---|---|---|
| **Blocked** | This step could not run and nothing after it ran either. | Stop. Name the step, the cause, and the one thing to fix. |
| **Needs a hand** | The flow continued. Something wants a human afterwards. | Keep going. Collect it and show it at the end. |
| **Done** | Nothing to say. | Say so, once. |

Every result names **where to resume** — the step to re-run, not "start again".

**Blocking, because continuing would write something wrong:**
- two files at the same position number (`duplicatePositions` already detects this)
- no images in the folder, or no `image-meta`/`products` JSON for the listing
- not logged in to Flipkart or Meesho
- a required form field the JSON has no value for

**Not blocking, because the output is still correct enough to look at:**
- a value over the panel's character limit — `paste` already reports which and by how much
- an image that is not 1:1, or has no per-image description
- emoji in a Flipkart field — the app can already fix this one itself
- a shipping fee that changed after a new main image (read it before submitting — `SHIPPING-COST.md`)

**The rule that makes it safe: a step never runs if the one before it was blocked.** Half a
listing on Flipkart and nothing on Meesho is worse than a clean stop with a reason.

Reuse: `runFinish`, `runCheck`, `fillListing` and `paste`'s validation all exist and are already
options-in/result-out. New work is the orchestrator, the three-way result type, and the Meesho
Excel writer.

## Three things the packaged app must handle

Carried in from the 2026-07-26 decisions; they are easy to miss because none of them matter until
the app is packaged, and then all three are blockers.

- **Swap `playwright` for `playwright-core`.** `connect.ts` uses `channel: "chrome"` — the user's
  own installed Chrome — so the bundled ~400 MB Chromium is dead weight in the installer.
  **Consequence: the partner's PC must have Google Chrome installed**, and the app needs a
  friendly *"Chrome not found"* screen rather than a stack trace.
- **`profile/` must move to the OS user-data dir.** It currently lives inside the project folder,
  which is read-only inside a packaged app. It holds the live Flipkart session, so getting this
  wrong looks exactly like "it logged me out" — WW-061's failure mode again.
- **`sharp` must ship as a real native binary for each target.** Not cross-built: the CI matrix
  builds each platform on its own runner.

## Not in the app

- **Writing the copy.** That stays in Claude/ChatGPT via `PROMPT-meta.md`, `PROMPT-product.md`
  and the three image prompts.
  The app never calls an AI — no keys, no credits, no network beyond Flipkart itself.
- **Meesho upload — no longer excluded.** The earlier drafts put it here because *"Meesho has no
  public API"*. Neither does the Flipkart path: `npm start` drives a real logged-in Chrome and
  fills by visible label, so **the same approach reaches Meesho's Supplier Panel** — but not the
  same code unchanged, see the correction above and C-046: `fields.ts`'s row selectors are
  Flipkart's own class names. WW-093 has to make them per-site first. Until then, step 9 is
  copy-paste from `npm run paste -- <ID>` and the screen says so.
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

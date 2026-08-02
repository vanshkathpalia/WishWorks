# 8 — The desktop app's stack, and the line between the two processes

Decided 2026-07-31, at the start of WW-067. `GUI-SPEC.md` had already settled *Electron*; this
note settles everything under it and, more importantly, the process boundary.

## The stack

| | Choice | Why |
|---|---|---|
| Shell | **Electron** | Already decided. The reason is worth restating because it also kills the alternatives: **the engine is Node.** `sharp` is a native Node addon and Playwright drives Chrome from Node |
| Renderer | **React 19 + plain CSS** | Nine steps whose ✅ is *recomputed from the filesystem* on every open, plus progress rows streaming in mid-run. That is a state-projection UI, and hand-rolled DOM diffing is the thing you end up writing instead. No router, no store, no component library, no Tailwind — if any of those ever look necessary, the app has drifted |
| Build | **electron-vite + electron-builder** | One config for main/preload/renderer; `.dmg` and `.exe` from the same file (WW-068) |
| Location | **inside `flipkart-autofill/`** | One `package.json`, one `node_modules`, one test runner. `runImages()` is a relative import. A sibling `gui/` package would need workspaces, which CLAUDE.md rules out and which buy nothing for two folders |

**Tauri was the real alternative and it loses on one fact.** A Rust shell still has to run
`sharp` and Playwright, so it ships a Node sidecar plus a stdio protocol — Node *and* Rust *and*
a protocol, to save an installer download that happens twice. Electron already is that Node
runtime, in-process. Same for .NET/MAUI and Flutter, harder. The web version was rejected
separately and at length in `GUI-SPEC.md`.

**"No build step" is not violated.** That rule is about the engine — `tsx` runs `.ts` with no
`tsc` — and it still holds: `npm run …`, `npm test`, `npm run typecheck` are untouched. A
packaged Electron app cannot run tsx-loaded TypeScript in its main process, so a build arrives
with *packaging*, not with the framework choice. The only question was hand-rolled or standard.

## The process boundary — the part that matters

- **Main** is the engine. It imports `images-core.ts` directly and owns fs, sharp, Playwright,
  the folder-memory JSON.
- **Renderer** is pure view. `contextIsolation: true`, `nodeIntegration: false`, no `node:`
  import anywhere in `gui/renderer/`.
- **`gui/shared.ts` is the only contract.** Channel names and their types, imported by main,
  preload and renderer alike, so a channel cannot be renamed on one side only. It imports the
  engine's `Row` type rather than re-declaring it.
- **IPC carries paths and small JSON. Never image bytes.** Thumbnails are `file://` URLs
  pointing at the real files; base64 through IPC would copy every photo twice for nothing.

## Three things found while wiring it up

1. **`app.setName("WishWorks")` must be the first line of main.** Electron derives `userData`
   from the *package* name, which is `flipkart-autofill`. `paths.ts` computes the same directory
   by hand and spells it `WishWorks` (WW-094, so the CLI and app share one Chrome profile).
   Without that line they disagree and the packaged app comes up logged out — WW-061's symptom
   again, from a completely new cause.

2. **`paths.ts` does not survive packaging on its own, and the `WW_*_DIR` overrides are the fix.**
   Its comment says resolving from `import.meta.url` "also blocks packaging — fixed". Only half
   true: it fixes the *working directory* problem, but inside a packaged app that path lands in
   `app.asar`, which is read-only. Main therefore points the four overrides at a workspace under
   `userData` **before** importing the engine — which is why images-core is loaded with
   `await import()`, since a static import would hoist above the assignment.

3. **`runImages()` takes no input folder**, so "drag a folder in" cannot read it in place —
   `<WW_IMAGES_DIR>/1-raw/<product>/` is fixed. The dropped folder is **copied** into the
   workspace and the folder's own name becomes the product ID. Copying is the better half of the
   trade: the originals are never touched, matching the pipeline's existing one-direction rule.
   The alternative — adding an `imagesDir` option — would have edited tested engine code to
   avoid a ten-line copy.

## One requirement deleted rather than built

WW-067 asks for "format + quality controls". **The engine has no such options and should not
grow them.** It writes JPEG at 4:4:4, 1500×1500, stepping quality down only to stay under
Meesho's 5 MB cap — one correct answer per marketplace, already tested. PNG at 1500² is several
times larger and buys nothing on a listing page, and a quality slider is a control whose only
use is making the output worse. The step converts and reports; there is nothing to choose.
Say so if you disagree — it is a one-option addition to `ImagesOptions`, not a redesign.

## Also worth knowing

- **Windows cannot show one dialog that accepts files *and* folders.** `openFile` and
  `openDirectory` together are honoured as whichever came first, so a single "choose" button
  behaves differently on the two machines this app runs on. Two buttons, always.
- **A `file://` URL built by splitting on `/` is broken on Windows.** Paths there are
  `C:\Users\…`, so anywhere the renderer builds one by hand it must normalise separators first.
  Found in the thumbnail grid on day one; it is the kind of thing that only shows up on the
  machine nobody can inspect, which is the whole argument for WW-068 being early.

- `File.path` was removed in Electron 32. A dropped folder's real location now comes only from
  `webUtils.getPathForFile()` **in the preload**, and there is no renderer-side substitute.
- An ES-module preload cannot load in a sandboxed renderer, and this package is
  `"type": "module"`. `sandbox: false` is therefore set; `contextIsolation` still stands between
  the page and Node, which is the boundary that actually matters.
- `asarUnpack` for `sharp` and `@img/*` is in `electron-builder.yml` from day one. Packed inside
  the asar, the app launches fine and dies on the first image with an error nobody can act on.

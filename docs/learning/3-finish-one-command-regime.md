# 3 — `finish` as a one-command regime (recurse · guard · square)

**Date:** 2026-07-25 · **Ticket:** WW-047 · **Files:** `src/finish.ts`, `src/square.ts`,
`src/image-meta.ts`, `tests/finish.test.ts`, `docs/guides/THE-FLOW.md`

## Why
Vansh's real image workflow is the `finish` path (already-clean WhatsApp/AI photos in
`Whatsapp DW/<CODE>/<listing>/1.jpg…`), not the `1-raw/2-clean/3-final` pipeline. The friction
was: run once per category, special-case the number-less folders with `--id`, and a silent
footgun — dropping the AI's `1.png` beside the old `1.jpg` shifted every later image down a slot,
because both tools number output by loop position, not filename. He asked for one simple regime
the partner could follow too.

## What changed
1. **Whole-tree recursion.** `finishTree` walks down until it hits a folder that directly holds
   numbered images (a listing) and finishes it; folders that hold only folders (categories) are
   recursed into. So `--in` works at any level — one listing, one category, or the whole root.
2. **Collision guard.** `duplicatePositions()` (in the shared `image-meta.ts`) flags any position
   number claimed by >1 file. Both `finish` and `images` now STOP that listing with a clear
   message instead of silently shifting. This caught a real collision in Vansh's own tree the
   first time it ran (`HBD-space - p`: `1 ???.jpeg` + `1 ok.jpeg`).
3. **`--square` opt-in.** `finish` still leaves pixels untouched by default (its whole point);
   `--square` pads-white/centre-crops to 1:1.

## The non-obvious decision
Squaring already lived inside `images.ts`, but `finish` couldn't import it: `images.ts` is a CLI
that runs `main()` on import, so importing it would execute the pipeline. Rather than duplicate the
pad-vs-crop logic (the thing this project keeps in one place — see `image-meta.ts`), the squaring
was extracted into a dependency-free `src/square.ts` that both tools import. `images.ts` was
refactored onto it with its 50 tests unchanged and green — the proof the extraction was
behaviour-preserving.

## Names carry meaning — so `cleanId` was made to cope, not the names changed
First instinct was to tell Vansh to rename folders to `CODE number` (`HBD 1`). He can't: the
descriptor **is** the identifier of what the listing is (`HBD-kitty`, `HBD-space`), and a trailing
`- p` is his **pending** flag. So the code adapted instead of the workflow:
- No number in the name → keep the descriptive word as the ID, tidied to a clean slug
  (`HBD-space - p` → `HBD-space`), so it needs no `--id`.
- A trailing `- p` pending flag is stripped first, so the ID is **stable across the
  pending→done transition** — its `image-meta/<ID>.json` keeps matching when the flag comes off.

Lesson: when a user's naming looks messy, check whether the mess is *meaning* before asking them
to change it. Here every part was load-bearing.

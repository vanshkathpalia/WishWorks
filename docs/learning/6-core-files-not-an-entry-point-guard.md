# 6 — Splitting a CLI: separate `-core.ts` files, not an entry-point guard

**Decision (WW-066, 2026-07-27):** `runImages()` and `runFinish()` live in new files
`src/images-core.ts` and `src/finish-core.ts`. `images.ts` and `finish.ts` stay as the CLIs and
are imported by nothing.

The obvious cheaper option was one file each: export the core function, keep `main()` at the
bottom, and only call it when the file is the entry point. That is one fewer file and no
re-export layer. **It does not work here, and it was measured, not assumed:**

- `import.meta.main` (Node ≥24.2, which this machine has) is **stripped by tsx** — esbuild
  rewrites it to `undefined`. Verified: prints `undefined` both when run directly and when
  imported. Every `npm run …` goes through tsx, so the app would simply never start.
- The fallback, `import.meta.url === pathToFileURL(process.argv[1]).href`, compares two strings
  that disagree whenever any component of the path is a symlink — `import.meta.url` is resolved,
  `process.argv[1]` is not. Verified: a file run from `/tmp` reports `false` while it *is* the
  entry point, because macOS `/tmp` → `/private/tmp`. Silently doing nothing is the worst
  possible failure mode for the fix.

Neither problem is visible in review; both would surface as "the exe opens and nothing happens"
on the partner's Windows machine, which is the hardest place to debug. Two boring files beat a
two-line trick that has to be right about symlinks and bundler semantics.

**The generalisable bit:** the repo already had this shape — `paths.ts` and `encode.ts` are pure
modules imported by CLIs. The lazy answer and the existing pattern were the same answer; the
"clever" one-file version was the thing that needed proving, and it failed.

**Second decision, worth more than the first.** `runFinish()` takes `id` (renames the output)
and `metaId` (chooses descriptions) as separate options. WW-078 happened because one variable
did both jobs, so answering *"which descriptions?"* renamed the product. The CLI fix stopped
overwriting the variable; the refactor removes the variable. There is now no code path in which
a descriptions choice can rename a listing — the bug is unrepresentable rather than fixed.
That is the difference worth aiming for whenever a refactor passes over a known bug.

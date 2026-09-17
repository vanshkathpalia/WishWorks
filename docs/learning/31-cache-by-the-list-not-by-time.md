# 31 — Cache by the price-list array, not by time

Costing 67 kits took 52 s (WW-242) because matching re-derived the same answers millions of times.
The caches that fixed it are keyed so they cannot go stale, rather than expiring on a timer:

- **`candidates()` and the kind-word set are keyed by the materials ARRAY** (a `WeakMap`).
  `loadMaterials()` reads the file and builds a new array every call, so an edited price list is a
  new key and is scored fresh; the old entry is collected with its array. A time-based cache would
  either serve an old price for a while or expire too often to help.
- **`tokens()` depends on the taught words**, which live in module state, so `useLearnedWords()`
  clears all three caches. The existing test "a taught word changes every later match" fails if it
  does not.
- **`sameWord()` is pure in its two words and symmetric**, so one entry per unordered pair.
- **Cached arrays are frozen.** They are shared between callers; a caller that sorted one would
  silently change the next match. Frozen turns that into a thrown error.

How it was proven to change nothing: cost every real kit before and after, write both to JSON,
`cmp` them. Byte-identical.

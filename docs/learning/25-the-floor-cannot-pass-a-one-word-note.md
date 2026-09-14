# 25 — A one-word note can never pass the floor, however right it is

**The complaint (2026-09-14):** a supplier note of 84 materials came back with **41 "not on the
price list"**, and the only button offered was *Add 41 to the price list*. Vansh: *"matching these
values to what is prev already present is still poor — it is treating everything as new only."*

**The matcher was not blind. It had usually found the row.**

```
bregendy            0.57  Burgundy Balloon        <- right, rejected
Bopp 9*12           0.57  Flipkart Polybag 9x12   <- right, rejected
1-9 number foil…    0.50  Number Foil             <- right, rejected
```

The score is Dice: `2 x hits / (a + b)`. A one-word note against a two-word row, with the fuzzy hit
firing at 0.85, is `2 x 0.85 / (1 + 2) = 0.57`. **The floor is 0.6.** No amount of being right gets
that row through, because the arithmetic caps below the threshold before the material is even
considered. Raising the floor's ceiling by lowering it is the obvious fix and the wrong one — it
would let every 0.57 near-miss through silently, and this codebase has already been burned three
times by a silent wrong match (see `COLOUR` in `inventory-core.ts`).

**So the fix is a door, not a threshold.** The unlisted block now offers *"or one we already
have…"* with the near-misses and their scores, before the group picker. Nothing is pre-selected —
these are exactly the rows the matcher was NOT sure about, and quietly choosing one is how a
delivery of burgundy balloons gets counted as brandy. Picking one records it against his wording
through `setAlias`, which already existed, so the same word matches by itself next time.

The "use X · 57%" control already existed in the main tally table. It was missing from the summary
block — the one with the big button — which is the only one anybody looks at when there are 41.

## The real bug underneath: a size was unreadable

`9x12` and `9*12` are one packet, and they could never match: `x` is a letter, so `9x12` was one
token while `9*12` split into two. **The damage was not a miss, it was a wrong match** — the note's
`Flipcart pani 8*12` scored best against `Flipkart Polybag 9x12`, because with the size unreadable
the only thing left to agree on was the word *Flipkart*. A tally that silently swaps one polybag
size for another is worse than one that finds nothing.

`normalize` now treats an `x` between two digits as a separator, like `*` and `×` already were. An
`x` inside a word is untouched — `Deluxe` keeps its letters.

That change immediately found a duplicate it had been hiding: one material carried both
`8×10 meesho barcode` and `8x10 meesho barcode` as old names. They were only ever different because
the punctuation was. One is gone.

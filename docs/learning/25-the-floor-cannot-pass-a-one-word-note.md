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


## The follow-up: "what about a spelling he has never used before?"

Vansh, 2026-09-14: *"some other day he can make any other error with some other spelling — then
what?"* Correct, and it exposed a weakness in the answer above. **An alias only covers a spelling
already seen.** So aliases are NOT the answer to misspellings — they are for different WORDS
(`bopp` -> polybag, `pani` -> poly). Spelling is the matcher's job, and the matcher had two faults.

**1. A one-word note could not pass the floor.** Fixed by trimming from the ROW any word its own
category already states — the mirror of a rule the file already had. `bregendy` against `Burgundy
Balloon` in category *Balloon* is now one word against one word instead of one against two.

**2. Two edits were needed, and one was allowed.** `pestal` -> `pastel` swaps the vowels. Allowing
two outright was measured and rejected: `silver` -> `server` is two, `green` -> `cream` is two, and
each would be a silent wrong material. Requiring the same first letter does not save it — silver and
server share one. **The same letters rearranged** does: a transposition is a typo, different letters
are a different word. It is an exact test rather than a threshold.

That alone fixed the case that mattered: `blue pestal t` was scoring best against **Blue Balloon**
and now finds **Blue Pastel Balloon**. Same colour, wrong material, nothing downstream would have
asked.

**3. A match resting mostly on a guess never prices itself.** Capped just below `SURE`, so it is
offered and flagged rather than applied quietly. The cap is on the *share* of the evidence, not on
its presence — `Silver Metallic Balloons` -> `SILVER MATALIC BALLOONS` is one shaky word out of
three and stays confident, which two existing tests were right to insist on. `bregendy` is a single
word carrying the whole match, with **Brandy and Burgundy both one slip away and both on the price
list**. It now offers both, tied, and refuses to choose.

**And the honest limit:** `bregendy` -> `burgundy` is three edits. No safe distance reaches it. That
one is a genuine alias — which is what aliases are for.

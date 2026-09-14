# 26 — Teach a word, not a phrase: the app proposes, he disposes

**The pattern that kept repeating, 2026-09-14:** *every time the matcher got cleverer it got closer
to a confident wrong answer.* Understanding `panni` pushed an 8x12 note onto a 9x12 row. Allowing
two edits matched `silver` to `server`. Each improvement widened the net and caught something it
should not have.

Vansh named the cure: *"me having freedom to choose under what any product will go, and then app
learning from that."* He is right, and the reason is that the failures were never arithmetic — they
were the app guessing at a vocabulary only he knows.

## The flaw in what already existed

`setAlias` remembered a PHRASE: `blue kt` -> **Blue Metallic Fringes**. It taught nothing about
`golden kt`. Forty-one unmatched rows meant forty-one pieces of teaching, none of which compounded.

`proposeWord` learns a WORD. `kt` -> `fringe`, once, fixes every colour of fringe including ones
never bought. That is the difference between the app repeating and the app learning.

## Two rules it will not break

**It proposes only when exactly one word is unexplained.** With two unknowns there is no way to
tell which maps to which, and a wrong rule is permanent — far worse than a wrong match, because it
silently rewrites every future note.

**It offers the row's spare words and never picks one.** `blue jhalar` against `Blue Metallic
Fringes` leaves `jhalar` on one side and `metallic`, `fringe` on the other. Only Vansh knows it is
the second. The app knows exactly what it does not know, and says so.

The prompt is rare by construction, which is the point: one after every pick would be trained away
within a day.

## What it reaches

A word learnt from a delivery note is the same word in a kit's line, so `PROMPT-inventory`'s output
starts matching too — the half he was worried about: *"in this way our sku json entry will also
don't match."* Taught words also beat shipped ones, because he is the authority on his supplier.

## Measured, on his real note

Fourteen of the forty-one unmatched rows, as spelling and vocabulary went in:

```
0 of 14   at the start of the day
3 of 14   after the spelling work (transpositions, sizes, the floor)
6 of 14   after his vocabulary (kt, panni, t/c, bada)
8 of 14   after the rows he confirmed were genuinely new
```

The eight that pass are the ones a rule can reach. The rest were his business's questions, not his
spelling's — *is a cheers glass a thing we stock* — and two of them turned out to be one line
holding two items, which is a different problem again.

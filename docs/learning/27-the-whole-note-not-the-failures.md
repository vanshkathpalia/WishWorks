# 27 — Measure the whole note, not the lines that already failed

**The mistake in how I was reporting, 2026-09-14.** I kept quoting *"3 of 14"*, then *"8 of 14"*.
Those fourteen were the lines that had **already failed** — a sample of nothing but failures. It
made the matcher look broken and made every fix look small. Vansh, reasonably: *"if this smallest
delivery is causing this much issue then what is the use bro."*

Run against the whole note — 83 lines — the picture is different, and more useful:

```
35 matched confidently
25 matched but flagged for a look
23 nothing on the price list
```

Most of a note is plain colours (`1 pkt blue`, `2 pkt white`) and those were always exact. **Never
report the residue as if it were the rate.**

## What the full run found that the sample could not

Four **confident wrong matches** — the only kind that costs money, because stock comes off a
material that never arrived and nobody is told:

| his line | matched | should have been |
|---|---|---|
| `green kt` | Green **Balloon** 0.67 | nothing — no green fringes exist |
| `pink net` | Pink **Balloon** 0.67 | nothing — no pink net exists |
| `jungle 5 pcs set foil` | **5 No. Foil** 0.80 | nothing |
| `groom to be sesh` | **GTB Foil** 1.00 | GTB **Sash** |

Each needed a different rule, and all four are general rather than patches:

**A kind cannot answer a different kind.** The words that name a KIND are read off the category
list itself — `Fringes` -> `fringe`, `Net` -> `net` — so the rule covers every category there is
and any added later. It fires only when the word appears in NEITHER the row's name nor its
category, so `anprrashan kit with banner` still matches `Annaprashan Banner Kit` whatever category
that row sits in.

**A count is not a name.** `5 pcs` is how many. Left in, the bare `5` agreed with `5 No. Foil` and
`foil` agreed with every foil — two generic agreements and a confident wrong row. `No.` is
deliberately not a counting word: in `5 No. Foil` the 5 IS the name.

**The category trim is for one-word notes only.** It was added so `bregendy` could reach the floor
against `Burgundy Balloon`. But it strips the row's identity, and at two words it turned `Age Foil`
into a catch-all matching anything with `foil` in it. Measured: `blue kt` reaches 0.80 untrimmed
anyway, because two words carry themselves.

**`sesh` is `sash`** — one edit on a four-letter word, which gets no typo tolerance by design. That
guard is what keeps `gold`/`cold` and `blue`/`glue` apart and is worth more than this case, so
`sesh` is a word rule instead. It generalises: `hbd sesh` and `btb sesh` come along with it.

## The pattern, stated once

Every loosening this day needed a matching refusal. The transposition rule needed the cap below
SURE. Understanding `panni` needed the size guard. The category trim needed a length limit. **A
matcher that only ever gets more generous ends up confidently wrong**, and the wrongness is silent
by construction — a match nobody questions is a match nobody sees.


## A rule he had told me twice

*"If it is plain colour then it is balloon for sure — and with t or c it's balloon, but t or c is
just noise now."*

He is right, it is a real rule, and the matcher did not know it: `pastle pink` was matching **Pink
Pastel Fringes** at 0.74. Not a spelling problem — the spelling was fine — a KIND problem. A balloon
is the only thing he buys by colour alone; everything else he names.

So a line whose every word is a colour or a size can only be a balloon. Qualifiers count, because
`dark` and `pastel` say WHICH colour rather than what the thing is, and the test is typo-tolerant
because `pastle pink` is a colour line however he spells it. Any other word and the rule stands
down, so `pink net` and `blue kt` are untouched — those lines say what they are.

**15 of 18 colour lines landed in the Balloon category before; 17 of 18 after.** The one left is
`brown retro t`, which he cannot identify either.

## Where the AI belongs, which is not where I first said

He proposed: feed the supplier's note AND our price list to an AI, once, and get back a corrected
names list to upload. I pushed back citing WW-115 — and WW-115 does not apply. That rejected
pushing the price list into a prompt at MATCH time: hundreds of names per sheet, every sheet, app
left owning no data.

This is the opposite shape. The list goes once, offline; what comes back is **a file the app owns**;
every match afterwards is the same deterministic code, works with no internet, and improves rather
than re-guesses. `src/supplier-words.ts` builds the ask, reads the reply, and **checks it against
the real price list** — a proposed alias for a row that does not exist is refused, because the model
being told not to invent materials is not the same as it not inventing them.

Nothing applies without a human ticking it. A wrong word rule is permanent and silent.

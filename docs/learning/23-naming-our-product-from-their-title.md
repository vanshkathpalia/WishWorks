# 23 — Naming our product from their title, and refusing when it cannot

**Decision (WW-190):** `src/sku-core.ts` reads the catalog title, decides which of our lines the
product is, and fills `Seller SKU ID` on the latch form. **It returns null rather than guess.**

**Why this field was empty for so long.** The SKU on the other seller's label is theirs; ours is a
decision about which of our costings, photos and prices this listing inherits. A wrong one is
silent for ever — the listing simply sells under another product's kit. So the rule is: name it
when the title says so, leave the box blank and the cursor in it when it does not. Being right nine
times in ten is not good enough when the tenth never announces itself.

**Order is the whole classifier.** `Peppa Pig Happy Birthday Decoration Kit` contains "birthday", so
a generic HBD rule tested first swallows every themed kit we sell. Occasions first (annaprashan,
haldi, groom-to-be — none of them ambiguous), then characters, then plain birthday last, catching
only what nothing else claimed.

**One format everywhere, which was a correction.** The first version learnt each prefix's existing
habit and copied it, so a new SKU would sort beside its siblings — `ANP001` pads to three, `GTB-1`
does not pad, `HAL03` pads to two. Vansh, 2026-09-13: *"make it like same format all over."* He is
right, and for a better reason than tidiness: four spellings of one SKU are four folders, four
filenames and four rows to anything matching on text. New ones are `<PREFIX><NNN>`. **Nothing on
disk is renamed** — `normalizeId` already makes the old spellings match — but an old spelling still
counts as TAKEN, so `GTB-1` and `GTB001` cannot become two products.

**Handed out in sequence within a run.** Ten annaprashan kits latched in one batch must get ten
numbers. A function that only read the disk would hand out `ANP018` ten times, and the tenth listing
would inherit the first one's everything.

**Measured against the real 87 SKUs:** `ANP018`, `ANP019` for two annaprashan kits in one batch;
`HBD-peppa002` for a Peppa kit; blank for gift wrap and for a car cover.

**Worth knowing:** it produced `HBD102` and `GTB101`, because `HBD101` and `GTB-100` exist on disk.
If those were one-offs, every new SKU now continues from them. That is a question about what those
numbers meant, not a bug — and it is the kind of thing that only shows up by running it against the
real folder rather than a fixture.

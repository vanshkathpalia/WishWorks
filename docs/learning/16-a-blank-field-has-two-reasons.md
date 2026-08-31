# A blank field has two reasons, and only one of them wants filler

**2026-08-26. WW-195, C-073.**

Flipkart scores a listing out of 5. Ours reads **3.8**, and the Additional Description tab's own
counter says **35 / 66**. The two numbers sat next to each other for weeks and the obvious
conclusion — *fill the other 31 and the score goes up* — is the reason this note exists, because
it is half right and the wrong half is expensive.

## What the 31 actually are

The count is exact, not approximate. `categories/balloon-decoration.json` has 66 attributes on
that tab; the product file plus the two defaults files answer exactly 35 of them. The remaining
31, in full:

> EAN/UPC · Handle · Handle Shape · Handle Material · Hand Fan Type · Animal Type · Video URL ·
> External Identifier · Guardstick Material · Rib Material · Leaf Material · Leaf Shape ·
> Printed Text · Other Hand Fan Features · Mouthpiece Material · Tube Shape · Tube Material ·
> Other Blowout Features · Burn Time · Visual Effects · Sound Features · Birthday Ribbon Colour ·
> Cracker Type · Other Cracker Features · Powered by · Power Requirement · Type of Batteries ·
> Number of Batteries · Other Power Features · Diameter · Other Dimensions

This category is shared with hand fans, party blowouts, crackers and battery-powered toys.
Most of that list is *their* form, not ours. So the 31 split three ways:

1. **Genuinely ours, and we were leaving them blank by mistake** — `Printed Text` (the banner
   says something, and it is a thing buyers search), `Visual Effects` (metallic, chrome, glitter),
   `Other Dimensions`, `Handle` (the true answer is "No", same as `Foldable`). Four fields that
   `PROMPT-product.md` had swept into its leave-out list beside `Mouthpiece Material`. **This is
   the part that is pure gain and needed no experiment.**
2. **Cannot be answered honestly** — `EAN/UPC` and `External Identifier` (we have no barcode; a
   filled one is a *wrong* GTIN, not a blank one), `Video URL` (no video yet), `Burn Time`,
   `Diameter` (C-052: the parcel is flat and has none).
3. **Meaningless for a balloon kit** — the other ~20.

## The third group: shipped as a switch, then made the default

Nobody outside Flipkart knows whether the score counts a filled-but-meaningless attribute.
Everything published about the Listing Quality Score is seller-blog paraphrase; Flipkart documents
no formula. So it went out as an opt-in `--pad` — measure on one listing, keep it or delete it.

Vansh's answer, immediately: *"just make it happen under npm start only."* Which is right, and the
reasoning is worth keeping: **a behaviour you only get when you remember a flag is a behaviour
half your listings never get.** An experiment nobody runs is not an experiment, it is dead code.

**Where the default went is the part that mattered, and it was not `start.ts`.** The question
behind the request was *"maybe this is the command that runs on the app UI?"* — and it is not. The
app never shells out to `npm start`; its Fill button calls `browser-core.fillListing`, which is a
third front door beside the two CLIs. Padding only `start.ts` would have left the app — the thing
the non-technical partner actually uses — filling 35 fields while the terminal filled 58.

All three call `fillableValues(values, problems)` and then type the result. So the pad went
*there*, behind an optional `category` argument: pass it and the blanks are padded, omit it and
they are not. Three call sites, one behaviour, and turning the whole thing off later is deleting
one argument in three places rather than unpicking a flag.

### A third guard, found only after the default landed

Making the pad the default broke a promise the code makes out loud. `loadProduct(file, _, tab)`
loads ONE defaults file, so a Price/Stock-scoped load leaves `Precautions` out of `values`
altogether — it is answered, just not on that tab. `padBlanks` read that as blank. Press the Fill
button for a tab you are not actually looking at and `Precautions` gets `N/A` typed over three
perfectly good safety lines. `Flipkart.tsx` says in its own comment that pressing the wrong button
cannot fill the wrong tab, and before padding that was true.

The fix is one line in one function rather than a rule at three call sites: `padBlanks` reads the
defaults files itself and treats **a label answered by any tab as answered**. Which is what it
always meant — *a field some other tab fills is not blank, it is just not here.*

**The general shape is worth keeping.** Turning an opt-in into a default is not a one-word change
even when the diff looks like one. Opt-in code only ever ran on the path the author was thinking
about; a default runs on every path, including the one where somebody presses the wrong button.

The cost if the score does not move is real and buyer-visible: **"Mouthpiece Material: N/A" prints on the
live specification table.** That is what to watch for over the next
week, and `--no-pad` is the before/after.

Two things the pad must never touch, both learned the same afternoon:

- **Numeric and identifier boxes.** `N/A` in a number field makes Flipkart reject the
  entire save, not the field — the same blast radius as the emoji in `badChar`. MRP is caught by
  the same guard.
- **A field `checkValues` already threw out.** A `Key Spec` over its 22-character limit and a
  `Character` holding Devanagari are *stated and wrong*, not blank. The first version of
  `padBlanks` took `fillableValues(...)` as its input and padded over both — writing
  `Key Spec: N/A` onto a live listing and making the warning the operator is supposed
  to act on look answered. It takes the full `values` now, and returns only the additions, so the
  merge order at the call site cannot lose the distinction either.

## The thing that was already done

The other half of the original hunch — *inject filenames and metadata* — was already shipped and
had been for weeks. `finishedName()` writes
`ANP003-annaprashan-decoration-kit-red-gold-1.jpg` and `finishOne()` embeds the per-image
description as EXIF. Its own comment is the honest part: *"whether a marketplace reads any of
this is unproven."* Flipkart re-encodes uploads onto its own CDN under generated names, so
neither string plausibly reaches the score. **Nothing to build there — and a second look at code
that already exists is cheaper than the feature it would have duplicated.**

# 7 — A warning is a request for a decision. Ask *whose* decision before cutting it.

2026-07-29 · with WW-085 / C-039

Two things `finish` printed on every run. One was noise. One I mistook for noise.

**"Two files answer to this ID — one is probably stale", then a menu.** They were
`ANP003.json` and `image-meta-ANP003.json`: the same product, saved twice, because ChatGPT names
the download with a prefix. Files that normalise to the same ID *are* the same product — that is
what normalising means — so there was no wrong-product risk to guard against, only *which copy is
current*. `mtime` answers that exactly: the newest is the one you just saved. The guard was
inherited from WW-078, a neighbouring failure it did not fit. Deleted; the tool decides.

**`⚠️ SOURCE ONLY 350px — get a larger original`.** Vansh does not want a larger original: Meesho
prices shipping off the main image, so a bigger one raises the buyer's cost and loses the sale
(`docs/guides/SHIPPING-COST.md`). I deleted the check and reasoned that a folder reaching `finish`
is one you have *finalised*. Wrong — his answer: *"I wasn't saying finalised in that way. I was
saying finalised in the quality way."* He is signing off the **content**, not waiving inspection.
The AI still returns a 1024x1536 now and then, `finish` does not resize, and that image ships as
the odd one in a listing of squares.

The check was re-aimed, not removed: `NOT SQUARE 1024x1536` when the ratio isn't 1:1, silent under
`--square`, and nothing about pixel count. **The ratio is never a deliberate choice; the
resolution often is.**

The test before printing a warning: **whose decision is this?** If the operator has already made
it — by choosing the resolution, by saving the newer file — asking again is noise that trains them
to skim. If nobody made it, it is a real finding and belongs on screen.

The test before *deleting* a warning: **"this warning is wrong" is a report about the threshold,
not permission to drop the check.** Find the right threshold first — usually one property over
from the one being measured.

The narrower version of all of it, which cost two sessions: *any* line of the form "rename or
delete your files so the tool can find them" is a bug report about the tool (C-038).

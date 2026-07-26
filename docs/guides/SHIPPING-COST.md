<!--
  Meesho "Shipping (added separately)" — what we tested, what we found, and why we stopped.
  Closed 2026-07-25 after nine live A/B tests. This file exists to stop anyone re-running them.
  Earlier versions of this page contained a full optimisation playbook (slab maths, image variant
  prompts V1-V8). All of it was tested and rejected — deleted deliberately, not lost.
-->

# Meesho shipping fee — tested, closed, don't re-run

> **Conclusion: there is no usable lever here. Stop.**
> The main image *does* set the fee — real, proven, and **deterministic** (five byte-identical
> uploads returned the identical fee). But **fourteen live tests** found no rule that predicts
> which image is cheap, and the downside of guessing wrong is ~₹190/order. **Metadata does
> nothing** — nine content variants and five metadata variants, both dead ends.
> **Use the `image-playbook.md` Message 2 prompt, check the fee before you submit, move on.**

---

## The one rule that came out of this

> ### ⚠️ Every time you change a main image, read the shipping figure before you submit.
>
> Not to optimise it — **to catch a disaster.** One of our test images produced **₹256**. If that
> had gone live unnoticed, the listing would have sat there earning zero orders with no obvious
> cause. This check costs five seconds and is the single most valuable thing on this page.

## What we proved

1. **The main image sets the displayed fee.** Swap the image, the fee changes; swap it back, it
   returns. Confirmed with a reversal on one listing, all other fields untouched.
2. **Declared weight is not an input.** Setting Net Weight to `10000 g` on a ₹54 listing left it at
   ₹54. (It still matters for your *actual* settlement cost — see below.)
3. **There are no dimension fields on Meesho at all.** Volumetric/slab maths is Flipkart logic and
   does not transfer. Don't apply it here.
4. **No image trait predicts the fee.** Three hypotheses were formed and each was killed by the
   next test — see the table.

## The nine results

| Image | Fee |
|---|---|
| Groom To Be photo *(different product, same listing — probe)* | ₹54 |
| **V1** — pure white background, spread out, wide margins | **₹63** |
| **V2** — cream wall, balloons + banner only | ₹68 |
| **V4** — cream wall, everything, tight framing *(current default)* | ₹68 |
| Staged bedroom scene *(original)* | ₹68 |
| Gold fringe backdrop, edge to edge | ₹69 |
| **V5** — tiny in frame (~30%), pure white | ₹69 |
| **V3** — flat-lay, ~70 loose items incl. pump and tape | ₹89 |
| **V7** — compact cluster, pure white | ₹95 |
| **V6** — single dense bundle, pure white | ₹108 |
| **V8** — spread out, floating on pure white, no room | **₹256** |

**How each hypothesis died:**
- *Object count* → V2 (balloons + banner only) and V4 (everything) both returned ₹68.
- *Size in frame* → V5 was tiny and came back **more** expensive than V1.
- *Density* → held perfectly from V1 through V6, then V8 was airier than V1 and cost **4×**.

The values jump (63, 68, 89, 108, 256) rather than sliding. That looks like the image is being
**classified into a product category** which carries a rate — not measured on a scale. If anyone
picks this up again, **that** is the thread: check whether Meesho auto-changes the category or any
auto-filled attribute when the image changes. Everything else has been tried.

## Things that are actively worse — never ship these

- **Flat-lay of loose components** (₹89) — and it looks like a parts bin.
- **Compacted or bundled arrangements** (₹95, ₹108).
- **Product floating on pure white with no room context** (₹256).

## Metadata — tested, dead. And the estimator is deterministic.

**Result (2026-07-26): all five variants returned ₹63. Identical.** Metadata has no effect on the
fee. Do not revisit this.

That test also answered a question the nine content tests never could. Five uploads of
**byte-identical pixels** produced **exactly the same fee, five times out of five** — so the
estimator is **deterministic and noise-free**. Which means every earlier reading was real signal,
not measurement wobble: ₹54, ₹63, ₹89, ₹256 are genuine differences caused by genuine differences
in image content. The mechanism is real and consistent; we simply can't model it.

> **One alternative reading, for honesty:** Meesho may hash the pixels and serve a cached estimate,
> in which case the estimator never saw the metadata rather than ignoring it. The practical answer
> is the same — you cannot move the fee with metadata — so this isn't worth another test.

<details>
<summary>How the probe worked (kept in case anyone wants to re-run it on a different account)</summary>

Image *content* was tested to exhaustion. Image **metadata** never was — and unlike the content
tests it has a perfect control: pixels held byte-identical, metadata the only variable.

```bash
npm run metaprobe -- --in=photo/1.png --weight=350 --size=30x24x4
```

Writes five files to `photo/meta-test/` plus a `RESULTS.md` log sheet:

| File | What differs | Probes |
|---|---|---|
| `M0` | no metadata at all | baseline |
| `M1` | our normal pipeline EXIF | is anything read? |
| `M2` | 300 DPI instead of 72 | a naive `pixels ÷ DPI` physical-size estimate |
| `M3` | SubjectDistance 0.6 m + FocalLength 50 mm | monocular scale estimation from camera tags |
| `M4` | truthful pack facts in the description text | is the description parsed? |

Upload each as the main image, note the fee, fill in `RESULTS.md`.

**Before believing any small difference: upload the same file twice** and see how much the number
wobbles on its own. A one- or two-rupee move is noise.

**Reading it.** All five identical → metadata is not read, question closed permanently, delete the
folder. M0 ≠ M1 → metadata *is* read, which is a genuine finding and worth pursuing. M2/M3 moving
would point at a physical-size estimate. M4 moving would mean the description text is parsed.

> **`--weight` and `--size` must be your real measured figures.** M4 is the only variant making a
> factual claim, and the point of it is to give the estimator *accurate* data in place of a guess
> from a photo — legitimate, and better information for Meesho too. Do not put smaller numbers in:
> the courier weighs the parcel at pickup and Meesho charges back the difference at settlement, so
> a false claim loses money rather than saving it, on top of being a lie to the platform.

</details>

## Declared weight — still set it truthfully

Weight does not move the *displayed* fee, but it governs your **actual** cost: the courier weighs
the parcel at pickup and Meesho charges back any difference at settlement. Under-declaring buys
nothing and risks a charge-back. Weigh one sealed kit and enter the real number.
**See `WW-055`** — a live listing may still be carrying the `10000 g` from test 2 above.

## Why we stopped

Best honest result was **₹63 vs ₹68 — ₹5/order** — and the cheapest image looked bad enough to cost
more in lost orders than it saved. Vansh's call, and it's the right one: *an image that sells beats
an image that saves ₹5.* Meanwhile a bad roll costs ₹190. Risk far exceeds the prize, and after
nine tests there was still no rule to apply.

**The `image-playbook.md` Message 2 prompt remains the best on both looks and price. Use it.**

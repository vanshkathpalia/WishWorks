<!--

> **Everything in this file is about MEESHO.** Vansh, 2026-08-08: Meesho quotes its delivery fee
> **before a weight has even been entered**, which is why fourteen experiments changing declared
> things never moved it — there was nothing there to move. **Flipkart is a different mechanism
> entirely: it charges on volume and weight**, so the parcel size genuinely does change the cost
> there. `src/packaging.ts` computes that and its warnings name Flipkart explicitly. Do not read
> the conclusions below as applying to both.
  Meesho "Shipping (added separately)" — what we tested, what we found, and why we stopped.
  Closed 2026-07-25 after nine live A/B tests. This file exists to stop anyone re-running them.
  REOPENED NARROWLY 2026-08-02: the border axis, the only one never tested, produced ₹60 -> ₹49
  on one photograph. Everything else on this page stays closed. See Claim 2.
  Earlier versions of this page contained a full optimisation playbook (slab maths, image variant
  prompts V1-V8). All of it was tested and rejected — deleted deliberately, not lost.
-->

# Meesho shipping fee — tested, closed, don't re-run

> **Update 2026-08-02: the border is no longer untested — it has one clean result, and it is the
> first thing on this page that ever moved the fee in our favour.** Same photograph, padded with a
> **8.5%-per-side coloured border: ₹60 → ₹49.** But a second attempt came back at **₹105**, and a
> third-party tool (SupplierHub) was the one that produced the ₹49. **Nothing here is settled and
> "smaller product = cheaper" is still wrong.** Read
> [Claim 2](#claim-2--put-a-2020-px-border-on-every-image-especially-the-main-one) before acting.
>
> **Update 2026-07-26:** two new claims from the seller were raised and one is already settled.
> **File size: tested live, the fee did not move by one rupee — dead, same as metadata.**
> Details in
> [their own section](#two-new-claims-from-the-seller-2026-07-26--genuinely-untested-axes).
> Everything below still stands.

> **Conclusion: no rule, one open lead. Do not start a general hunt.**
> The main image *does* set the fee — real, proven, and **deterministic** (five byte-identical
> uploads returned the identical fee). **Fourteen live tests** found no rule that predicts which
> image is cheap, and the downside of guessing wrong is ~₹190/order. **Metadata does nothing** —
> nine content variants and five metadata variants, both dead ends. **File size does nothing.**
> The **one** thing still alive is the border: ₹60 → ₹49 on one photograph, 2026-08-02, unrepeated
> and unexplained. **Use the `image-playbook.md` Message 2 prompt, check the fee before you
> submit, move on** — and if you test the border, test only the border.

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

The probe tool (`src/metaprobe.ts`) and its output (`photo/meta-test/`) were **deleted
2026-07-26** — the question is closed permanently, so the code was dead weight. Recover from
git history (`git show 1ed2e4b:flipkart-autofill/src/metaprobe.ts`) if it is ever needed on a
different account. It wrote five files plus a `RESULTS.md` log sheet:

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

## Two NEW claims from the seller (2026-07-26) — genuinely untested axes

These came from Vansh's partner, from real selling experience. **They are not a re-run of the
fourteen tests above** — both are axes those tests never varied on purpose, so "closed, don't
re-run" does not apply to them. But neither is proven either, so nothing here is on by default.

### Claim 1 — "keep every image under 32 KB" ✅ TESTED LIVE, DEAD. Do not revisit.

> **Result (Vansh, 2026-07-26): uploaded the same image at a range of file sizes. The fee did not
> move by a single rupee.** File size is not an input to the shipping estimate. Closed, exactly
> like metadata.
>
> This is the definitive answer and it came from a live test, not from reasoning. Everything below
> was the desk analysis done *before* that test; it is kept only because it records why a 32 KB
> target was never achievable anyway, so nobody re-proposes it from the same blog posts.

<details>
<summary>The desk analysis that preceded the live test (kept for the numbers, not the conclusion)</summary>


**Never tested.** File size was never a controlled variable. It is tempting to think the metadata
probe settled it — five files, one fee — but those five differ by **1,078 bytes, 0.3%**
(376,975 → 378,053). That is far too small a spread to say anything about a 32 KB target.

**But the number does not survive contact with the maths.** Measured on `photo/1.png` at our
1500×1500 output:

| JPEG quality at 1500×1500 | File size |
|---|---|
| 90 *(our stage-1 default)* | 413 KB |
| 50 | 177 KB |
| 20 | 108 KB |
| 10 | 72 KB |
| **1** *(the floor)* | **38 KB** |

**Even quality 1 — unusable, visibly destroyed — is still 38 KB, above the 32 KB target.** 32 KB is
not reachable at 1500×1500 at any quality setting. The only way to reach it is to shrink the
picture:

| Resolution at quality 80 | File size |
|---|---|
| 1000×1000 | 165 KB |
| 600×600 | 76 KB |
| 400×400 | 41 KB |
| **300×300** | **26 KB** ← the first one that fits |

300×300 is far below what a listing image should be, and it would look poor on a phone — which
works directly against the CTR the same advice is meant to improve.

**So: ask before acting.** Most likely one of these — the figure is remembered wrong; it refers to
a thumbnail rather than the uploaded image; or the partner is uploading at a much lower resolution
than 1500×1500 already. Get the real number and the resolution it applies to before changing
anything. **Do not cap our output at 32 KB on this evidence.**

#### What it actually looks like (2026-07-26, eyes on the pixels)

Rendered from a real listing image and compared at 1:1 — sheet at
`~/Downloads/wishworks-quality-test/COMPARE-same-detail-1to1.jpg`:

| Variant | Size | Verdict |
|---|---|---|
| 1500px q90 *(our default)* | 630 KB | crisp, every printed word sharp |
| 1500px q20 | 132 KB | **all but indistinguishable from q90** |
| 1500px q10 | 80 KB | softer, fine detail muddy, still readable |
| 1500px q1 | 36 KB | **destroyed** — block artefacts, banding, banner text barely legible |
| 300px q80, shown full size | 29 KB | **unusable** — "Happy Annaprashan Ceremony" is an unreadable blur |

**Neither route to 32 KB is shippable.** Both candidates fail on the same thing: the printed text
on banners and cutouts, which is exactly what a buyer zooms in to read.

**The genuinely useful finding is elsewhere.** q20 at **132 KB looks the same as q90 at 630 KB** —
a 79% size cut for no visible loss. Nothing to do with shipping; it just means our default is
five times larger than it needs to be. Worth considering as a new default, but **test it on a
photographic image first**: this sample is flat graphic artwork with large areas of solid colour,
which compresses unusually well. A textured photo will not behave the same way.

#### Where the 32 KB figure probably came from

Searched for it. **No source states it** — not Meesho's own material, not the seller-service blogs.
What they do say ([meeship.in](https://www.meeship.in/blog/meesho-product-image-size-guidelines-2026),
[loharstudio](https://www.loharstudio.com/blog/meesho-listing-guidelines-image-size-rules-rejection-reasons),
[stitchmagic](https://stitchmagic.in/marketplace/meesho-image-guide)) is: minimum 400×400 to 500×500,
recommended 1000×1000, **maximum 5 MB**, JPEG/PNG, 1:1, white background — no minimum-size rule at all.

One of them does claim image choices save ₹30-50 per order, which is close to the partner's claim.
Its stated mechanism is that the image changes the *perceived* product size, which changes packing
and therefore the weight slab. **It cites no evidence and is an advert for that company's own image
service** — and our own test 2 already disproved the weight half of it (Net Weight `10000 g` on a
₹54 listing left it at ₹54).

**The likeliest explanation:** those same sources note the main image renders at only about
**150-200 px wide** on a phone. A thumbnail that size genuinely lands near 32 KB. So the partner is
probably reading the size of the thumbnail **Meesho generates**, not of the file he uploads —
in which case it is Meesho's output, not our input, and there is nothing for us to change.

</details>

**Practical upshot for the pipeline: change nothing.** Quality stays at 90. The earlier note about
q20 being visually identical to q90 was only ever about not shipping files five times larger than
necessary — and with file size proven irrelevant to the fee, and 662 KB sitting far under Meesho's
5 MB cap, there is no reason left to touch it. Comparison sheets are in
`~/Downloads/wishworks-quality-test*/` if anyone ever wants them; they prove only that quality 1 and
300×300 are both unshippable.

### Claim 2 — "put a 20×20 px border on every image, especially the main one"

**Never tested directly, and cheap to test.** Implemented as an opt-in flag, off by default:

```bash
npm run images  -- --final --border=20
npm run finish  -- --in="…" --square --border=20
```

It insets the picture inside a white frame and **keeps the outer size at 1500×1500**, so the 1:1
requirement still holds and nothing is cropped. Five tests cover it.

**One caution from the data above.** The nearest thing already tried points the wrong way: **V5**
was "tiny in frame (~30%), pure white" and came back at **₹69 — more expensive than V1's ₹63**, and
**V8**, "floating on pure white with no room", was the ₹256 disaster. Making the product smaller
within the frame has already failed once. A 20 px frame on a 1500 px image is only a 1.3% margin,
nothing like V5's 30%, so it is not the same test — but do not assume the direction is favourable.

**Why testing this is actually worth it now:** the metadata probe proved the estimator is
**deterministic and noise-free** (five byte-identical uploads, five identical fees). So a two-image
A/B — same photo, one with `--border=20`, one without — gives a trustworthy answer in one sitting.
No averaging, no repeats. **Read the fee before submitting either way.**

#### Tested 2026-08-02 — three live results, all on GTB "Groom To Be"

The seller ran a third-party tool, **SupplierHub**, over one of our main images. It came back
cheaper, so we pulled all three images apart pixel by pixel. Measurements are from
`sharp`, not eyeballed.

| image | border | badge width | decoration ink, % of final canvas | **fee** |
|---|---|---|---|---|
| ours, plain (1254²) | none | — | 55.4% | **₹60** |
| SupplierHub's copy of that same photo (1512²) | **8.5% per side, 129 px** | 4.1% | 38.0% | **₹49** |
| ours, ChatGPT-drawn border (1254²) | 4.1% per side | 14.7% | 41.2% | **₹105** |

**What SupplierHub actually did** — nothing clever. It took our 1254×1254 image *unchanged*
(inner crop compared back against the original: scale 1.000×, mean pixel difference 3.2/255, i.e.
JPEG noise) and dropped it into a 1512×1512 canvas with a 129 px orange→magenta→violet gradient
band. It also re-encoded PNG→JPEG 4:2:0 (2074 KB → 218 KB) and **stripped** the C2PA
"AI-generated" manifest ChatGPT embeds, and stuck two small badges on. It injected no metadata
of its own — the JPEG has no APP0/APP1/EXIF/XMP/ICC at all.

**So the one clean data point is ₹60 → ₹49: the same photograph, plus a border, −₹11.** Because
the estimator is deterministic, that is a real result, not noise.

**What it is NOT.** The ₹105 image is *not* a controlled third point. Asked to add a border,
ChatGPT **regenerated the whole photograph** — different composition, dense decoration span 84%
vs 95.9%, plus a thinner border and badges 3.6× too big. Three variables at once, so it says
nothing about the border.

**And it kills the obvious theory.** "Less product in frame = cheaper" is **wrong**: the ₹105
image has *less* decoration ink (41.2%) than the ₹60 one (55.4%) and costs 75% more. That agrees
with **V5** above (tiny in frame, ₹69 — dearer than V1's ₹63) and with the ₹256 V8 disaster.
Whatever the estimator keys on, it is not apparent product size.

**Next test, if anyone wants it — and only this one.** Same photo, one padded, one not, using
`finish --square --border=107` (107 px on a 1254 canvas reproduces SupplierHub's 82.9% inner
ratio exactly). **Never let ChatGPT draw the border** — that is what produced the ₹105 and it is
not reproducible. One product other than GTB, to see whether −₹11 survives.

**Badges: leave them off.** They moved nothing in any of the three results, and Meesho's stated
image rules prohibit promotional text overlays. All risk, no measured prize.

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

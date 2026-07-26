# 4 · The Meesho shipping fee is set by the main image

**Settled 2026-07-25 by experiment on our own live listing.** Not by declared weight, not by
dimensions, not by size.

| Test | Change | Result |
|---|---|---|
| A | Main image → variant 1 | ₹54 |
| B | Main image → back to the original, nothing else touched | ₹68 |
| C | Net Weight → 10000 g on the ₹54 listing | still ₹54 |

B reverses, so it is not drift. C is null, so declared weight is not an input.

**Mechanism.** Meesho's listing form has no length/breadth/height fields and Size is only
`Free Size`. It still has to quote a shipping figure, so it estimates parcel size from the only
field carrying size information — the photo.

**This is Meesho-specific.** Flipkart collects real weight and dimensions and uses those. Applying
Flipkart's volumetric-slab logic to Meesho was the mistake that cost three rounds here (C-027,
C-028, C-029).

## Two different numbers — do not merge them

Test C proves declared weight is irrelevant to the **displayed** fee. It does **not** make the
weight field inert, and confusing these two is the easiest mistake to make from here:

| | What sets it | Who pays it |
|---|---|---|
| **Displayed shipping** — the "₹68 added separately" on the listing | **The main image** (tests A/B) | The buyer, as part of the price |
| **Actual shipping** — deducted at settlement | The **real parcel**, weighed by the courier at pickup | You |

So: optimise the *image* to lower what the shopper sees, and declare the *true weight* so the
courier's scale doesn't trigger a charge-back. **Under-declaring buys nothing** — it doesn't move
the displayed fee, and Meesho bills the difference at settlement anyway (disputable from the
supplier panel in roughly a 7-day window, won with evidence, so photograph the packed parcel on
the scale).

⚠️ **WW-055 is open because of this:** a live listing still carries the `10000 g` from test C.
Revert it to the true packed weight.

## The estimator is deterministic — and metadata does nothing

Five files with **byte-identical pixels** and five different metadata blocks (stripped · pipeline
EXIF · 300 DPI · SubjectDistance+FocalLength · truthful weight and dimensions in the description)
all returned **₹63**. Two conclusions:

1. **Metadata has no effect.** Closed permanently. (Possible alternative: Meesho caches by pixel
   hash and never saw the metadata. Same practical answer.)
2. **Same pixels → same fee, every time.** No noise at all. So every earlier reading was *real
   signal*: ₹54, ₹63, ₹89, ₹256 are genuine responses to genuine differences in image content.
   The mechanism is consistent and repeatable. We simply cannot model it.

That second point is why the failure below is a modelling failure, not a measurement failure.

## …but it cannot be steered. Closed after fourteen tests.

Knowing the image sets the fee turned out **not** to be actionable. Nine live variants returned
₹54 · ₹63 · ₹68 · ₹68 · ₹68 · ₹69 · ₹69 · ₹89 · ₹95 · ₹108 · ₹256, and every hypothesis died on
the next test: *object count* (V2 and V4 both ₹68), *size in frame* (the tiniest image cost more),
*density* (held for six readings, then V8 was airier than the winner and cost 4×).

Best honest result: **₹5/order**, on an image ugly enough to cost more in lost orders than it saved.
Worst roll: **₹256**. Risk hugely exceeds the prize.

**What to actually do:** use the `image-playbook.md` Message 2 prompt, and **read the shipping
figure before submitting any main-image change** — not to optimise, to catch a ₹256 before it goes
live. Full results and the one untried thread (does the image auto-change the *category*?) are in
[`docs/guides/SHIPPING-COST.md`](../guides/SHIPPING-COST.md).

**Lesson.** Vansh reported the effect twice from his own account before running the test; both
times it was argued down with better-sourced inference. When someone operating the system reports
what it does, they are the instrument and we are the hypothesis. Source quality settles what is
documented; only a test settles what is true.

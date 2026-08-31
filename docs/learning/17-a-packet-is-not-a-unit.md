# A packet is not a unit

Vansh, 2026-08-31:

> ten packets does not mean ten units. A packet could have fifty pieces or a hundred pieces or
> maybe ten pieces… for one packing which had four heart foil, we will show that now the left is
> ninety six pieces.

The raw-stock panel shipped netting **packs against packs**, and every individual number on screen
was correct. The shelf still read empty with 46 balloons on it.

## The arithmetic that was wrong

A kit's material line is *pieces* — `4 heart foil`. Costing turns it into packs, because a pack is
what you buy: `packs = ceil(4 / 50) = 1`. That is right for money and disastrous for stock. Netted
against a delivery of `1 pkt`, one order retires the whole packet:

    received 1 pkt − used 1 pack = 0 left        (reality: 46 pieces)

Two orders and the shelf is at −1 while the packet is still half full. The panel exists to say
*this is about to run out*, and it was saying it about the one material that was not.

## The fix, and where the number came from

Both sides convert to pieces, using `piecesPerPack` — which was **already on the material**, put
there months earlier so a 16-piece line was not costed as 16 packs. Nothing new was recorded and
nobody types a pack size. 23 of 172 rows have one; the rest are bought singly (a balloon), where
pieces and packs are the same number and the conversion does nothing.

So a kit now carries both: `packs` for the purchase order (*"40 a week against a last purchase of
500"*), `pieces` for the shelf. They are two different questions and one number cannot answer both.

## The flag is weeks, not a percentage

The ask was *"flag it when fifty percent or twenty five percent is finished"*. A percentage of the
last delivery cannot answer the question that follows it:

> it takes one week of time for the supplier to get the product to us

25% left is a fortnight of one material and two days of another, and only the second one is an
emergency. So the row carries **weeks of cover** — `left ÷ pieces used per week`, off the same
ledger arithmetic the How-it-sells screen already computes — and flags at **two weeks**: one for
the supplier, one to notice the flag and be wrong about the rate. The percentage is still printed
beside the quantity, because that is how a shelf reads by eye; it just is not what decides.

Consequence worth knowing: a material nothing has used yet has **no rate**, so it shows a blank and
never flags. That is honest — there is no rate to run out at — and the screen says so out loud
rather than showing a reassuring dash.

## The related one: a hover is a look

Same session, same principle. The orders queue drove the main pane from `hover`, so crossing the
list to reach the picture you had *selected* swapped it for every SKU on the way. The picture, the
packet count and the tick all changed under a cursor that had chosen nothing.

**Only a click chooses.** Hovering now paints a small box of its own in the left column,
`pointer-events: none` so it cannot eat the hover that draws it, fixed-height so the list does not
reflow under the cursor pointing at it.

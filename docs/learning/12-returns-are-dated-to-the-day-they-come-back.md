# 12 — Returns are dated to the day they come back, and money is never stored twice

Two decisions behind the Orders tab's money screens (WW-184). Both were asked as questions and
both have an answer that is not the obvious one.

## A return does not edit the day it was packed

Vansh: *"maybe update the accumulative inventory cost and profit we had added on the day we packed
and shipped that order."*

**No.** A parcel that comes back is an event on **its own day**, reversing the revenue there. The
packing day keeps the numbers it had.

The reason is reconciliation. Parcels come back weeks later, and a marketplace settlement statement
is a document about a period that does not change afterwards. If a return rewrote history, the
figure for the 20th would be different every time you looked at it, and no week could ever be
checked against a statement — you would be comparing a moving number to a fixed one. It also makes
"how did we do today" unanswerable, since today's number would still be settling months from now.

So: `status` (`rto` | `returned`) and `statusOn` on the parcel, and `money()` reports `reversals`
for the window they came back in, whenever they were packed. Add up any set of consecutive windows
and the total is right either way round.

**RTO and a return are kept apart** because they are different money: an RTO was never delivered
and usually comes back sellable, a return was delivered and often does not. The fees differ too.
One field with two values, not a boolean.

## There is no expenses file

Vansh: *"we should maintain a whole new separate json for having only the expense part."*

There is deliberately none. The materials cost already lives in the costed kit; what a sale brings
in already lives in that kit's `marketplaces` block; what actually went out lives in the parcel
ledger. Multiplying them is the day's money. **A separate expenses file would be a second answer to
a question that already has one** — and this repo has been bitten by exactly that twice (C-049, the
guessed parcel weight beside the measured one; C-061, the GST rate beside the amount on the
statement). Both times the copy was the one that was wrong, and nothing on screen said so.

What WAS missing, and is now stored, is one field: **`market` on each parcel**. A kit sells at one
price on Meesho and another on Flipkart and settles differently again, so every figure downstream
has to know which marketplace paid. It is set at import, because the two manifests are different
documents read by different parsers.

## An uncosted SKU is not a free one

`money()` reports `uncosted` — packed parcels whose SKU matches no costed kit — and leaves them out
of both money columns while keeping them in the packet count. Today that is six of eight SKUs,
because the partner's codes (`SVP025`, `007 annaprashan ct`) have no kits here yet.

The alternative — treating a missing kit as ₹0 of materials — reports pure profit on exactly the
SKUs nobody has costed, which is the most flattering possible lie. Same rule the costing panel
already follows for a material with no price: *no price set* and *not on the list* are different
states and neither is zero.

Matching a manifest SKU to a kit uses **every** `<letters><number>` in the kit's name, not just the
first: `ANP001` is the kit `WKU001-ANP001`, a combo whose meaningful code is the last one — the
same rule `skuGroup` uses to file it.

## Still open

- **Reading the marketplaces' own RTO and returns reports.** Both publish one and both carry the
  sub-order number, which is the id the ledger is already keyed on, so the parser drives the
  existing model with nothing else to change. Not built: no sample file yet.
- **Flipkart manifests.** Same ledger, its own parser and its own `market` value. Nothing to
  redesign when it arrives.
- **Fees beyond materials** — commission, ad spend, packaging. They are real and they are not in
  the kit. When they matter, they belong per settlement statement, not per parcel.

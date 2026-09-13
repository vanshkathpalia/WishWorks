# 20 — A latched listing is live, so the queue is sorted by what it would cost to be caught out

**Decision (WW-186):** `pendingPrices` returns its rows **worst first**, scored by `riskOf`, and
the score is shown on screen with its reasons in words.

**Why it is not a to-do list.** Everything else this app queues can wait: an unconverted image, an
uncosted kit, a listing not yet written. A latched listing cannot — **it is on Flipkart the moment
the form is saved and it can take an order that night.** Vansh, 2026-09-13: *"maybe we get orders
for this, and maybe we don't have this at our inventory… accepting the order and then doing the
cancellation downgrades our Flipkart account."* So the order of the list is a business decision,
not a display preference, and sorting by date would put the dangerous one below the tidy one.

**The weights, and why each is where it is.**

| | | |
|---|---|---|
| 50 | a material the shelf has none of | the only one that ends in a **cancelled order** |
| 30 | no costing at all | live, and nobody has looked at what it is made of |
| 25 | a line matching no price row | usually a material never bought — what latching keeps introducing |
| ≤15 | loose matches, by share of the kit | *"feroggi color balloon… is going to match for balloon"* |
| 20 | our SKU not known | nothing can be checked until somebody says which kit it is |
| 5 | costed but unconfirmed | the ordinary case, and the least dangerous thing on the list |

They are **hand-weighted on purpose**. The alternative is a number nobody can argue with; a person
has to be able to say *a stockout is worth more than two loose matches* and change it. For the same
reason `riskOf` returns the reasons as sentences and the screen prints them: an order nobody can
read is an order nobody trusts.

**A confirmed price does not make a row safe.** A kit can be costed, signed off, correctly priced —
and still need a material that is not in the room. Those stay in the list, which is the one case
where "confirmed" is not the end of the story, and there is a test holding it there.

**Where the join lives.** `latch-core` knows nothing about kits and `inventory-core` knows nothing
about latching; the handler in `gui/main.ts` is the only place a latch row, a costing and the shelf
meet. Each engine stays testable alone and the join has a name — which matters because it is the
piece most likely to be wrong.

**The shelf's silence is not a zero.** `onHand` refuses to compute `left` for a material counted in
packets whose pack size nobody knows, and `shelfLeft` leaves those out rather than passing zero.
A queue whose job is to flag zeroes must not invent them — see `docs/learning/16-a-blank-field-has-two-reasons.md`.


## The addendum: pause, do not cancel

**Vansh, 2026-09-13:** *"maybe add that in the next call directly — and also flag it, we should know
what we have to pause before the delivery is given to us."*

Two answers, and only one of them was new.

**The supplier call already had it.** `nextCall` reads every costed kit, so a latched kit's
materials are on the call the moment the kit is costed — `untried`, `out`, `soon` or `thin` as the
case may be. Nothing needed adding. What it could NOT say is which of those lines is holding up a
listing that is **already selling**: the difference between *order it this week* and *order it
today, or take the listing down*. So the call marks those, and nothing else about it changed.
Building a second list would have made both untrustworthy.

**Pausing was new, and it is the point.** A paused listing costs the sales it would have made. An
order taken and then cancelled costs account health, which cannot be bought back. So `toPause` is
its own list, above the price queue on screen, because it is the only thing there whose deadline is
set by somebody else — a buyer, tonight.

`blocking()` groups it the other way round, by material, most-blocked first: one material holding
four listings down is **one phone call**, and that is the shape the answer should arrive in.

**`short` is carried as data, not parsed out of the reasons.** The reasons are sentences for a
human; something ACTS on this one. Deciding to pause a listing by matching words in a sentence is
how a pause silently stops happening the day somebody rewords it.

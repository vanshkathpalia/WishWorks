# 11 — Count parcels, not SKU totals

**Decision (WW-181):** the packing record stores one row per **sub-order** — Meesho's own id for a
single parcel — and never a per-SKU quantity.

**The two cases that forced it.** Both are "two manifests, same day, same SKU", and they need
opposite answers:

| What happened | SKU totals | Parcel ids |
|---|---|---|
| Manifest at 12pm says ANP006 × 6; at 2pm the download says × 10 (the same six, plus four) | 6 + 10 = **16 ✗** | ten ids, six already known → **10 ✓** |
| Delhivery's manifest says 6, Valmo's says 4 — different parcels | 6 + 4 = **10 ✓** | ten different ids → **10 ✓** |

A Meesho manifest is a *snapshot of everything ready to ship*, not a delta. Nothing in the numbers
distinguishes a re-download from a second courier, so **no rule over SKU totals can be right in
both cases** — and both happen every day. Counting ids needs no rule at all: the same id is the
same parcel, a new id is a new parcel.

It also answers, for free, three things that were separate problems: dropping the same file twice
(nothing doubles, so filename dedupe went away), packing a SKU and then getting more orders for it
(the packed ones stay packed, the new ones arrive as a smaller number), and cancellations (a parcel
that stops appearing is identifiable, rather than a total that quietly shrank).

**The id spans two baselines in the PDF** — `32116501352` then `6408960_1` — because the column is
narrow. Both halves are needed: the tail is the line number within an order, so two items of one
order share the first half. `tests/orders.test.ts` asserts the shipment totals equal the picklist
totals, so the two parsers check each other and neither can drift alone.

**Two dates, and they are not the same date.** `firstSeen` is the manifest's, which is when the
marketplace expects dispatch; `packedOn` is the day the box was actually closed. Tomorrow's
dispatch is often packed today, so pay is counted by `packedOn` and the queue is not "today's
orders" — it is everything still outstanding, whenever it arrived. Ledgers are filed by month of
`firstSeen`; anything counting by `packedOn` reads every ledger, because a parcel seen on the 31st
and packed on the 1st belongs to one month's file and the other month's wages.

**Known limits, deliberate.** No partial packing: the tick takes every outstanding parcel of that
SKU, and four-of-six would need a count box that has not been asked for. No cancellation detection:
an unpacked parcel that stops appearing sits in the queue rather than being auto-removed, because a
manifest that turns out to be per-courier would make "absent" mean nothing at all — better a stale
row a person clears than a parcel silently deleted.

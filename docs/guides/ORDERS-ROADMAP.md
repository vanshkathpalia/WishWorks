# Orders — where it is, and where it should go

The packing side of the app, written down so the next session (or the next person) does not have to
reconstruct the reasoning. Companion to `docs/learning/11-count-parcels-not-sku-totals.md` and
`docs/learning/12-returns-are-dated-to-the-day-they-come-back.md`, which hold the two decisions
everything else rests on.

## What exists today

| Section | What it does |
|---|---|
| **Pack today** | Drop the manifest, work the queue, tick a SKU off (all of it or a number), name the packer |
| **Money** | Packets, revenue, materials, what is left — today, this week, this month |
| **Packer pay** | Packets each, a rate per packet, what that comes to |
| **Came back** | Drop the marketplace's RTO / returns report, or mark one parcel by hand |

**The store** is `orders/YYYY-MM.json`, one row per **sub-order** — the marketplace's own id for a
single parcel — plus `packers.json` and `rates.json`. That folder is settable and belongs on a
synced drive: it is the only data here nobody can reconstruct. A kit can be costed again; a month
of packing cannot be remembered.

**The two rules that make it work:**

1. **Count parcels, never SKU totals.** A manifest is a snapshot of everything ready to ship, so
   re-downloading it repeats what you already have. Counting ids makes "6 then 10" and "6 plus 4"
   both come out right with no rule to get wrong.
2. **Never rewrite a day.** A return is an event on the day it comes back. A figure reported on
   Tuesday is still that figure on Friday, which is the only way anything reconciles against a
   settlement statement.

## The API question, answered honestly

**Meesho has no public API.** Everything here therefore comes from files a person downloads —
manifests, RTO reports, returns reports, settlement statements. That is not a temporary state to
design around; it is the constraint.

**Flipkart does have one** (Order Management API), and it is worth using when Flipkart volume
justifies it: orders, price and stock are all reachable, and it removes the download step entirely.
The parcel ledger is already shaped for it — `market` is on every parcel, so a Flipkart importer
adds rows beside the Meesho ones and every screen downstream works unchanged.

**How reports are read, and why it will keep working.** Nothing parses a report's columns. The text
is pulled out of whatever kind of file it is (CSV, XLSX-as-zip, PDF) and searched for **ids we
already hold** — our sub-order numbers and AWBs. A layout change cannot break it, an undocumented
column cannot confuse it, and a file about somebody else's parcels matches nothing. Any new report
either mentions our ids, in which case it works today, or it does not, in which case no parser
would have helped.

## Next, roughly in the order I would build them

**1. Flipkart manifest import.** One parser, `market: "flipkart"`, nothing else changes. Blocked
only on a sample file. Small.

**2. Settlement statement import — the one that makes the money real.** Today revenue comes from
what the *kit* says a sale pays, which is an estimate that Meesho's promotional pricing breaks. The
statement is the measurement. Same file-reading trick: find our sub-order ids, take the actual
amount paid against each. That turns Money from "what we think we made" into "what landed", and it
brings in the fees we currently ignore — commission, shipping deductions, penalties. **This is the
highest-value thing on this list** and everything below reads better once it exists.

**3. RTO and return RATES, per SKU.** The analytics Vansh asked for. Both marketplaces show these,
but only for their own listings and only in their own cuts. Ours would be per SKU, per marketplace,
per courier — and **the courier one is the point**, because that is a number neither marketplace
shows you and it is actionable: if one courier RTOs twice as often on the same SKU, that is a
handover decision. The ledger already stores courier per parcel, so this is a view, not a schema
change.

**4. A slow-mover / dead-stock view.** SKUs with materials costed and no parcels in N weeks. The
data is already here (kits × ledger) and it answers a question nobody currently asks: what are we
holding stock for that nobody buys?

**5. Packing-time analytics.** Packets per packer per hour needs a timestamp, not just a date —
one field, worth adding **before** anyone wants the report, because it cannot be backfilled.

**6. Reorder alerts from the materials side.** Materials used per week comes out of ledger × kit
lines, which is the same multiplication Money already does. "You are using 40 gold balloons a week
and the last purchase was 500" is a genuinely useful sentence and nothing else in the business
produces it.

## What I would NOT build

- **A second expenses file.** Money is derived from the kit and the ledger; a stored copy is a
  second answer to a question that already has one. This repo has been burned twice by exactly
  that (C-049, C-061), both times by the copy.
- **Charts before numbers.** Every figure above should be readable as a number first. A dashboard
  of graphs over data nobody has checked is a way to be confidently wrong in colour.
- **Re-implementing what the seller panels already show well.** Their dashboards are live and
  correct for their own marketplace. The reason to build ours is the things they *cannot* do:
  **both marketplaces in one view**, joined to **what a kit actually costs us**, and cut by
  **courier**. Anything that is just a worse copy of the Meesho dashboard is not worth the code.

## Known limits, deliberate

- **No partial-parcel packing.** The tick takes every outstanding parcel of a SKU, or a count of
  them; a parcel holding several items is all-or-nothing. Every parcel seen so far is one item.
- **A cancelled parcel is not detected.** It simply stops appearing on the manifest, and an unpacked
  one sits in the queue rather than being auto-removed — because if a manifest ever turns out to be
  per-courier, "absent" would mean nothing and the app would silently delete live orders.
- **Fees beyond materials are not counted.** Commission, ad spend and packaging are real and are not
  in the kit. They belong to item 2 above, per settlement statement, not guessed per parcel.
- **The price-list overlay is per machine.** A price corrected on the partner's PC does not reach
  Vansh's. Fine while the list ships with the app; revisit if both start editing it.

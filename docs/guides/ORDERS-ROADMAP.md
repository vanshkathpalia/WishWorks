# Orders — where it is, and where it should go

The packing side of the app, written down so the next session (or the next person) does not have to
reconstruct the reasoning. Companion to `docs/learning/11-count-parcels-not-sku-totals.md` and
`docs/learning/12-returns-are-dated-to-the-day-they-come-back.md`, which hold the two decisions
everything else rests on.

## What exists today

| Section | What it does |
|---|---|
| **Pack today** | Drop the manifest, work the queue, tick a SKU off (all of it or a number), name the packer |
| **Money** | Packets, revenue, materials, ads & boost, what is left — today, this week, this month |
| **Packer pay** | Packets each, a rate per packet, what that comes to |
| **Came back** | Drop the marketplace's RTO / returns report, or mark one parcel by hand |
| **How it sells** | Return rates by SKU, by marketplace, by courier · slow movers · materials used |
| **Raw stock** | Tally a delivery against the supplier's note · what is on the shelf, and what is running out |

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

**3. RTO and return RATES, per SKU. ✅ built** — the **How it sells** screen, cut by SKU, by
marketplace and **by courier**, which is the point: neither seller panel cuts by courier, and if one
RTOs twice as often on the same SKU that is a handover decision. **The rate is attributed to the
parcels PACKED in the window, not to the returns received in it** — a parcel that comes back in
August was shipped in July, and dividing one month's returns by the same month's packing mixes two
populations. Consequence, said on the screen: recent weeks read low.
See `docs/learning/14-a-return-rate-belongs-to-the-cohort-that-shipped.md`.

**4. A slow-mover / dead-stock view. ✅ built** — same screen: costed kits with no parcels in the
window, oldest sale first, and *never* for the ones that have never sold at all.

**5. Packing-time analytics. ✅ the field is in** — `packedAt`, ISO UTC, written at the tick. **The
report is deliberately NOT built**, because nobody has asked for it yet; the field went in now
because it is the one figure here that cannot be backfilled. `packedOn` still drives every wage and
every money figure — a day is what a wage is counted in.

**6. Reorder alerts from the materials side. ✅ built** — and the missing half arrived from the
other direction. *Materials used* is on the How it sells screen; **what was bought and when** is now
the **Raw stock** screen, where a delivery note is tallied against Vansh's own count. On-hand is
those two subtracted, so *"you are using 40 a week and 12 are left"* is a sentence the app can
finally finish. See `docs/learning/15-a-delivery-note-is-two-peoples-handwriting.md`.

## The growth side — what Flipkart will and will not give you

Everything above is about parcels that already sold. This is the other half Vansh asked for: *which
product types are rising, which keywords are trending, so the metadata and description use them.*
It is a real system and it is worth building. It is also the part where being wrong about what the
marketplaces actually expose wastes the most time, so the sources come first.

### What a seller needs to call a number "profit"

Contribution per SKU is five terms. We now hold four:

| Term | Where it comes from | State |
|---|---|---|
| What the sale pays | The costed kit, frozen onto the parcel at the tick | ✅ |
| Materials | The costed kit, frozen the same way | ✅ |
| Packing labour | Packer pay — packets × rate | ✅ (not yet subtracted per SKU) |
| Ads and boost | Typed in per day per marketplace | ✅ |
| Returns cost | How it sells — the sale lost, per SKU and per courier | ✅ |
| **Commission, shipping deduction, penalties, GST** | **The settlement statement** | ⛔ **missing** |

Which is why **item 2 is still the highest-value thing on this list**. Until the statement is read,
every figure on the Money screen is an *estimate built from what we think a kit earns*, and Meesho's
promotional pricing is exactly the thing that breaks that estimate. Nothing below changes this.

### The four sources, most reliable first

1. **Our own ledger.** What sold, what came back, per courier, joined to what a kit costs us. This
   is the only source that is *true* rather than reported, and it is the only one that knows both
   marketplaces at once. Already built.
2. **The Flipkart Ads (PLA) search-term report.** The buyer search terms that actually triggered our
   ads, with impressions, clicks and orders against each. **This is the only first-party keyword
   truth either marketplace hands out, and it is about OUR products.** Downloadable from the ads
   console. Nothing else on this list is as good and nothing else needs as little trust.
3. **The seller-panel insight dashboards.** Flipkart's Growth / Market Insights and Meesho's
   catalog-opportunity and price-recommendation screens: what is rising in a category. Browser
   pages, human-readable, no API behind either.
4. **Public flipkart.com.** Search autocomplete, *related searches*, browse-node bestseller order.
   No login needed. Free, and the least trustworthy — it is a ranking, not a volume.

**The Flipkart API does not have any of this.** Order Management, returns, shipments, listings,
price and stock are all there; **there is no search, keyword or trend endpoint, and looking for one
is a wasted afternoon.** Meesho has no public API at all. So growth data arrives the same way order
data does: a file somebody downloads, or a page in a logged-in browser.

**We already own the browser.** `npm run login` keeps a real Chrome profile signed into Seller Hub
(`profile/`), which is how the fill bot works. Pointing it at a dashboard page is not a new
capability. But a **downloaded report cannot break when a page is redesigned** and a scrape can, so:
report first, scrape only what is never offered as a file.

### The keyword loop — the thing actually worth building

`CLAUDE.md` says Claude writes copy *"grounded in the keyword bank, never inventing attribute
values."* **There is no keyword bank. It was never built.** Today `image-meta/<ID>.json` carries
keywords a model invented from a photo — plausible words, chosen by something that has never seen a
buyer. That is the gap, and closing it is one loop:

1. **Ads search-term report in** → the words buyers actually typed at us, with clicks and orders.
2. → **`keywords/<category>.json`** — a bank, one row per term, carrying impressions, clicks and
   orders, and which of our SKUs it converted on. Same read-the-text-find-what-we-know trick the
   returns reports use; the columns are not parsed by name.
3. → **`PROMPT-product.md` and `PROMPT-meta.md` get that category's top terms pasted in**, so the
   model *chooses from measured demand* instead of guessing. This is a change to two prompt files
   and nothing else, which is the point: the prompts are already the single place copy is decided.
4. → the listing goes live, and its own search terms come back in the next report. Closed.

Rising product *types* is the same loop with the granularity turned down, fed by source 3 — and it
should stay a **read**, not an automation: a screen that says *"balloon garland arch is up, we list
three"* is useful, and one that generates listings off a trend is how a warehouse fills with stock
nobody ordered.

### Blocked on files, not on code

Four sample files unblock everything left. Each is small, and each is a download:

| Want | File | Unblocks |
|---|---|---|
| Flipkart orders in the ledger | A Flipkart order/manifest export | Item 1 |
| Real money instead of estimated | A Meesho settlement statement (and a Flipkart one) | Item 2 — the big one |
| A keyword bank with evidence | The Flipkart Ads search-term report | The whole loop above |
| The same for Meesho | Meesho's ads report, if it breaks out search terms | Meesho half of the loop |

Redact whatever you like — the readers match on **our own ids**, never on column names, so a file
with the buyer details stripped out still works.

## What I would NOT build

- **A second expenses file.** Money is derived from the kit and the ledger; a stored copy is a
  second answer to a question that already has one. This repo has been burned twice by exactly
  that (C-049, C-061), both times by the copy. **The test is whether anything else can answer it**:
  materials and revenue can, so they are never stored; ad spend cannot, so it is. A rule against
  duplicating an answer is not a rule against recording a fact nobody else holds.
- **Charts before numbers.** Every figure above should be readable as a number first. A dashboard
  of graphs over data nobody has checked is a way to be confidently wrong in colour.
- **A trend predictor, or anything that scores an idea.** Twenty-six kits is not a dataset, and a
  model fitted to it would produce a confident number with nothing behind it. Show what is rising
  and let a person decide.
- **A scheduled scraper of public search rankings.** Fragile by construction, and it answers worse
  than the ads report — a rank is not a volume, and the report is first-party and about us.
- **Re-implementing what the seller panels already show well.** Their dashboards are live and
  correct for their own marketplace. The reason to build ours is the things they *cannot* do:
  **both marketplaces in one view**, joined to **what a kit actually costs us**, and cut by
  **courier**. Anything that is just a worse copy of the Meesho dashboard is not worth the code.

## Known limits, deliberate

- **A return rate is not attributed to the month it arrives in.** It belongs to the parcels packed
  in the window, so the most recent weeks read low — those parcels have not had time to come back.
  The ninety-day figure is the one to read. A cohort-age cutoff would fix it and nobody has needed
  one.
- **`packedAt` is written but nothing reads it.** Deliberate: packets per hour is a report nobody
  has asked for, and the field is the half that cannot be added later.
- **No partial-parcel packing.** The tick takes every outstanding parcel of a SKU, or a count of
  them; a parcel holding several items is all-or-nothing. Every parcel seen so far is one item.
- **A cancelled parcel is not detected.** It simply stops appearing on the manifest, and an unpacked
  one sits in the queue rather than being auto-removed — because if a manifest ever turns out to be
  per-courier, "absent" would mean nothing and the app would silently delete live orders.
- **Ads and boost are typed in, per day, per marketplace.** They are the one cost with no other
  source: nothing in a parcel, a kit or a report says what Meesho charged to promote a listing.
  Read off their Ads dashboard (Flipkart's is PLA, under Advertising) and entered on the Money
  screen; stored in `orders/ads.json`. **This is not the second-expenses-file mistake** — see
  `docs/learning/13-ads-are-entered-because-nothing-derives-them.md`. Per DAY because the windows
  are today / this week / this month and a monthly lump would make two of the three lie.
- **The remaining fees are still not counted.** Commission, shipping deductions, penalties and
  packaging are real and are not in the kit. They belong to item 2 above, per settlement statement,
  not guessed per parcel — and once that lands, ads may come from the statement too and stop being
  typed.
- **The price-list overlay is per machine.** A price corrected on the partner's PC does not reach
  Vansh's. Fine while the list ships with the app; revisit if both start editing it.

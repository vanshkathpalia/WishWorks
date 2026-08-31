# Ads and boost are typed in — because nothing else can answer for them

`Money.tsx` opens by saying there is deliberately no expenses file: the materials cost lives in the
costed kit, the revenue lives in that kit's marketplace figures, and a stored copy would be a second
answer to a question that already has one. This repo has been bitten twice by exactly that (C-049,
C-061) and both times the copy was the one that was wrong.

Ad and boost spend looks like it falls under that rule. It does not, and the difference is the whole
note: **the rule is against storing a second answer, not against recording a first one.**

- Materials and revenue are *derived* — kit × ledger, arithmetic we can redo any time. Storing them
  creates a copy that can disagree with the source.
- Ad spend is *not derived by anything*. No parcel knows it. No kit knows it. The manifest does not
  carry it, and the RTO and returns reports do not either. It exists on Meesho's Ads dashboard and
  on Flipkart's PLA screen, and the only route from there to here is a person reading it off.

There is no source to disagree with, so there is no copy.

Two shape decisions came out of that, both forced by the screen it feeds:

- **Per day, not per month.** The Money screen's windows are today / this week / this month. A month
  lumped onto one date makes two of the three read wrong on most days.
- **Per marketplace.** Money and Packer pay both split Both / Meesho / Flipkart. A total that cannot
  be split is one that filter has to ignore, which would put Flipkart's spend inside the Meesho-only
  profit.

Stored in `orders/ads.json`, beside `rates.json` and `packers.json` — money records, which belong
with the days they are spent on and must follow the folder onto a synced drive.

**When this stops being typed:** the settlement statement import (item 2 in
`docs/guides/ORDERS-ROADMAP.md`). Marketplace ad billing appears there, and once statement lines are
read by sub-order id the same way the returns reports are, ad spend may arrive with them — at which
point this becomes a fallback for the days no statement covers yet, not the mechanism.

# DIRECT-STORE — selling from our own site instead of paying the return penalty

> **Read the numbers section first.** The plan that started this ("build our own site so we
> never pay a return again") is aimed at the wrong cost. Our own order data says the return
> penalty is 8.9% of revenue; the thing actually crushing us is a **₹172 average order**.
> Fix AOV first — it makes the store viable *and* shrinks the return penalty at the same time.
>
> No code was written for this. See "Why there is no app" at the bottom.

---

## 1. What our own orders actually say

Measured 2026-09-07 from the three `Orders_*.csv` exports in the repo root
(20 Jul – 4 Sep 2026, 111 sub-orders). Re-run the numbers when you export fresh ones.

| | |
|---|---|
| Sub-orders in window | 111 |
| **Settled** (delivered or RTO) | **60** |
| Delivered | 54 |
| **RTO** | **6 — 10.0% of settled** |
| Customer returns after delivery | **0** |
| Cancelled before ship (costs us nothing) | 15 |
| Average order value | **₹172** (median ₹182, range ₹127–189) |
| Revenue, settled | ₹10,137 |
| **RTO cost @ ₹150** | **₹900 — 8.9% of revenue, ₹15 per settled order** |

Three things fall out of this, and they are not what we assumed:

**a) Our problem is RTO, not returns.** Zero customers returned anything after delivery. All
six were refused at the door or undeliverable. That matters because the two have different
cures: a no-returns policy fixes nothing here, and **prepaid-only fixes all of it.**

**b) The penalty is ₹15 an order, not ₹150.** It *feels* like ₹150 because that is what the
debit line says. Spread across the orders that paid for it, it is 8.9% of revenue. Real, worth
killing, but it is not the biggest hole in the boat.

**c) The biggest hole is the ₹172 order.** Every SKU we sell sits between ₹127 and ₹189 —
we have never once tested above ₹189. At ₹172, one RTO wipes out the profit on several
orders. Same parcel, same packing time, same RTO risk on a ₹450 kit, but then one RTO costs
one order's profit instead of four.

**So the order of work is: raise AOV → go prepaid → then worry about the channel.**

---

## 2. Raise AOV (do this on Meesho, this week, before anything else)

Costs nothing, needs no new platform, and every rupee of it survives the move to our own site.

- **Deluxe variants of the three sellers we already have.** Welcome Baby (50 orders),
  Annaprashan (18+7+3+2), Groom To Be (9). Same kit, more pieces, ₹399–549. List beside the
  existing one; do not replace it.
- **Two-occasion bundles.** Welcome Baby + Annaprashan is the same household three months
  apart. One parcel, one shipping fee, one RTO risk.
- **Add-ons that weigh nothing** — extra foil letters, a props pack, a pump. Grams are what
  the shipping slab charges for (see `SHIPPING-COST.md`), and these cost almost none.

The test for any of these: **does it raise the order value without moving the parcel into a
heavier slab?** If yes, list it.

---

## 3. Prepaid-only — the thing that actually kills the ₹150

RTO happens because the buyer never paid. Take the money up front and it cannot happen.

This does **not** require our own website. It is a setting. But on our own site we can make
it the *only* option, which we cannot do on Meesho.

**Do not accept COD on our own site.** If we do, we inherit RTO with no marketplace absorbing
any of it — the courier bills us both legs and hands back the parcel. That would be strictly
worse than where we are now.

---

## 4. The store: buy it, don't build it

Nothing here is a custom-software problem. All of it is a setting on a product we can rent.

| Need | Use | Note |
|---|---|---|
| Storefront + checkout | **Shopify** (or Dukaan if we want cheaper to start) | Hosted, mobile-first, no code |
| Payments | **Razorpay**, UPI + cards, **COD switched OFF** | This is the RTO fix |
| Shipping | **Shiprocket** | Same couriers, we control the rate |
| Catalogue | Our existing `products/<ID>.json` copy | Same names and descriptions we already generate |

Days to live, not months. If nobody buys, we have lost a month's subscription instead of a
quarter of build time.

---

## 5. Return policy — what we can and cannot say

We **can** refuse change-of-mind returns if the policy is displayed clearly before checkout;
the E-Commerce Rules require the display, not the acceptance.

We **cannot** refuse a damaged, wrong or missing item. That is an unfair trade practice, and
the payment gateway will side with the buyer on a chargeback regardless of what our page says.

So the honest policy — which is also the one that builds the trust the whole plan depends on:

> **Returns.** Because our kits are party decorations opened and used on the day, we do not
> accept returns or exchanges for change of mind. Please check the pack contents and colours
> on the product page before ordering.
>
> **If something is wrong, we fix it free.** Damaged in transit, wrong item, or something
> missing from the pack — send us a photo on WhatsApp within 48 hours of delivery and we ship
> a replacement at our cost, or refund in full. No questions.

Put it on the product page, not just a footer link. "We replace it free" sells better than
"no returns" ever will, and it costs us less than an RTO.

---

## 6. Pricing: burying the shipping

Set one price that already contains delivery, and say **"Free delivery"** — a visible
shipping line at checkout is where small carts get abandoned.

```
listing price = kit cost
              + packaging
              + Shiprocket rate for the slab, national zone   ← the buried part
              + payment gateway ~2%
              + GST
              + margin
```

Two rules:

- **Weigh the packed parcel and price off the real slab**, not the guess. `packaging.json`
  holds the measured sizes; the pump parcel is still a guess and bills volumetric at ~1.4 kg.
- **Do not undercut our own Meesho listing by much.** The point of our site is a bigger cart
  and a customer we own, not a race we start against ourselves. A small direct-only perk
  (free add-on, festive bundle) beats a discount.

**Do not put our website link, a discount card, or a QR code in a Meesho or Flipkart parcel.**
Order diversion is a suspension offence on both, and the marketplaces are the only demand we
currently have. The pull has to come from Instagram and WhatsApp.

---

## 7. Traffic — the part that decides whether any of this works

The marketplaces charge us that ₹150 as rent on demand we did not have to create. Our own
site has no demand at all on day one, and at a ₹172 order value **paid ads cannot pay for
themselves.** Model it before spending a rupee: acquisition per order has to come in under our
margin per order, and right now that margin is thin.

Which means the site only works on free traffic:

- **Instagram Reels** of kits being set up. Party decor is visual and occasion-driven; this is
  the natural channel and it is the actual work.
- **WhatsApp** for repeat buyers and for the damaged-item promise above.
- **Repeat purchase.** Baby shower → annaprashan → first birthday is the same household on a
  known timeline. That sequence is the whole reason to own the customer.

---

## 8. Kill criteria

Decide these now, while it is cheap to walk away.

- 90 days after launch: fewer than 20 direct orders a month → the traffic isn't there, park
  the store and put the effort back into marketplace AOV.
- Blended margin per direct order below the Meesho equivalent → the site is costing more than
  the ₹150 it was meant to save.

---

## Why there is no app

The original ask was a native iOS + Android + web app. It was not built, deliberately:

- Nobody installs an app to buy party decorations two or three times a year.
- Three codebases, an Apple developer account and store review, all before the first sale —
  when the open question is whether anyone buys direct at all, which is answerable with a
  rented store in a week.
- Everything a store needs is a solved, rentable product. Writing it ourselves buys nothing
  a buyer can see.

**If direct selling proves out**, the next step is *one* Next.js PWA — installable to the home
screen on iOS and Android, one codebase, all three targets — reading `products/<ID>.json` so
listings flow from the same source as Flipkart. Not React Native, not three apps. It would live
as a sibling folder in this repo; `flipkart-autofill/` has its own `package.json` and
`node_modules`, and CI is scoped to that folder, so the two cannot collide. Note the root
`.gitignore` ignores `dist/` and `out/` unanchored — a new app's build output is excluded
automatically.

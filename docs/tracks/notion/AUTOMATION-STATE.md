# Where the automation actually stands — 2026-09-14

Written because a lot was built in one long session and Vansh asked, fairly: *"have we automated
the whole flow, are you sure?"* **No.** Here is the honest line between done, built-but-unproven,
and not started.

## Works, and proven against the live account

| | evidence |
|---|---|
| **Latch: sweep, review ten, latch** | 592 products swept, 53 latchable; batch of 10 as shopper pages; only the tabs still open get latched |
| **Latch form filled** | every field but the SKU from the pricing defaults; **never saved** — three tests assert nothing can press Save |
| **SKU chosen from the title** | `ANP018`, `HBD-peppa002`; blank when it cannot tell |
| **Brand approvals** | 12 read off Track Approval; each approved brand sweepable |
| **Contents photo** | second gallery image, 492 KB JPEG |
| **ChatGPT: costing chat** | photo + prompt in the composer, **unsent**, 5,003 chars |
| **ChatGPT: ask and read back** | question in, text answer out |
| **ChatGPT: generate an image** | 27–63s each, ~900 KB PNG, 1254×1254 |
| **Four-prompt image run** | read-pack → hero → infographic → sizes, one chat, into `images/1-raw/<SKU>/1.png`… |
| **Supplier words via AI** | real note: 40 aliases, 1 word rule, 15 honest refusals, **1 invented row caught** |
| **Delivery matcher** | 83-line note: 35 confident, 25 flagged, 23 unmatched; four confident-wrong matches found and fixed |
| **Supplier call + forecast** | what the next fortnight needs, per SKU working shown |

## Built, not yet run against the real thing

- **Pause list** — live listings we cannot pack. Logic tested, never seen with real shortages.
- **Meesho queue** (`forMeesho`) — no screen.
- **`proposeWord` prompt** — wired, not exercised on a real pick.

## NOT built — and two of these are the gap Vansh just asked about

- **The meta + product JSON chat.** *This is the big one.* Uploading the finished images AND the kit
  JSON, running `PROMPT-meta` → downloading `image-meta-<ID>.json`, then `PROMPT-product` →
  `products-<ID>.json`. **Nothing of this is automated.** The share links show the shape — the reply
  is a FILE DOWNLOAD, not text — and nothing here downloads a file from a chat yet.
- **Meesho bulk sheet.** Fields and image rules recorded in `MEESHO-FROM-LATCH.md`; no code. Note
  the two files do not know about each other: the supplier panel gives image URLs, which are pasted
  into the sheet by hand.
- **Price updater.** Needs a live My Listings edit page.
- **Image polish loop.** `PROMPT-clean-image.md` exists; nothing decides WHICH borrowed photos need
  it, and nothing detects a watermark.

## What already worked before this session

`products/<ID>.json` → the Flipkart form is the original fill bot and is unchanged. So the last
step of the listing flow is automated; the step that PRODUCES that file is not.

## On the real-Chrome tests

They are scripts, not part of `npm test`. The 594 unit tests never open a browser. Every real-Chrome
failure this session was found by running one by hand, and each is now a unit test where it can be —
which is why the suite grew from 439 to 594.

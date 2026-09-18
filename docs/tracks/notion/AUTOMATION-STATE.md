# Where the automation actually stands — 2026-09-18

Rewritten because the 2026-09-14 version had gone stale and Vansh asked, fairly, *"what has not
been [built]?"* Same three sections as before: **works and proven**, **built but never run for
real**, **not built**. The last one is what another session should pick up.

Read `TICKET_STATUS.md` for how each thing came about, `CORRECTIONS.md` for what we got wrong.

## NOT built — the whole gap, in the order it hurts

- **Meesho image links.** The bulk sheet is built (below); its four image columns are not. The
  supplier panel's uploader hands back URLs and a person pastes them in.
- **Price updater.** Nothing edits a live listing's price. The app fills and saves a NEW listing
  form (`fillListing`, `saveListing`) and reads what a rival charges (`Listed`), but the "change
  the price days later" half — the one the kit costing exists for — has no code and no screen.
  Flipkart's API can do price and stock; nothing here calls it, and there is no API key on file.
- **Image polish loop.** `PROMPT-clean-image.md` exists and is good. Nothing decides WHICH borrowed
  photo needs cleaning, nothing detects a watermark or a price sticker, and nothing runs that prompt.
  Today somebody looks at a photo and decides.
- **One-button whole flow (WW-106).** `finish → check → fill Flipkart → fill Meesho → STOP`, with the
  three-way report (blocked / needs a hand / done). Designed in `GUI-SPEC.md` step 10; not built.
- **Keyword bank.** `CLAUDE.md` says copy is "grounded in the keyword bank". There is no keyword
  bank. The route is the Ads (PLA) search-term report — see `ORDERS-ROADMAP.md`.

## Every place a step still crosses by hand — the map

Where work moves between Flipkart, Meesho, ChatGPT and this computer's folders. ✅ automated,
🟡 built but unproven, ❌ by hand today.

| From → to | What moves | |
|---|---|---|
| Flipkart catalog → app | rival products (label pack PDF, search sweep, brand sweep, a link, an open tab) | ✅ |
| App → Flipkart | the Start Selling form, filled but the SKU; **Save is human** | ✅ (by choice) |
| App → Flipkart | brand approval form opened and read; **Apply is human** | 🟡 |
| Flipkart product page → computer | both slides → `Downloads/Whatsapp DW/<kit>/` as `contents.jpg` + `main.jpg` | ✅ |
| Computer → ChatGPT | contents photo + `PROMPT-inventory` → costing chat, **unsent** | ✅ (by choice) |
| ChatGPT → computer | the costing JSON — **pasted by hand** into the Inventory panel | ❌ |
| Computer → ChatGPT | 4 prompts → the listing images → `images/1-raw/<SKU>/` | ✅ |
| Computer → ChatGPT → computer | finished images + kit → `image-meta-<ID>.json`, `products-<ID>.json` | 🟡 never run for real |
| Downloads → `image-meta/`, `products/` | filing the AI's downloads by their CONTENT | ✅ (`inbox.ts`) |
| `products/<ID>.json` → Flipkart | the 66-field listing form | ✅ (fill bot; Submit is human) |
| App → Meesho | the bulk sheet (copy, price, fixed fields) | 🟡 never uploaded for real |
| Supplier panel → sheet | the image URLs | ❌ |
| Flipkart → app | live price / stock changes days later | ❌ nothing at all |
| Marketplace reports → app | manifests, order books, returns, settlements | ✅ (drop the file in) |
| Supplier note → app | delivery note → shelf, taught words, the next call | ✅ |
| App → partner's computer | costed kits (Drive), inventory export file, latch list as a message | ✅ |
| Partner's computer → app | deliveries, order books, his added materials | ❌ his data stays his |

## Built, never run against the real thing

- **The meta + product JSON chat** — the 2026-09-14 file called this "the big one, NOT built"; it is
  built now. `runMetaChat` uploads the finished images and the kit JSON, runs `PROMPT-meta` then
  `PROMPT-product` in one chat, and `saveReplyJson` downloads each `.json` reply as a FILE (falling
  back to the reply text). The button is **"Write the listing text"** on the Latch screen, enabled
  once a product has two images. **Nobody has run it against real ChatGPT.** Until somebody does,
  treat the download path as unproven — it is the step that was blocked for weeks.
- **Approval flow** (2026-09-17, all of it): review 3 at a time, open each kept form, read the
  document dropdown, hide the ones needing a trademark or brand letter, "I applied" → SKU + costing
  chat. Checked only against a fake form built from Vansh's screenshot.
- **Waiting for stock**, **latching a page opened by hand in Chrome**, **costing-chat redo**,
  **inventory export/import** (Settings), **right-click paste** — all 2026-09-17, tests only.
- **Pause list** — on the Latch screen, but never seen with a real shortage.
- **Meesho bulk sheet** (2026-09-18) — "Which go on Meesho?" on the Latch screen; a ChatGPT chat per
  kit for the copy and dropdowns, written into Meesho's own template. Tests and an openpyxl read-back
  only: never run against real ChatGPT, never uploaded. See `MEESHO-FROM-LATCH.md`.

## Works, and proven against the live account

| | evidence |
|---|---|
| **Latch: sweep, review, latch** | 592 swept 2026-09-13; 5 approved brands swept 2026-09-17 (683 products); form filled but the SKU, **never saved** — three tests assert nothing can press Save |
| **Label pack → products** | the real 86-order PDF: 39 products, counts checked line by line |
| **Card reading** | after the 2026-09-17 fix (C-086); the invoice pack re-read as 9 selling / 6 approval / 12 latchable |
| **SKU from the title** | `HBD-dore03`, `WH001`; blank when it cannot tell; two-digit for themed HBD |
| **Brand approvals** | 9 approved read off Track Approval; each sweepable; Svarupam Trecon never swept |
| **Contents photo** | second gallery image, 2000px JPEGs, also filed into `Downloads/Whatsapp DW` |
| **ChatGPT: costing chat** | photo + prompt in the composer, unsent; chat renamed `<SKU> — costing` once sent |
| **ChatGPT: image run** | four prompts, one chat, into `images/1-raw/<SKU>/` |
| **Supplier words, delivery matcher, call + forecast** | real notes and real ledgers; see TICKET_STATUS |
| **Kit costing speed** | 67 kits, 52s → 0.6s, output byte-identical (WW-242) |
| **Logins survive a quit** | Chrome closed gracefully on quit; proven on Vansh's Mac 2026-09-17 |

## Known-bad data to repair before trusting a screen

- **The 592-product "party decoration" hunt is not trustworthy**: a Re-check run under the 1.7.3/1.7.4
  card bug turned already-selling and needs-approval rows into "can latch". Select that list and
  **Re-check all 592** with 1.7.5 or later (about an hour) before believing its counts.
- The five 2026-09-17 brand hunts ran BEFORE the brand filter, so they include other brands' products
  (BEST WISHES: 112 of 134 "needs approval"). Their answers are real; the mix is wide.

## On the tests

629 unit tests, none of which open a browser. Everything browser-shaped is checked by a script in the
scratchpad against a FAKE page built from a real screenshot — that is how the stale-card bug, the
login bounce, the crashed tab and the approval form were each caught. Those scripts are not in
`npm test`; the unit test that survives them is.

# 18 — Seller Lens's "Latch on" button is a link, so the extension is not part of the tool

**Decision (WW-180):** `npm run latch` never loads the Seller Lens extension, never opens
www.flipkart.com's product page, and needs no consumer login. It goes from a label PDF straight to
the seller form.

**Why.** The flow as described was: search flipkart.com → open the product → Flipkart's *Seller
Lens* extension panel appears → click **Latch on** there. Automating that meant side-loading an
MV3 extension into Playwright's Chrome and clicking inside a Plasmo shadow-DOM panel — possible,
but a lot of machinery. The extension was already unpacked in Vansh's everyday Chrome, so it could
be read instead of guessed at, and its entire Latch-on handler is one line:

```js
chrome.runtime.sendMessage({ action: "openNewTab", url: getStartSellingURL(productId) })
```

against `START_SELLING: ${SELLER_DASHBOARD_URL}index.html#dashboard/listings/product/na?fsn=FSN_ID
&sourceid=SELECTION_INSIGHTS_UI`. The panel, its shadow DOM and its side panel are scenery: **the
latch is a URL, and the FSN is the `pid=` already in every flipkart.com product URL.** So the only
thing that has to be found is the FSN, which is one search away.

**The general lesson, which is the reason this note exists.** An extension whose source is on disk
is documentation. Reading `flipkart.70f98deb.js` took ten minutes and removed the extension, the
consumer login, the shadow DOM and the side panel from the design at once. Automating the UI
somebody built on top of a link is the expensive way to click the link.

**What did have to be learnt from the live account**, because it is not in the extension:

- The card page needs one more click, **START SELLING**, before the form exists.
- That link carries the answer in its own class — `startSelling listingsModalLink` (latchable),
  `disabled startSelling` (already selling), `applyForApprovalLink startSelling` (not approved for
  that vertical). The first version knew only the first and reported the other two as failures.
- The form is a modal on the same URL, so `input[name=sku_id]` appearing is the only honest signal
  that it opened.

**When to change it.** If Flipkart moves the latch behind something that is not a GET — a POST, or
a token minted by the extension — then the extension goes back in the design, and its folder is at
`~/Library/Application Support/Google/Chrome/Default/Extensions/ojboogfmlehbcggdlbgacckibolpmcdh/`.

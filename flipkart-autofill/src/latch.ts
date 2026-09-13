/**
 * latch.ts — open a latch form per product in a label pack, ten at a time.
 *
 *   npm run latch -- ~/Downloads/invoice_labels_*.pdf
 *   npm run latch -- labels.pdf --batch=5 --skip=20
 *
 * Latching is listing against a catalog entry somebody else created, and Flipkart's own Seller Lens
 * extension does it with a link (see `startSellingUrl`) — so this needs no extension, and no
 * flipkart.com login either. What it does need is YOUR seller session in ./profile, because the
 * form that opens is the one on your account.
 *
 * **It stops one field short on purpose.** Every tab lands on the latch form with the product
 * chosen; the SKU is typed by hand, because the SKU on the label is the OTHER seller's and only
 * Vansh knows which of his it should be. Price and stock are on the same form and also his.
 *
 * It also refuses rather than guesses: a product whose listing cannot be identified with certainty
 * gets a search link printed instead of a tab. A wrong latch is a listing to hunt down and delete.
 */

import type { Page } from "playwright";
import { openBrowser, activePage, checkLogin, pressEnter } from "./connect.js";
import {
  latchValues, openLatchForm, pickProduct, readLabels, searchProducts, searchTerms, searchUrl,
  startSellingUrl,
} from "./latch-core.js";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const num = (flag: string, fallback: number) => {
  const hit = args.find((a) => a.startsWith(`--${flag}=`));
  const n = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const BATCH = num("batch", 10);
/** Vansh, 2026-09-13: "keep the listing price too 220 and mrp to 999". Flags so they can change. */
const VALUES = latchValues({ MRP: String(num("mrp", 999)), "Your selling price": String(num("price", 220)) });
const SKIP = num("skip", 0);

if (!files.length) {
  console.error(`Usage: npm run latch -- <label.pdf> [more.pdf ...] [--batch=10] [--skip=0]`);
  process.exit(1);
}

const items = readLabels(files).slice(SKIP);
console.log(`\n${items.length} product(s) to latch, most-shipped first.\n`);

const { context, close } = await openBrowser();
if (!(await checkLogin(await activePage(context)))) {
  console.warn(`⚠️  Not logged in to Flipkart Seller — the latch forms will bounce to the login page.
   Log in in the window that just opened (or Ctrl+C and run: npm run login).`);
  await pressEnter("Log in, then come back here.");
}

let scratchPage: Awaited<ReturnType<typeof activePage>> | null = null;
async function scratch() {
  if (!scratchPage || scratchPage.isClosed()) scratchPage = await context.newPage();
  return scratchPage;
}

const byHand: string[] = [];

for (let start = 0; start < items.length; start += BATCH) {
  const batch = items.slice(start, start + BATCH);
  console.log(`\n─── ${start + 1}–${start + batch.length} of ${items.length} ───`);

  const open: { sku: string; fsn: string; title: string }[] = [];
  for (const item of batch) {
    // Each term is a fallback for the one before, so only the last one's near-misses are worth
    // reporting — an earlier, longer term finding nothing is the normal case, not a failure.
    let pick = null;
    for (const term of searchTerms(item.description)) {
      pick = pickProduct(item.description, await searchProducts(await scratch(), term));
      if (pick.hit) break;
    }
    if (pick?.hit) {
      console.log(`  ✓ ${item.sku}  → ${pick.hit.title.slice(0, 70)}`);
      open.push({ sku: item.sku, ...pick.hit });
      continue;
    }
    console.log(`  ✗ ${item.sku}  ${item.description}`);
    byHand.push(
      `${item.sku}  ${pick?.why === "ambiguous" ? "more than one listing fits" : "not found"}\n` +
        `   label: ${item.description}\n` +
        (pick?.near ?? []).map((n) => `   ${n.score.toFixed(2)} ${n.fsn}  ${n.title.slice(0, 80)}`).join("\n") +
        `\n   search: ${searchUrl(item.description)}`,
    );
  }

  if (!open.length) { console.log("  nothing to open in this batch."); continue; }

  console.log("");
  let n = 0;
  for (const o of open) {
    const tab = await context.newPage();
    await tab.goto(startSellingUrl(o.fsn), { waitUntil: "domcontentloaded" }).catch(() => {});
    const state = await openLatchForm(tab, VALUES);
    n++;
    console.log(
      {
        form: `  tab ${n}: type SKU ${o.sku}  — form filled, cursor in the SKU box`,
        selling: `  tab ${n}: ${o.sku}  — you ALREADY sell this one; nothing to do`,
        approval: `  tab ${n}: ${o.sku}  — needs APPROVAL for that vertical before you can latch`,
        stuck: `  tab ${n}: ${o.sku}  — could not open the form; read the tab yourself`,
      }[state],
    );
  }
  await pressEnter(`Type the SKU in those tabs and Save them. Nothing is closed for you — leave them
open as long as you like. Press ENTER when you want the next ${BATCH}.`);
}

if (byHand.length) {
  console.log(`\n\n${byHand.length} product(s) need doing by hand — the listing could not be identified:\n`);
  console.log(byHand.join("\n\n"));
}

// Chrome is closed GRACEFULLY or the seller session is lost (see connect.ts) — but only once the
// user says so, because a tab still holding a half-filled form goes with it.
// Chrome is closed GRACEFULLY or the seller session is lost (see connect.ts) — but only when the
// user says so, because every tab still holding a half-filled form goes with it.
await pressEnter(`Done. Close your tabs, then press ENTER to close Chrome (that is what saves your login).`);
await close();
process.exit(0);

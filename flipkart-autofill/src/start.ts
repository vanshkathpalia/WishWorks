// start.ts — `npm start`. The only command anyone needs to know.
//
// Everything else in this folder is a tool for fixing things when they break. This is
// the everyday path: pick a product from a numbered list, fill the form, and — when every
// field reads back clean — SAVE IT, with no question in between.
//
//   npm start              fill, then save if the read-back is clean
//   npm start -- --no-save fill only, never click Save (for testing on a live listing)
//
// Nothing auto-saves while any field reads ⚠️. That guard is the safety model and is older
// than the auto-save; it is not negotiable.
import path from "node:path";
import { openBrowser, pressEnter, activePage, checkLogin, ask } from "./connect.js";
import { clickSave } from "./fields.js";
import {
  listProducts, loadProduct, checkValues, describeProblems,
  fillAll, printReport, needsEyes, explainMismatches,
} from "./listing.js";

console.log(`
╔══════════════════════════════════════════════╗
║   WishWorks — Flipkart listing filler        ║
╚══════════════════════════════════════════════╝`);

// ---- 1. pick the product ----------------------------------------------------
const products = listProducts();
if (!products.length) {
  console.error(`
No products found in the "products" folder.

To add one: ask Claude/Gemini for the product JSON (the prompt is in START-HERE.md),
save what it gives you as products/<name>.json, then run this again.`);
  process.exit(1);
}

console.log(`\nWhich product are you listing?\n`);
products.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${path.basename(p, ".json")}`));

const pick = Number((await ask(`\nType a number (1-${products.length}) and press ENTER: `)).trim());
if (!Number.isInteger(pick) || pick < 1 || pick > products.length) {
  console.error(`\n"${pick}" isn't one of the numbers above. Run npm start again.`);
  process.exit(1);
}
const chosen = products[pick - 1];

// ---- 2. check the data before touching the browser --------------------------
const { values, usedDefaults, category } = loadProduct(chosen);
const problems = checkValues(values);
if (problems.length) {
  console.error(`\n${describeProblems(problems)}\n
Nothing was typed. Fix the file above, then run npm start again.`);
  process.exit(1);
}
console.log(`\nProduct : ${path.basename(chosen, ".json")}
Category: ${category}
Using   : ${usedDefaults.join(" + ") || "(no defaults file)"}
Values  : ${Object.keys(values).length} fields ready`);

// ---- 3. fill ----------------------------------------------------------------
const { context } = await openBrowser();
if (!(await checkLogin(await activePage(context)))) {
  console.warn(`
⚠️  Not logged in. Log in in the Chrome window that just opened — you only ever
   have to do this once, the login is remembered afterwards.`);
}

await pressEnter(`
In the Chrome window that just opened:
  1. Listings  →  Add New Listing  →  pick the category
  2. Open the tab you want filled ("Additional Description", or
     "Price, Stock and Shipping")
  3. Scroll it to the bottom once so every field appears
  4. Leave that tab showing, then come back here`);

const page = await activePage(context);
console.log(`\nFilling…\n`);
const report = await fillAll(page, values);
printReport(report);
await explainMismatches(page, report);

// ---- 4. save ----------------------------------------------------------------
//
// Saves IMMEDIATELY when every field read back clean — no "save now? (y/n)". The prompt used to
// sit between the last field and the Save click, and Flipkart's draft carries a `requestVersion`
// that the page can outgrow while it waits for a human. Removing the wait is free and removes one
// variable; it is NOT a diagnosed fix, because the 500 has never been explained (see below).
//
// The ⚠️ guard is untouched and is the actual safety model: nothing auto-saves while any field
// disagrees with what we typed. That rule predates this change and outranks it.
const skipSave = process.argv.includes("--no-save");

if (needsEyes(report)) {
  console.log(`\n⚠️  ${needsEyes(report)} field(s) above need a human look, so this will NOT save
   automatically. Check them in Chrome. If they're fine, click Save yourself.`);
} else if (skipSave) {
  console.log(`\nEverything typed was read back and matched. --no-save given, so nothing was clicked.`);
} else {
  console.log(`\nEverything typed was read back and matched. Saving now…`);
  const { clicked, candidates } = await clickSave(page);
  console.log(
    clicked
      ? `\n💾 Clicked "${clicked}". Look at Chrome for the result.
   A red "Could not save your changes" is Flipkart's server, not a field of ours — open
   DevTools > Network > the failed request > Response and keep the txnId for support.`
      : `\n⚠️  Couldn't find the Save button${candidates.length ? `. Buttons here: ${candidates.join(" | ")}` : ""}.
   Click Save in Chrome yourself.`
  );
}

// Chrome must outlive this script — closing it here would wipe everything just typed.
//
// This warning is not decoration. The old wording was "just close the Chrome window — this will
// finish by itself", which reads as "closing it is how you finish" — and Vansh read it exactly
// that way, closed Chrome, and lost the fill. "This" was the SCRIPT, never the listing. Say what
// is at stake, with the number, every time.
console.log(`
────────────────────────────────────────────────
❗ NOTHING IS SAVED YET. Closing Chrome now throws away all ${report.filled.length} filled fields.

   Click SAVE / Send for QC in Chrome first. Only then close the window —
   closing it ends this script, it does not save the listing.
────────────────────────────────────────────────`);
await new Promise<void>((resolve) => context.once("close", () => resolve()));
console.log(`Done. Your login is saved for next time.`);
process.exit(0);

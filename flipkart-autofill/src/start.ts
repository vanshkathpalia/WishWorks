// start.ts — `npm start`. The only command anyone needs to know.
//
// Everything else in this folder is a tool for fixing things when they break. This is
// the everyday path: pick a product from a numbered list, fill the form, decide whether
// to save. No file paths, no flags, no JSON on the command line.
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
if (needsEyes(report)) {
  console.log(`\n⚠️  ${needsEyes(report)} field(s) above need a human look, so this will NOT save
   automatically. Check them in Chrome. If they're fine, click Save yourself.`);
} else {
  console.log(`\nEverything typed was read back and matched.`);
  const yes = /^y/i.test((await ask(`Save the listing now? (y/n) `)).trim());
  if (yes) {
    const { clicked, candidates } = await clickSave(page);
    console.log(
      clicked
        ? `\n💾 Clicked "${clicked}". Look at Chrome for a confirmation — Flipkart may still
   complain about a field it wants that we left blank.`
        : `\n⚠️  Couldn't find the Save button${candidates.length ? `. Buttons here: ${candidates.join(" | ")}` : ""}.
   Click Save in Chrome yourself.`
    );
  } else {
    console.log(`\nNot saved. Click Save in Chrome when you're ready.`);
  }
}

// Chrome must outlive this script — closing it here would wipe everything just typed.
console.log(`
────────────────────────────────────────────────
Chrome stays open so you can check the form.
When you're done, just close the Chrome window — this will finish by itself.
────────────────────────────────────────────────`);
await new Promise<void>((resolve) => context.once("close", () => resolve()));
console.log(`Done. Your login is saved for next time.`);
process.exit(0);

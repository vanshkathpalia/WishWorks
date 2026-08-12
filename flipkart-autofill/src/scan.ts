// scan.ts — category calibration. Open the listing form on the tab you want (e.g.
// "Additional Description (0/66)"), then run this: it discovers every visible field
// and writes categories/<name>.json — the template your product files fill in.
// Different category = run scan once on that category's form. No per-category code.
//
// It scans the tab you are LOOKING at (Flipkart opens the form in a new tab), and
// refuses to save if that tab is obviously not a listing form — otherwise you end up
// saving the search box and the account menu as "fields".
import fs from "node:fs";
import { openBrowser, pressEnter, activePage, checkLogin } from "./connect.js";
import { extractFields } from "./fields.js";
import { mergeScan } from "./listing.js";
import { CATEGORIES_DIR } from "./paths.js";

const name = process.argv[2] ?? "balloon-decoration";
const force = process.argv.includes("--force");

// opens your real Chrome with the saved profile — already logged in
const { context, close } = await openBrowser();
// Land on the real app (the bare domain serves the public marketing site) and report
// honestly. A missed detection warns but never blocks — you can see the browser.
if (!(await checkLogin(await activePage(context)))) {
  console.warn(`
⚠️  You are NOT logged in — Flipkart bounced us to the public site.
   Log in in the window that just opened (or run: npm run login),
   then navigate to the listing form and continue below.`);
}

await pressEnter(
  `In the browser: go to Listings → Add New Listing → your category,
open the tab you want to capture (Price/Stock, Product Description, or
Additional Description), and scroll it fully to the bottom so every field renders.

Leave that tab in the FOREGROUND, then come back here.`
);

// the tab the user is actually looking at — not necessarily the one we opened
const page = await activePage(context);
console.log(`\nScanning: ${page.url()}`);

const found = await extractFields(page);

// The junk guard and the merge both live in listing.ts, shared with the app's Scan button —
// they decide what reaches disk, and that is the last thing that should exist in two copies.
// Resolved from this file's location, never process.cwd(): running the scan from anywhere but
// the project folder used to silently write a categories/ tree in the wrong place.
let merged;
try {
  merged = mergeScan(name, found, CATEGORIES_DIR, force);
} catch (err) {
  console.error(`
⛔ ${err instanceof Error ? err.message : String(err)}

   Try again: run scan, click Listings → Add New Listing → pick your category,
   open a tab such as "Additional Description (0/66)", scroll to the bottom,
   then press ENTER here.
   (Use --force if you really meant to capture this page.)`);
  await close();
  process.exit(1);
}
const { file, added: fresh } = merged;
const existing = JSON.parse(fs.readFileSync(file, "utf8"));

// Flipkart prints its own attribute count in the tab header — "Additional Description
// (0/66)". Read it and compare, so you get a definitive answer to "did I miss any?"
// instead of having to eyeball two lists.
const tabCounts = await page.evaluate(() => {
  const out: Array<{ tab: string; filled: number; total: number }> = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    if (el.children.length) continue;
    const m = /^\s*\((\d+)\s*\/\s*(\d+)\)\s*$/.exec(el.innerText ?? "");
    if (m) {
      const tab = (el.parentElement?.innerText ?? "").split("\n")[0].trim();
      out.push({ tab, filled: Number(m[1]), total: Number(m[2]) });
    }
  }
  return out;
});

console.log(`\nCaptured ${fresh.length} new fields (${existing.fields.length} total) → ${file}`);
for (const f of fresh) {
  const opts = f.options?.length ? `  options: ${f.options.join(" | ")}` : "";
  console.log(`  • ${f.label}  [${f.kind}${f.multi ? ", multi" : ""}]${opts}`);
}

const attrs = existing.fields.filter(
  (f: { companion?: boolean; furniture?: boolean }) => !f.companion && !f.furniture
).length;
const companions = existing.fields.filter((f: { companion?: boolean }) => f.companion).length;
const furniture = existing.fields.filter((f: { furniture?: boolean }) => f.furniture).length;
console.log(`\n──────── COVERAGE ────────
attributes captured : ${attrs}
unit/option pickers  : ${companions}  (belong to the field above them)\npage furniture       : ${furniture}  (FSN etc — not category attributes)`);

if (tabCounts.length) {
  console.log(`\nFlipkart's own counters on this page:`);
  for (const t of tabCounts) console.log(`  ${t.tab || "(tab)"} → ${t.total} attributes`);

  // Compare against the SUM of the tabs, not the biggest one.
  //
  // This file MERGES every tab you scan — that is the whole point of running scan once per tab.
  // The check used to measure the merged total against the single largest counter, so scanning
  // three tabs (17 + 7 + 66) reported "87 captured vs 66 — 21 extra. Delete those lines", which
  // is advice to throw away the Price/Stock tab. Vansh hit exactly that and was right to
  // question it (C-047). Flipkart renders every tab's header with its own count on the page, so
  // summing them is the honest denominator.
  // Compare ROWS, not `attrs`. Flipkart counts a field and its unit picker as ONE attribute
  // ("Weight" with its kg/g dropdown), while `attrs` deliberately excludes companions — so
  // measuring attrs against Flipkart's number reports 3 phantom gaps on a fully captured tab.
  //
  // Photo tabs are excluded outright: "Image addition (0/5)" counts upload slots, which have no
  // label and no control to fill, so they can never be captured and would sit in the total
  // forever as 5 permanently missing fields.
  const fillable = tabCounts.filter((t) => !/image|photo|picture/i.test(t.tab));
  const total = fillable.reduce((n, t) => n + t.total, 0);
  const skipped = tabCounts.filter((t) => !fillable.includes(t));
  for (const t of skipped) console.log(`  (ignoring "${t.tab}" — upload slots, nothing to fill)`);

  const diff = existing.fields.length - total;
  console.log(
    diff === 0
      ? `\n✅ ${existing.fields.length} captured vs ${total} across ${fillable.length} tab(s) — complete.`
      : diff > 0
        ? `\n⚠️  ${existing.fields.length} captured vs ${total} — ${diff} more than the form admits to.
   Usually page furniture (e.g. "Rate Card"). Check those lines before deleting them.`
        : `\n${-diff} of ${total} not captured yet. Normal until every tab has been scanned —
   this file merges, so scan the rest. If you have done them all, the missing ones are below
   the fold on some tab: scroll it fully to the bottom and run scan again.`
  );
}
console.log(`\nSwitch to another tab of the form and run scan again to capture more.
(Your login is saved — you'll never be asked for the OTP again.)`);
await close();
process.exit(0);

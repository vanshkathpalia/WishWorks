// fill.ts — the flag-driven version, for debugging and scripting.
//   npm run fill -- products/my-combo.json [--save] [--probe-html] [--save-button="Save"]
//
// Everyday use is `npm start`, which asks the same questions through a menu. Both share
// src/listing.ts, so a fix here lands in both.
import { openBrowser, pressEnter, activePage, checkLogin } from "./connect.js";
import { clickSave } from "./fields.js";
import {
  loadProduct, checkValues, describeProblems,
  fillAll, printReport, needsEyes, explainMismatches,
} from "./listing.js";

const FLAGS = ["--probe-html", "--save"];
const args = process.argv.slice(2).filter((a) => !FLAGS.includes(a) && !a.startsWith("--save-button="));
const probeHtml = process.argv.includes("--probe-html");
const wantSave = process.argv.includes("--save");
const saveButton = process.argv.find((a) => a.startsWith("--save-button="))?.split("=")[1];
const productFile = args[0];
if (!productFile) {
  console.error(`Usage: npm run fill -- products/<product>.json [--save]
   (or just run:  npm start)`);
  process.exit(1);
}

const { values, usedDefaults } = loadProduct(productFile);
for (const f of usedDefaults) console.log(`↳ defaults: ${f}`);

// Everything that can be caught without a browser, is — a placeholder or a comma-split
// value would otherwise only surface after 30 fields had already been typed.
const problems = checkValues(values);
if (problems.length) {
  console.error(`\n${describeProblems(problems)}\n`);
  process.exit(1);
}

// No `close` handle on purpose — fill must never close the browser (see the end of this
// file). Ctrl+C is handled inside openBrowser and closes Chrome gracefully.
const { context } = await openBrowser();
if (!(await checkLogin(await activePage(context)))) {
  console.warn(`
⚠️  You are NOT logged in — Flipkart bounced us to the public site.
   Log in in the window that just opened (or run: npm run login),
   then navigate to the listing form and continue below.`);
}
await pressEnter(
  `In the browser: open the listing form for this product and the tab you want filled,
and leave that tab in the FOREGROUND
(run fill once per tab — it only touches fields it can see).`
);

const page = await activePage(context);
console.log(`\nFilling on: ${page.url()}\n`);

const report = await fillAll(page, values);
printReport(report);
await explainMismatches(page, report, probeHtml);

// ---- saving ----------------------------------------------------------------
// Opt-in: the contract is that a human sees the values before they are committed. But
// NOT offering it at all is worse — a filled form that dies with the browser is 30
// fields of work thrown away, which is exactly what happened once.
if (wantSave) {
  if (needsEyes(report)) {
    console.log(`\n⚠️  NOT saving — ${needsEyes(report)} field(s) are wrong (listed above).
   Fix those first, or save by hand in the browser if you disagree.`);
  } else {
    const { clicked, candidates } = await clickSave(page, saveButton);
    console.log(
      clicked
        ? `\n💾 Clicked "${clicked}". Check the page for a confirmation or a validation error —
   Flipkart may still reject required fields we left blank.`
        : `\n⚠️  Could not find a Save button.${candidates.length
            ? ` Buttons seen: ${candidates.join(" | ")}
   Re-run with --save-button="<exact text>" to pick one.`
            : " None matched save/submit — save it by hand."}`
    );
  }
}

// The browser MUST outlive this script: Playwright kills the browser when this process
// exits, so we don't exit — we idle until YOU close the window.
console.log(`\n${wantSave ? "" : `❗ NOTHING HAS BEEN SAVED YET — closing Chrome now discards all ${report.filled.length} filled fields.
   Click Save in the browser, or re-run with --save to have this do it for you.\n`}
Chrome is yours now — review the form${wantSave ? "" : " and Save / Send for QC"}.
This terminal is only waiting; it will exit by itself when you close the Chrome window.
(Ctrl+C here also closes it cleanly — your login is preserved either way.)`);
await new Promise<void>((resolve) => context.once("close", () => resolve()));
console.log(`Chrome closed. Login saved for next time.`);
process.exit(0);

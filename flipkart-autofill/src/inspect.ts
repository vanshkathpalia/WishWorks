// inspect.ts — the "what IS that field, really?" tool.
//   npm run inspect -- "Ideal For" "Warranty Summary"
// Finds each label the same way fill does, then dumps what the widget actually is:
// tag, role, readOnly/disabled, current value, and the surrounding row's text + markup.
//
// fill now auto-probes its own mismatches, so this is for questions fill didn't raise —
// checking a field before writing a default for it, or re-examining a form by hand.
// Read-only: nothing is typed, nothing is saved.
import { openBrowser, pressEnter, activePage, checkLogin } from "./connect.js";
import { probeField, probeStructure } from "./fields.js";

const structure = process.argv.includes("--structure");
const labels = process.argv.slice(2).filter((a) => a !== "--structure");
if (!labels.length) {
  console.error(`Usage: npm run inspect -- "Ideal For" "Warranty Summary" ...
       npm run inspect -- --structure "Warranty Summary"   (label-first row dump)`);
  process.exit(1);
}

const { context, close } = await openBrowser();
// Land on the seller app like scan/fill do — otherwise this opens on about:blank and
// there is no way to tell a logged-out session from "I just haven't navigated yet".
if (!(await checkLogin(await activePage(context)))) {
  console.warn(`
⚠️  You are NOT logged in — Flipkart bounced us to the public site.
   Log in in the window that just opened (or run: npm run login), then continue below.`);
}
await pressEnter(
  `In the browser: Listings → Add New Listing → your category → Additional Description.
Leave that tab in the FOREGROUND, then come back here.
Nothing will be typed or saved.`
);
const page = await activePage(context);
console.log(`\nInspecting on: ${page.url()}\n`);

for (const label of labels) {
  if (structure) {
    const rows = await probeStructure(page, label);
    console.log(`\n═══ ${label} — ${rows.length} element(s) render this text ═══`);
    rows.forEach((r, i) => {
      console.log(`
  [${i}] label element : ${r.labelEl}
      levels up to a row containing a control : ${r.levelsUp}
      chain     : ${r.chain.join(" → ")}
      row class : ${r.rowClass}
      row text  : ${r.rowText}
      controls in this row:`);
      for (const c of r.controls) {
        console.log(`        <${c.tag}${c.type ? ` type=${c.type}` : ""}${c.role ? ` role=${c.role}` : ""}>` +
          `${c.name ? ` name=${c.name}` : ""}` +
          `${c.qualifier ? "  ⟵ QUALIFIER (unit picker)" : ""}` +
          `\n          class=${c.cls}  value=${JSON.stringify(c.value)} text=${JSON.stringify(c.text)}`);
      }
      console.log(`      ---- row html ----\n${r.rowHtml}`);
    });
    continue;
  }
  const p = await probeField(page, label);
  console.log(`\n═══ ${label} ═══`);
  if (!p) {
    console.log("  ❌ no visible input matched this label on the current tab");
    continue;
  }
  console.log(`  widget     : <${p.tag}${p.type ? ` type=${p.type}` : ""}>${p.role ? ` role=${p.role}` : ""}  kind=${p.kind}
  state      : readOnly=${p.readOnly} disabled=${p.disabled}
  value      : ${JSON.stringify(p.value)}
  pills      : ${p.pills.length ? p.pills.join(" | ") : "(none)"}
  row's label: ${JSON.stringify(p.rowLabel)}${p.rowLabel.trim().toLowerCase() === label.trim().toLowerCase() ? "" : "   ⛔ WRONG ROW"}
  row text   : ${p.rowText}
  ---- row html ----
${p.rowHtml}`);
}

console.log(`\nDone — nothing was typed or saved.`);
await close();
process.exit(0);

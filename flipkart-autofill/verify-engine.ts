// verify-engine.ts — `npm run verify`. Runs the real engine against a replica of
// Flipkart's markup, copied verbatim from live-form dumps (2026-07-20). No login, no
// network, ~2s — so engine changes get tested here BEFORE costing a real browser session.
//
// The cases are the bugs that actually happened, not invented ones: five warranty labels
// collapsing onto one "Year" qualifier, pill inputs reading back empty, tooltip prose
// being mistaken for a label. If you change fields.ts, run this first.
import { chromium } from "playwright";
import { extractFields, fillField, probeField } from "./src/fields.js";

const row = (label: string, control: string, qualifier = "") => `
<div class="styles__EditAttributeItemWrapper-sc-gni56x-0 eKFGEi">
  <div class="styles__EditAttributeNameWrapper-sc-gni56x-1 cqxwyI">
    <div class="styles__AttributeItemLabelContainer-sc-pee2qx-0 jSxNep">
      <div class="styles__AttributeItemLabelName-sc-pee2qx-1 buFpRI">${label}</div>
      <div class="styles__AttributeItemLabelIcon-sc-pee2qx-2 bexLCb">
        <div class="styles__TooltipContent-sc-pee2qx-3 fkKGkq">Tooltip prose that must never be read as a label.</div>
      </div>
    </div>
  </div>
  <div class="styles__EditAttributeFieldWrapper-sc-gni56x-2 hfRaqK">
    <div class="styles__AttributeItemFieldWrapper-sc-ske8mu-0 eymeAb">
      <div class="styles__AttributeItemFieldContainer-sc-ske8mu-1 kCSGBG">
        <div class="styles__AttributeItemFormElementWrapper-sc-ske8mu-17 AXwAT">${control}</div>
        ${qualifier}
      </div>
    </div>
  </div>
</div>`;

const textInput = `<div class="styles__InputContainer-sc-srjv57-10 hVDtSX">
  <input data-testid="" placeholder="" type="text" class="styles__StyledInput-sc-srjv57-4 cCaujc" value="">
</div>`;

const numberInput = `<div class="styles__InputContainer-sc-srjv57-10 hVDtSX">
  <input data-testid="" placeholder="" required="" type="number" class="styles__StyledInput-sc-srjv57-4 cCaujc" value="0">
</div>`;

const pills = (name: string) => `
  <div aria-labelledby="${name}" class="rti--container">
    <input class="rti--input pills-input-field" type="text" name="${name}" placeholder="">
  </div>
  <div class="rti--helper-text">Multiple values allowed. Press “Enter” or “,” after each value</div>`;

// The qualifier that swallowed five warranty labels.
const yearQualifier = `
  <div class="styles__AttributeItemQualifierWrapper-sc-ske8mu-15 iweYLJ">
    <div class="styles__SingleSelectContainer-sc-zkytp-0 gzCoVP">
      <button role="combobox" data-testid="trigger-single-select" aria-expanded="false" tabindex="0"
              class="styles__DropdownButton-sc-lf8o9y-0 kgSuQD">
        <div class="styles__ButtonText-sc-lf8o9y-1 lmgqhp">Year</div>
      </button>
    </div>
  </div>`;

// A single-select dropdown: button + popover with a search box and clickable options.
// Typing + Enter does NOT commit here — only a click does, same as the real widget.
const dropdown = (options: string[]) => `
  <div class="styles__SingleSelectContainer-sc-zkytp-0 gzCoVP">
    <button role="combobox" data-testid="trigger-single-select" aria-expanded="false" tabindex="0"
            class="styles__DropdownButton-sc-lf8o9y-0 kgSuQD">
      <div class="styles__ButtonText-sc-lf8o9y-1 lmgqhp">Select</div>
      <svg class="murv-icons"><title>ExpandMore</title></svg>
    </button>
    <div data-testid="content-single-select" role="dialog" class="styles__Content-sc-1eyz3ph-0" style="display:none">
      <div class="styles__DropdownContent-sc-zkytp-1">
        <div class="styles__CheckMarkGroupSearchWrapper-sc-1fq4v65-3">
          <input class="search-box" type="text" placeholder="">
        </div>
        ${options.map((o) => `<div role="option" class="opt"><div>${o}</div></div>`).join("")}
      </div>
    </div>
  </div>`;

const HTML = `<!doctype html><html><body style="font-family:sans-serif">
${row("Model Name", textInput)}
${row("Ideal For", pills("ideal_for"))}
${row("Purpose", pills("purpose"))}
${row("Hand Crafted", dropdown(["Yes", "No"]))}
${row("Gift Pack", dropdown(["Yes", "No"]))}
${row("Domestic Warranty", numberInput, yearQualifier)}
${row("International Warranty", numberInput, yearQualifier)}
${row("Warranty Summary", textInput)}
${row("Covered in Warranty", textInput)}
${row("Not Covered in Warranty", textInput)}
<script>
// Minimal react-tag-input behaviour, matching the real widget's quirks:
//  - Enter commits the text as a chip and clears the box
//  - "," ALSO commits — so a comma inside a value splits it in two
//  - each chip carries a "Close" remove button, which lands in textContent
const commit = (inp, text) => {
  const t = text.trim();
  if (!t) return;
  const tag = document.createElement("span");
  tag.className = "rti--tag";
  tag.innerHTML = "<span>" + t + "</span><button>Close</button>";
  inp.parentElement.insertBefore(tag, inp);
};
document.querySelectorAll(".rti--input").forEach((inp) => {
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { commit(inp, inp.value); inp.value = ""; }
  });
  inp.addEventListener("input", () => {
    if (!inp.value.includes(",")) return;
    const parts = inp.value.split(",");
    parts.slice(0, -1).forEach((p) => commit(inp, p));
    inp.value = parts[parts.length - 1];
  });
});
// Dropdown: opens on click, filters on search, commits ONLY on an option click.
document.querySelectorAll('[data-testid="trigger-single-select"]').forEach((btn) => {
  const box = btn.parentElement;
  const pop = box.querySelector('[role=dialog]');
  btn.addEventListener("click", () => { pop.style.display = "block"; box.querySelector(".search-box").focus(); });
  box.querySelector(".search-box").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    pop.querySelectorAll(".opt").forEach((o) => {
      o.style.display = o.textContent.toLowerCase().includes(q) ? "block" : "none";
    });
  });
  pop.querySelectorAll(".opt").forEach((o) => {
    o.addEventListener("click", () => {
      btn.querySelector('[class*=ButtonText]').textContent = o.textContent.trim();
      pop.style.display = "none";
    });
  });
});
</script></body></html>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent(HTML);

let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};

// ---- discovery ----
const fields = await extractFields(page);
console.log("\nDISCOVERED:");
for (const f of fields) console.log(`  • ${f.label}  [${f.kind}${f.multi ? ", multi" : ""}${f.companion ? ", companion" : ""}]`);

check("10 attributes + 2 unit pickers discovered", fields.length === 12, `got ${fields.length}`);
check("Ideal For detected as pills", fields.find((f) => f.label === "Ideal For")?.kind === "pills");
check("Warranty Summary detected as text",
  fields.find((f) => f.label === "Warranty Summary")?.kind === "text");
check("Year picker exposed as a companion, not an attribute",
  fields.find((f) => f.label === "Domestic Warranty (unit)")?.companion === true);
check("no label leaked from a tooltip",
  !fields.some((f) => /tooltip|prose/i.test(f.label)));

// ---- the regression that started all this ----
console.log("\nTARGETING (the warranty collision):");
for (const label of ["Warranty Summary", "Covered in Warranty", "Not Covered in Warranty", "International Warranty"]) {
  const p = await probeField(page, label);
  check(`${label} targets its OWN row`, p?.rowLabel === label, `row's label = ${JSON.stringify(p?.rowLabel)}`);
}

// ---- filling ----
console.log("\nFILLING:");
const r1 = await fillField(page, "Model Name", "Black Gold Birthday Decoration Kit");
check("Model Name filled", r1.status === "filled", `${r1.status} / ${JSON.stringify(r1.actual)}`);

const r2 = await fillField(page, "Ideal For", ["Boys", "Girls", "Men", "Women"]);
check("Ideal For pills filled + read back", r2.status === "filled", `${r2.status} / ${JSON.stringify(r2.actual)}`);

const r3 = await fillField(page, "Warranty Summary", "No warranty on decorative items");
check("Warranty Summary filled", r3.status === "filled", `${r3.status} / ${JSON.stringify(r3.actual)}`);

// The proof it did NOT type into the Year dropdown:
const domestic = await probeField(page, "Domestic Warranty");
check("Domestic Warranty untouched by the warranty fills", domestic?.value === "0",
  `value = ${JSON.stringify(domestic?.value)}`);

// The dropdown that kept reading "Select" — typing + Enter never committed it.
const r4 = await fillField(page, "Hand Crafted", "No");
check("Hand Crafted dropdown selected by clicking the option", r4.status === "filled",
  `${r4.status} / ${JSON.stringify(r4.actual)}`);
check("dropdown read-back excludes the chevron's ExpandMore title",
  !/expandmore/i.test(r4.actual ?? ""), JSON.stringify(r4.actual));

// A value Flipkart doesn't offer must name what IS offered, not just fail.
const r5 = await fillField(page, "Gift Pack", "Maybe");
check("unavailable option reports the real choices",
  r5.status === "mismatch" && /Yes/.test(r5.actual ?? "") && /No/.test(r5.actual ?? ""),
  `${r5.status} / ${JSON.stringify(r5.actual)}`);

// Chips must read back clean, without the remove button's "Close".
const r6 = await fillField(page, "Purpose", ["Decoration"]);
check("chip read-back strips the Close button text",
  r6.status === "filled" && !/close/i.test(r6.actual ?? ""), JSON.stringify(r6.actual));

// A pill input full of chips shrinks — it must still be findable.
const idealAfter = await probeField(page, "Ideal For");
check("pill input still found when the row is full of chips",
  idealAfter !== null && idealAfter.pills.length === 4, `pills = ${idealAfter?.pills.length}`);

const r7 = await fillField(page, "Nonexistent Field", "x");
check("unknown label reports not_found", r7.status === "not_found", r7.status);

await browser.close();
console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

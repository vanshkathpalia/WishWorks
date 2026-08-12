// listing.ts — the shared brain behind both commands.
//
//   npm start        → src/start.ts  (menu-driven, for everyday use)
//   npm run fill     → src/fill.ts   (flags, for debugging)
//
// Both do exactly the same work; only the front door differs. Keeping the logic here
// means a fix can never land in one command and be missing from the other.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { fillField, probeField, type FieldInfo } from "./fields.js";
import { normalizeId } from "./id.js";
import { CATEGORIES_DIR, PRODUCTS_DIR } from "./paths.js";

export type Values = Record<string, string | number | string[]>;

/**
 * Which tab's defaults file to use — `categories/<category>[.<tab>].defaults.json`.
 *
 * **This exists because the same label means different things on different tabs, in different
 * units.** `Height` is centimetres in Package Details on the Price/Stock tab and INCHES in the
 * Dimensions block on Additional Description. `Weight` is kilograms on one and can be grams on
 * the other. Merging every defaults file into one flat map — which is what this did until
 * 2026-08-12 — makes those indistinguishable, so one number gets typed into both: WW-123 put
 * 8 cm in one box and 8 inches in the other, and a 0.16 default overwrote a parcel measured at
 * 0.250. The workaround then was to delete the colliding keys and fill Package Details by hand.
 *
 * Scoping by tab is the actual fix, and it is what makes a universal Dimensions block safe to
 * store at all — without it, a `Weight: 280` meant as 280 g on the inches tab is 280 KG in the
 * Price/Stock box, which is WW-055's failure with three more zeroes.
 *
 * `""` is the bare `<category>.defaults.json`, which has always been the Additional Description
 * tab's file. `undefined` means "every file", the old behaviour, which is still what `npm run
 * fill` does — the CLI never knew which tab you were on and still does not.
 */
export type DefaultsTab = "" | "pricing" | "description";

export interface LoadedProduct {
  file: string;
  category: string;
  values: Values;
  usedDefaults: string[];
  /**
   * Labels we would send that exist on NO tab of the scanned form.
   *
   * The difference that matters when a fill reports a field "not found": a label on another tab
   * is fine and will land on the next pass, but a label the form does not have anywhere will
   * never land, on any pass, and silently sends nothing. Only the scan can tell them apart, so
   * this is empty when the category has never been scanned — never a false accusation.
   */
  unmapped: string[];
  /**
   * Questions ChatGPT raised about this listing rather than guessing — the values of any `_ask`
   * key in the product file.
   *
   * Vansh, 2026-08-12: *"if any confusion take my permission, flag it somewhere"*. The prompt
   * forbids inventing a fact and tells it to leave a field out when unsure, which is right but
   * silent: a field that is missing because nobody knew looks exactly like a field nobody
   * thought of. This is the difference, and it costs one key in a file that already strips
   * every `_`-prefixed key as a human note.
   *
   * Only `_ask` is collected. The other `_` keys are prose in the defaults files and would bury
   * a real question under three paragraphs of commentary.
   */
  asks: string[];
}

/** Labels captured by `npm run scan`, normalised the way fields.ts matches them. */
function scannedLabels(catDir: string, category: string): Set<string> | null {
  const file = path.join(catDir, `${category}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const { fields } = JSON.parse(fs.readFileSync(file, "utf8")) as { fields: { label: string }[] };
    return new Set(fields.map((f) => normLabel(f.label)));
  } catch {
    return null; // a damaged scan file must not stop a fill
  }
}

/** Same normalisation as `fields.ts` — trim, collapse spaces, lowercase, drop a trailing "*". */
const normLabel = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\*+$/, "");

/**
 * Every product available to fill — ONE entry per product, not per file. `ANP003.json` and
 * `products-ANP003.json` are the same listing saved twice (id.ts), and a menu that offers both
 * is a menu you can pick the stale one from. Newest file wins, same rule findById uses.
 */
export function listProducts(dir = PRODUCTS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  const newestPerId = new Map<string, string>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const full = path.join(dir, f);
    const seen = newestPerId.get(normalizeId(f));
    if (!seen || fs.statSync(full).mtimeMs > fs.statSync(seen).mtimeMs) newestPerId.set(normalizeId(f), full);
  }
  return [...newestPerId.values()].sort();
}

/**
 * Merge the category's defaults with the product's own values.
 *
 * All `categories/<category>.*.defaults.json` files are merged, then the product's
 * `values` override them — so one product file covers every tab of the form, and shared
 * answers live in one place instead of being copy-pasted per product.
 */
export function loadProduct(
  file: string,
  catDir = CATEGORIES_DIR,
  tab?: DefaultsTab,
): LoadedProduct {
  const product = JSON.parse(fs.readFileSync(file, "utf8"));
  const defaults: Values = {};
  const usedDefaults: string[] = [];
  // With a tab, ONE defaults file. Without, all of them — which is what the CLI does and what
  // this always did. See DefaultsTab for why the distinction is worth having.
  const want = tab === undefined ? null : `${product.category}${tab && `.${tab}`}.defaults.json`;
  if (fs.existsSync(catDir)) {
    for (const f of fs.readdirSync(catDir).sort()) {
      if (want ? f !== want : !(f.startsWith(`${product.category}.`) && f.endsWith(".defaults.json"))) {
        continue;
      }
      Object.assign(defaults, JSON.parse(fs.readFileSync(path.join(catDir, f), "utf8")));
      usedDefaults.push(f);
    }
  }
  const values: Values = { ...defaults, ...product.values };
  // Keys starting with "_" are notes for humans, not form fields. `_ask` is the one kind worth
  // carrying to the screen rather than dropping — see `asks`.
  const asks: string[] = [];
  for (const k of Object.keys(values)) {
    if (!k.startsWith("_")) continue;
    if (k.startsWith("_ask")) {
      const v = values[k];
      for (const line of Array.isArray(v) ? v.map(String) : [String(v)]) if (line.trim()) asks.push(line);
    }
    delete values[k];
  }
  deriveDescriptionTab(values);

  const known = scannedLabels(catDir, product.category);
  const unmapped = known
    ? Object.keys(values).filter((k) => !known.has(normLabel(k)) && !String(values[k]).startsWith("TODO_"))
    : [];

  return { file, category: product.category, values, usedDefaults, unmapped, asks };
}

/**
 * Two Product Description tab fields that are already stated elsewhere in the same file.
 *
 * Derived, never typed twice — one fact, one source (WW-110, and the same rule that keeps the
 * parcel dimensions out of `PROMPT-product.md`). Both are required fields on that tab, and both
 * were previously entered by hand, which is what this was reported as taking forever:
 *
 *   Model Number   = the SKU. Character for character the same string; a second copy is only
 *                    somewhere for a typo to live.
 *   Items Included = the "WHAT YOU GET" list PROMPT-product.md already makes ChatGPT write into
 *                    the Description, one item per line, each line starting with its count.
 *   Quantity       = the packed parcel, in GRAMS. Vansh, asked which weight the form means,
 *                    2026-08-12: *"the packed parcel, 280 gm"* — so it is the same measurement
 *                    `Weight` already carries in kilograms, and the Inventory panel already
 *                    computes it (`packaging.ts`). Multiplying by 1000 here is the whole job;
 *                    a second measured number would be a second thing to get wrong, which is
 *                    the exact shape of WW-055, where a wrong weight reached a live listing.
 *                    A product with no measured `Weight` gets NO Quantity — blank is visible,
 *                    a guessed weight is charged back at settlement.
 *
 * The count is what ends the list: stop at the first non-blank line that does not start with a
 * digit. Older listings put a heading ("KEY FEATURES", "Key Features") or two explanatory
 * paragraphs straight after the block, and both slipped in when the stop rule was
 * "next ALL-CAPS line" — measured against all 11 product files.
 *
 * A product that states either value itself always wins, and a description with no WHAT YOU GET
 * block (the pre-template listings) simply leaves the field blank, exactly as today.
 */
function deriveDescriptionTab(values: Values): void {
  if (!values["Model Number"] && values["Seller SKU ID"]) {
    values["Model Number"] = values["Seller SKU ID"];
  }
  if (!values["Quantity"]) {
    // Round: 0.245 kg × 1000 is 245.00000000000003 in binary floating point, and that is what
    // would have been typed into the box.
    //
    // The ceiling is the guard, not decoration. `Weight` is KILOGRAMS, but grams is the unit
    // everything else here is stored in, so writing 250 where 0.250 belongs is a slip anyone
    // makes once — and multiplying it gives 250000, which is 250 KG declared on a balloon kit.
    // That is WW-055 exactly ("Net Weight = 10000 g" reached a live listing and cost money at
    // settlement). 5 kg is far above the 490 g ceiling packaging.json enforces and far below
    // any plausible gram figure, so nothing real is refused and no slip gets through. A refused
    // value leaves the box EMPTY, which is visible; a converted one looks filled and is wrong.
    const kg = Number(values["Weight"]);
    if (Number.isFinite(kg) && kg > 0 && kg <= 5) values["Quantity"] = String(Math.round(kg * 1000));
  }
  if (values["Items Included"]) return;
  const lines = String(values["Description"] ?? "").split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /^WHAT YOU GET\b/i.test(l));
  if (start < 0) return;
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) continue;
    if (!/^\d/.test(line)) break;
    items.push(line);
  }
  if (items.length) values["Items Included"] = items;
}

export interface ScanResult {
  category: string;
  file: string;
  /** Only what this pass had not seen before — the rest of the file is other tabs. */
  added: FieldInfo[];
  /** Every label the category knows about now, across every tab ever scanned. */
  total: number;
}

/** Thrown instead of writing junk. Caught by name so the CLI can offer --force. */
export class ScanTooSmall extends Error {}

/**
 * Merge one tab's captured fields into `categories/<category>.json`.
 *
 * MERGES, never replaces — that is the whole reason scanning is done one tab at a time. The file
 * accumulates: Price/Stock, then Product Description, then Additional Description. New labels are
 * appended, labels already there are left exactly as they are, so re-scanning a tab is safe and
 * so is scanning them in any order.
 *
 * Shared by `npm run scan` and the app's Scan button on purpose. This is the part that must not
 * drift between them: it decides what gets written to disk, and the two front doors differ only
 * in how they got hold of a page.
 */
export function mergeScan(
  category: string,
  found: FieldInfo[],
  catDir = CATEGORIES_DIR,
  force = false,
): ScanResult {
  // A real listing tab has many labelled inputs. A dashboard has one or two — the search box and
  // the account menu — and saving those poisons the template for every future fill.
  if (found.length < 5 && !force) {
    throw new ScanTooSmall(
      `Only ${found.length} field(s) here — this does not look like a listing form.\n` +
        `Found: ${found.map((f) => `"${f.label}"`).join(", ") || "(nothing)"}\n` +
        `You are probably on the dashboard rather than a tab of Add New Listing. Nothing was saved.`,
    );
  }
  fs.mkdirSync(catDir, { recursive: true });
  const file = path.join(catDir, `${category}.json`);
  const existing = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as { category: string; fields: FieldInfo[] })
    : { category, fields: [] as FieldInfo[] };
  const known = new Set(existing.fields.map((f) => f.label));
  const added = found.filter((f) => !known.has(f.label));
  existing.fields.push(...added);
  (existing as Record<string, unknown>).scannedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
  return { category, file, added, total: existing.fields.length };
}

/**
 * The name buyers actually see, and what is wrong with it.
 *
 * Flipkart does not show the "Model Name". It composes the product name as
 * `<brand> <Color values, comma-separated, in order> <Type>` — measured 2026-08-12 by comparing
 * Vansh's form against his own live product page. So the most-read text on the whole listing is
 * assembled from two fields that look like ordinary attributes, and **nothing anywhere showed it
 * to him before he saved**. A live listing reads "Mutlicolor" for exactly that reason.
 *
 * No spell-check here, deliberately — a word list of the right spellings would rot and would
 * still miss the next typo. What this does is put the finished sentence in front of a human,
 * which is the only thing that catches one, plus the two mechanical faults that were both
 * present in that same live title and are cheap to prove: a word used twice, and an "&".
 *
 * The brand is not ours to know — it comes from the seller account — so it is left as a marker
 * rather than guessed.
 */
export function productName(values: Values): { name: string; warnings: string[] } | null {
  const colors = values["Color"];
  const type = values["Type"];
  if (!colors || !type) return null;
  const parts = Array.isArray(colors) ? colors.map(String) : [String(colors)];
  const name = `${parts.join(", ")} ${String(type)}`;
  const warnings: string[] = [];
  if (name.includes("&")) warnings.push(`"&" reads as a literal ampersand — write "and".`);
  const words: string[] = name.toLowerCase().match(/[a-z]+/g) ?? [];
  const twice = [...new Set(words.filter((w) => w.length > 3 && words.indexOf(w) !== words.lastIndexOf(w)))];
  if (twice.length) {
    warnings.push(`"${twice.join('", "')}" appear${twice.length > 1 ? "" : "s"} twice — the name is short, spend it once.`);
  }
  return { name, warnings };
}

export interface Problem {
  kind: "placeholder" | "comma" | "nonascii";
  label: string;
  value: string;
}

/**
 * The first character in a string that Flipkart's backend cannot store, or null.
 *
 * **This one kills the whole listing, not one field.** Emoji in a Description made Flipkart
 * return HTTP 500 on EVERY save — and because the form posts the entire draft on each edit, the
 * failure then follows you around: typing an unrelated word on an unrelated tab fails too, which
 * is exactly what it looks like when the field you are touching is blamed. It was proved by
 * deleting the Description on a live listing, at which point it saved immediately
 * (`PROMPT-product.md`, and the prompt has banned emoji ever since).
 *
 * The prompt banning them is not a guard: it asks a model to comply, and four product files in
 * this repo carry emoji and en-dashes anyway, because they were written before the ban. This is
 * the check that runs on the data rather than trusting the instructions that produced it.
 *
 * Newline and tab are fine — a Description is meant to have line breaks.
 */
function badChar(s: string): string | null {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c > 126) return ch;
  }
  return null;
}

/**
 * Everything that would go wrong BEFORE the browser opens.
 *
 * Both checks exist because they actually bit us: a TODO_ placeholder would have been
 * typed into a live listing, and a comma inside a multi-value entry silently splits it
 * in two ("Suitable for birthdays, anniversaries…" became two separate values) because
 * Flipkart treats "," as "end of value".
 */
export function checkValues(values: Values): Problem[] {
  const out: Problem[] = [];
  for (const [label, v] of Object.entries(values)) {
    if (String(v).startsWith("TODO_")) out.push({ kind: "placeholder", label, value: String(v) });
    if (Array.isArray(v)) {
      for (const s of v) if (s.includes(",")) out.push({ kind: "comma", label, value: s });
    }
    for (const s of Array.isArray(v) ? v : [String(v)]) {
      const ch = badChar(String(s));
      if (ch) {
        out.push({
          kind: "nonascii",
          label,
          value: `${JSON.stringify(ch)} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * The values that are safe to type, with every problem field left out.
 *
 * **A problem skips its own field and stops nothing else.** It used to stop the whole run: two
 * placeholders meant sixty good fields went untyped and the operator filled the form by hand.
 * Vansh, 2026-08-12: *"we should have the freedom to let it continue even if any issue comes —
 * just flag, warn about it later on."*
 *
 * Skipped, never typed-anyway, and that half is not negotiable. `TODO_MRP` in the MRP box is a
 * live listing carrying a fake price, and a comma inside a multi-value entry silently becomes two
 * wrong values (WW-012) — both are worse than an empty box, because an empty box is visible and a
 * wrong value looks filled. The bot never submits, so what it leaves blank is what the human fills
 * before pressing Save.
 */
export function fillableValues(values: Values, problems: Problem[]): Values {
  const skip = new Set(problems.map((p) => p.label));
  return Object.fromEntries(Object.entries(values).filter(([label]) => !skip.has(label)));
}

export function describeProblems(problems: Problem[]): string {
  const lines: string[] = [];
  const todos = problems.filter((p) => p.kind === "placeholder");
  const commas = problems.filter((p) => p.kind === "comma");
  if (todos.length) {
    lines.push(`⚠️  Still placeholders — these fields are LEFT BLANK, everything else is filled:`);
    for (const p of todos) lines.push(`   ${p.label} = ${p.value}`);
  }
  const bad = problems.filter((p) => p.kind === "nonascii");
  if (bad.length) {
    lines.push(`⛔ These contain a character Flipkart's server cannot store, so they are LEFT BLANK:`);
    for (const p of bad) lines.push(`   ${p.label} contains ${p.value}`);
    lines.push(`   This is the one that breaks EVERYTHING, not just its own field: the form posts the`);
    lines.push(`   whole listing on every edit, so one emoji or en-dash makes "Could not save your`);
    lines.push(`   changes" appear on every field you touch afterwards, on every tab. Replace them`);
    lines.push(`   with plain ASCII — "-" for a dash, and delete emoji entirely.`);
  }
  if (commas.length) {
    lines.push(`⚠️  These multi-value entries contain a comma, which Flipkart would split in two,`);
    lines.push(`    so they are LEFT BLANK too:`);
    for (const p of commas) lines.push(`   ${p.label}: "${p.value}"`);
    lines.push(`   Rewrite them without commas — "and" or a dash reads fine.`);
  }
  if (lines.length) lines.push(`   Type these into the form yourself before you press Save.`);
  return lines.join("\n");
}

export interface Report {
  filled: string[];
  notFound: string[];
  failed: string[];
  mismatch: string[];
}

/** One field's outcome, as data. The ✅/⚠️/⏭️/❌ is a rendering of `status`, never the other way
 *  round — a UI that could only reprint terminal text would be no better than the terminal. */
export interface FieldRow {
  label: string;
  /** What we tried to type, already flattened the way a list field displays it. */
  want: string;
  status: "filled" | "not_found" | "mismatch" | "failed";
  /** What the form showed afterwards. Only meaningful for `mismatch`. */
  actual?: string;
}

/**
 * Type every value into the open form.
 *
 * `onField` fires as each one lands, for a live table. **When it is given nothing is printed** —
 * that is what lets the app drive the same code without stdout noise, while `npm start` (which
 * passes no callback) prints exactly what it always did.
 */
export async function fillAll(
  page: Page,
  values: Values,
  onField?: (row: FieldRow) => void,
): Promise<Report> {
  const report: Report = { filled: [], notFound: [], failed: [], mismatch: [] };
  for (const [label, value] of Object.entries(values)) {
    const want = Array.isArray(value) ? value.join(", ") : String(value);
    const { status, actual } = await fillField(page, label, value);
    const say = (line: string) => {
      if (!onField) console.log(line);
    };
    switch (status) {
      case "filled":
        report.filled.push(label);
        say(`✅ ${label} = ${want}`);
        break;
      case "not_found":
        report.notFound.push(label);
        say(`⏭️  ${label} — belongs to another tab`);
        break;
      case "mismatch":
        report.mismatch.push(label);
        say(`⚠️  ${label} — wanted "${want}" but the form shows "${actual}"  ← CHECK THIS`);
        break;
      default:
        report.failed.push(label);
        say(`❌ ${label} — could not fill`);
    }
    onField?.({ label, want, status: status as FieldRow["status"], actual });
  }
  return report;
}

export const needsEyes = (r: Report): number => r.mismatch.length + r.failed.length;

export function printReport(r: Report): void {
  console.log(`\n──────── RESULT ────────
✅ filled & checked  : ${r.filled.length}
⏭️  other tab's fields: ${r.notFound.length}
⚠️  NEEDS A LOOK      : ${r.mismatch.length}${r.mismatch.length ? "  (" + r.mismatch.join(", ") + ")" : ""}
❌ failed             : ${r.failed.length}${r.failed.length ? "  (" + r.failed.join(", ") + ")" : ""}`);
}

/** For each wrong field, print what the widget actually is — the debugging shortcut. */
export async function explainMismatches(page: Page, r: Report, html = false): Promise<void> {
  if (!r.mismatch.length) return;
  console.log(`\n──────── WHY THOSE NEED A LOOK ────────`);
  for (const label of r.mismatch) {
    const p = await probeField(page, label);
    if (!p) {
      console.log(`\n• ${label}: not on this tab any more`);
      continue;
    }
    const wrongRow = p.rowLabel.trim().toLowerCase() !== label.trim().toLowerCase();
    console.log(`\n• ${label}
    widget      : <${p.tag}>  kind=${p.kind}
    row's label : ${JSON.stringify(p.rowLabel)}${wrongRow ? "   ⛔ WRONG ROW — targeted a different field" : ""}
    value       : ${JSON.stringify(p.value)}
    pills       : ${p.pills.length ? p.pills.join(" | ") : "(none)"}
    row         : ${p.rowText}`);
    if (html) console.log(`    html   : ${p.rowHtml}`);
  }
}

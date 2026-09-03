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

/** One row of `categories/<category>.json` — what `npm run scan` recorded off the live form. */
type ScannedField = { label: string; kind: string; companion?: boolean; furniture?: boolean };

/** Every field `npm run scan` has ever seen on this category, across all tabs. */
function scannedFields(catDir: string, category: string): ScannedField[] | null {
  const file = path.join(catDir, `${category}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { fields: ScannedField[] }).fields ?? [];
  } catch {
    return null; // a damaged scan file must not stop a fill
  }
}

/** Every label answered by any of `categories/<category>.*.defaults.json`, across all tabs. */
function defaultsKeys(catDir: string, category: string): string[] {
  if (!fs.existsSync(catDir)) return [];
  const out: string[] = [];
  for (const f of fs.readdirSync(catDir)) {
    if (!f.startsWith(`${category}.`) || !f.endsWith(".defaults.json")) continue;
    try {
      out.push(...Object.keys(JSON.parse(fs.readFileSync(path.join(catDir, f), "utf8"))));
    } catch {
      /* a damaged defaults file must not stop a fill */
    }
  }
  return out;
}

/** Labels captured by `npm run scan`, normalised the way fields.ts matches them. */
function scannedLabels(catDir: string, category: string): Set<string> | null {
  const fields = scannedFields(catDir, category);
  return fields && new Set(fields.map((f) => normLabel(f.label)));
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
  // `tabs.<tab>` is the product's own per-tab block, and it exists for exactly one label: the
  // parcel's HEIGHT, which is centimetres in Package Details and INCHES in the Dimensions block.
  // Length/Breadth live only on the pricing tab and Width/Depth only on the other, so those are
  // safe in the flat map; Height is the one that means two different numbers under one name, and
  // a 1.5 meant as inches declares a 1.5 cm parcel to a courier who then re-measures it (WW-055).
  // Scoping the DEFAULTS fixed half of this; a measured parcel is written per product, so it
  // needed the other half. Applied after `values`, so the tab-specific answer wins.
  const forTab = (tab !== undefined && product.tabs?.[tab]) || {};
  const values: Values = { ...defaults, ...product.values, ...forTab };
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
  deriveDescriptionTab(values, asks);

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
function deriveDescriptionTab(values: Values, asks: string[] = []): void {
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
  const description = String(values["Description"] ?? "");
  const lines = description.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /^WHAT YOU GET\b/i.test(l));
  if (start < 0) return;
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) continue;
    if (!/^\d/.test(line)) break;
    items.push(line);
  }
  if (!items.length) return;
  values["Items Included"] = items;

  // Does the list add up to the total the description itself claims?
  //
  // This is a TEXT PARSER reading prose, and prose changes shape. The stop rule — first line that
  // does not start with a digit — is right for every description written to the template, and
  // quietly wrong for one that is not: a stray sentence between two items truncates the list, and
  // a nine-item kit goes out declaring two. Nothing about that looks broken afterwards.
  //
  // The description states its own answer, in the heading: "WHAT YOU GET (69 Pieces)". Summing
  // the counts and comparing is the whole check, and it is free — matched on all 9 product files
  // that have the block, so it flags nothing that is already correct.
  //
  // The value is still filled rather than dropped. A short list is the best available answer and
  // the panel now SHOWS this question, which is the thing that did not exist before — the reason
  // to blank a doubtful field was always that nothing else would mention it.
  const head = /WHAT YOU GET\s*\((\d+)/i.exec(description);
  if (!head) return;
  const stated = Number(head[1]);
  const sum = items.reduce((n, line) => n + (parseInt(line, 10) || 0), 0);
  if (sum !== stated) {
    asks.push(
      `Items Included may be incomplete: the ${items.length} lines read from WHAT YOU GET add up ` +
        `to ${sum} pieces, but the description says ${stated}. Check the list against the pack ` +
        `before saving — a line that does not start with its count ends the list early.`,
    );
  }
}

export interface ScanResult {
  category: string;
  file: string;
  /** Only what this pass had not seen before — the rest of the file is other tabs. */
  added: FieldInfo[];
  /** Hand-typed placeholder rows this scan replaced with the measured widget. */
  corrected: FieldInfo[];
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
  // A row typed in by hand carries `source`. It is a placeholder: someone read the label off the
  // live form and GUESSED the widget, because scanning that tab was not possible yet. When a real
  // scan finally sees that label, the guess must give way — otherwise the placeholder blocks the
  // measurement forever, which is exactly what happened on the Product Description tab: pressing
  // Learn this tab reported "nothing new" and left seven guessed `kind`s in place, because the
  // labels already matched. Confirming the labels while silently keeping the wrong kinds is the
  // worst of both, since it reads as confirmation.
  const known = new Map(existing.fields.map((f, i) => [f.label, i]));
  const added: FieldInfo[] = [];
  const corrected: FieldInfo[] = [];
  for (const f of found) {
    const at = known.get(f.label);
    if (at === undefined) {
      added.push(f);
      known.set(f.label, existing.fields.length + added.length - 1);
    } else if ((existing.fields[at] as { source?: string }).source) {
      existing.fields[at] = f; // measured beats typed, and `source` goes with it
      corrected.push(f);
    }
  }
  existing.fields.push(...added);
  (existing as Record<string, unknown>).scannedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
  return { category, file, added, corrected, total: existing.fields.length };
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
  kind: "placeholder" | "comma" | "nonascii" | "toolong";
  label: string;
  value: string;
}

/**
 * Flipkart's own character limits, quoted from the errors its form shows on save.
 *
 * Measured 2026-08-16 on a real listing:
 *   "[Color]: For [color] attribute, the total length (108) is more than the allowed limit: 80"
 *   "[Key Spec]: For [key_spec] attribute, the provided length 25 is greater than the allowed
 *    limit 22"
 *
 * So the two fields count differently, which is why there are two tables: `Key Spec` limits
 * EACH entry, `Color` limits the SUM of all its entries (the ", " separators are not counted —
 * the file that reported 108 joins to 112). Nothing shows either number until the save is
 * rejected, and six of the product files in this repo break one or both, so the prompt asking
 * for short phrases is not a guard on its own.
 */
const MAX_EACH: Record<string, number> = { "Key Spec": 22 };
const MAX_TOTAL: Record<string, number> = { Color: 80 };

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
    const parts = (Array.isArray(v) ? v : [String(v)]).map(String);
    const each = MAX_EACH[label];
    if (each) {
      for (const s of parts) {
        if (s.length > each) out.push({ kind: "toolong", label, value: `"${s}" is ${s.length} characters, limit ${each}` });
      }
    }
    const total = MAX_TOTAL[label];
    if (total) {
      const n = parts.reduce((a, s) => a + s.length, 0);
      if (n > total) out.push({ kind: "toolong", label, value: `${n} characters across all values, limit ${total}` });
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
export function fillableValues(
  values: Values,
  problems: Problem[],
  category?: string | null,
  catDir = CATEGORIES_DIR,
): Values {
  const skip = new Set(problems.map((p) => p.label));
  const stated = Object.fromEntries(
    Object.entries(values)
      .map(([label, v]) => [label, keepWhatFits(label, v)] as const)
      .filter(([label, v]) => v !== undefined && (!skip.has(label) || fitsPerEntry(label))),
  ) as Values;
  // The pads go UNDERNEATH: `values`, not `stated`, decides what counts as blank, so a field
  // `checkValues` rejected stays rejected instead of being papered over. See padBlanks.
  return category ? { ...padBlanks(values, category, catDir), ...stated } : stated;
}

/**
 * A field whose limit is per ENTRY rather than across the whole value — see `MAX_EACH`.
 *
 * The distinction decides whether one bad entry can be dropped on its own. It can here, because
 * each entry stands alone; it cannot for `Color`, whose limit is the sum, and where dropping
 * entries would quietly change what colour the product is.
 */
const fitsPerEntry = (label: string): boolean => MAX_EACH[label] !== undefined;

/**
 * Drop the entries Flipkart would reject and keep the rest — for per-entry limits only.
 *
 * **One entry over the limit was costing the whole field.** Vansh, looking at a blank Key Spec on
 * a live listing: *"why are we not filling this??"* `Key Spec` allows several values and limits
 * each to 22 characters; a single 25-character one made `checkValues` raise a problem, and a
 * problem skips its field. **Eight of the product files in this repo lose Key Spec entirely, and
 * most of them have only one entry over** — so a field that is buyer-visible under the title, on
 * eight listings, was blank because of one word too many.
 *
 * **Entries are dropped whole, never shortened.** Truncating "16 Photo Booth Props" to fit is a
 * different claim about the product, and this file's whole rule is that a wrong value is worse
 * than an empty one — an empty box is visible and a wrong one looks finished. Two true specs beat
 * three with a lie in them, and beat nothing at all.
 *
 * `undefined` when nothing survives: the field is then skipped exactly as before, and — because
 * `padBlanks` reads the ORIGINAL values — it is still not padded, since it was stated and wrong
 * rather than blank.
 */
function keepWhatFits(label: string, v: Values[string]): Values[string] | undefined {
  const each = MAX_EACH[label];
  if (each === undefined || !Array.isArray(v)) return v;
  const kept = v.filter((s) => String(s).length <= each);
  return kept.length === 0 ? undefined : kept.length === v.length ? v : kept;
}

/**
 * What a padded field says. Vansh's word, used throughout the request that asked for this:
 * *"fill that N/A anyways"*. It is also what most Flipkart listings already show in a
 * specification row that does not apply, so it reads as normal rather than as a bug.
 *
 * The warranty defaults say "Not Applicable" and deliberately still do — those are real answers
 * to real warranty questions written as prose, not pads. Changing this one constant changes all
 * ~24 padded rows at once.
 */
export const PAD_VALUE = "N/A";

/**
 * Labels that must NEVER be padded, even though they are blank.
 *
 * Three families, all of which turn "Not Applicable" from useless into harmful:
 *  - **money, stock and measurements** — numeric boxes. Flipkart rejects the whole SAVE on a
 *    non-numeric value, so one pad here costs every other field on the tab (same failure shape
 *    as the emoji in `badChar`). This is also the guard that keeps a pad away from MRP.
 *  - **identifiers** (EAN/UPC, External Identifier, Video URL) — a barcode box holding
 *    "Not Applicable" is a *wrong* GTIN, not a blank one, and a URL box has its own validator.
 *  - anything already required (`*`), handled separately below: a mandatory field wants a real
 *    answer or an empty box someone notices, never filler that reads as done.
 */
const NEVER_PAD =
  /fee|cess|price|mrp|stock|sla|hsn|tax|ean|upc|identifier|video|url|weight|quantity|warranty|length|breadth|height|width|depth|diameter|burn time|number of|power requirement/i;

/**
 * Fill every remaining blank attribute with "Not Applicable".
 *
 * WHY THIS EXISTS. The Additional Description tab has 66 attributes and we answer 35 of them;
 * Flipkart scores the listing 3.8/5. The other 31 are the hand-fan, blowout, cracker and
 * battery-toy attributes this category is shared with — `Mouthpiece Material`, `Burn Time`,
 * `Type of Batteries` — which are blank because they are genuinely meaningless for a balloon
 * kit, and the defaults file says so in as many words.
 *
 * **Whether Flipkart's score counts a filled-but-meaningless field is unknown**, and nothing
 * published says either way. Vansh's call, 2026-08-26, having been told that: make it the
 * default everywhere rather than a flag to remember. So every front door pads — `npm start`, the
 * app's Fill button, and `npm run fill` — and `--no-pad` on the two CLIs is the way back for a
 * before/after comparison. The honest cost is that "Mouthpiece Material: Not Applicable" appears
 * on the buyer-facing specification table; if the score does not move, take the argument back out
 * of the three `fillableValues` calls and this function is dead code again.
 *
 * Comboboxes are skipped because their option list is fixed and never contains this string;
 * required fields are skipped because filler in a mandatory box reads as done and is not.
 *
 * PASS THE PRODUCT'S FULL `values`, NEVER `fillableValues(...)`. A field is blank on the form for
 * two very different reasons, and only one of them wants a pad. `Key Spec` over its 22-character
 * limit and a `Character` holding Devanagari are both DROPPED by checkValues — they are stated,
 * they are wrong, and the operator is meant to see the warning and fix the words. Padding those
 * writes "Key Spec: Not Applicable" onto a live listing and makes the warning look answered.
 * Returns ONLY the additions, so the caller merges them under the real values and this
 * distinction cannot be lost at the call site either.
 */
export function padBlanks(stated: Values, category: string, catDir = CATEGORIES_DIR): Values {
  // Every label ANY defaults file answers, not just this tab's, plus what the product states.
  //
  // THIS IS A SAFETY GUARD, not tidiness. `loadProduct(file, _, tab)` loads ONE defaults file, so
  // a tab-scoped load leaves the other tabs' answers out of `stated` — `Precautions` is simply
  // absent when the app fills the Price/Stock tab. Padding on that basis writes "N/A" into
  // Precautions the moment somebody presses a Fill button for a tab they are not looking at, and
  // Flipkart.tsx promises out loud that pressing the wrong button cannot fill the wrong tab.
  // Padding is the thing that would have made that promise false. A field some defaults file
  // answers is not blank — it is just not on this tab.
  const have = new Set([...Object.keys(stated), ...defaultsKeys(catDir, category)].map(normLabel));
  const pads: Values = {};
  for (const f of scannedFields(catDir, category) ?? []) {
    if (f.companion || f.furniture) continue;
    if (/\*\s*$/.test(f.label)) continue;                     // required — real answer or nothing
    if (f.kind !== "text" && f.kind !== "pills") continue;    // fixed option lists never offer it
    const label = f.label.trim();
    if (NEVER_PAD.test(label) || have.has(normLabel(label))) continue;
    pads[label] = PAD_VALUE;
  }
  return pads;
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
  const long = problems.filter((p) => p.kind === "toolong");
  if (long.length) {
    lines.push(`⚠️  These are over Flipkart's character limit — it rejects the SAVE, not just the`);
    // The two cases end differently and the report has to say which, or the reader goes looking
    // for a blank field that is not blank: a per-entry limit loses only the entry that broke it.
    lines.push(`    field. A Key Spec entry over the limit is DROPPED and the others still go in;`);
    lines.push(`    a Color over the total leaves the whole field blank:`);
    for (const p of long) lines.push(`   ${p.label}: ${p.value}`);
    lines.push(`   Shorten them and put them in by hand. Color is 80 characters for all three`);
    lines.push(`   phrases together; each Key Spec entry is 22.`);
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
        // NOT "belongs to another tab". That wording cost two rounds of testing on 2026-09-03:
        // Breadth, Height and Weight are REQUIRED boxes sitting in plain sight on the Price/Stock
        // tab, and the report called them another tab's business. All `not_found` means is that
        // no attribute row on the page right now carries that label.
        say(`⏭️  ${label} — no field with this label on the page right now`);
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
⏭️  not on this page   : ${r.notFound.length}
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

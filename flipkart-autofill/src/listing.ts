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
import { fillField, probeField } from "./fields.js";
import { normalizeId } from "./id.js";
import { CATEGORIES_DIR, PRODUCTS_DIR } from "./paths.js";

export type Values = Record<string, string | number | string[]>;

export interface LoadedProduct {
  file: string;
  category: string;
  values: Values;
  usedDefaults: string[];
}

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
export function loadProduct(file: string, catDir = CATEGORIES_DIR): LoadedProduct {
  const product = JSON.parse(fs.readFileSync(file, "utf8"));
  const defaults: Values = {};
  const usedDefaults: string[] = [];
  if (fs.existsSync(catDir)) {
    for (const f of fs.readdirSync(catDir).sort()) {
      if (f.startsWith(`${product.category}.`) && f.endsWith(".defaults.json")) {
        Object.assign(defaults, JSON.parse(fs.readFileSync(path.join(catDir, f), "utf8")));
        usedDefaults.push(f);
      }
    }
  }
  const values: Values = { ...defaults, ...product.values };
  // Keys starting with "_" are notes for humans, not form fields.
  for (const k of Object.keys(values)) if (k.startsWith("_")) delete values[k];
  return { file, category: product.category, values, usedDefaults };
}

export interface Problem {
  kind: "placeholder" | "comma";
  label: string;
  value: string;
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
  }
  return out;
}

export function describeProblems(problems: Problem[]): string {
  const lines: string[] = [];
  const todos = problems.filter((p) => p.kind === "placeholder");
  const commas = problems.filter((p) => p.kind === "comma");
  if (todos.length) {
    lines.push(`⛔ Some values are still placeholders — fill them in first:`);
    for (const p of todos) lines.push(`   ${p.label} = ${p.value}`);
  }
  if (commas.length) {
    lines.push(`⛔ These multi-value entries contain a comma, which Flipkart would split in two:`);
    for (const p of commas) lines.push(`   ${p.label}: "${p.value}"`);
    lines.push(`   Rewrite them without commas — "and" or a dash reads fine.`);
  }
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

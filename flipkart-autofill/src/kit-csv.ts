/**
 * kit-csv.ts — costed kits as a spreadsheet, in the shape the business already reads.
 *
 * The JSON a kit is stored as is the right thing to STORE — it survives a rename, it re-costs at
 * today's prices, and nothing in it can go stale. It is the wrong thing to READ: Vansh's partner
 * has never opened a `.json` and should not have to start.
 *
 * So this is the same data laid out like the Excel it replaces — a header line, the materials with
 * their counts and costs, then the parts that spreadsheet never had: what delivery costs on each
 * marketplace, what a sale actually leaves, and the parcel. One kit per block, blank line between,
 * opens by double-click in Excel.
 *
 * **Rupees here, not paise.** Everywhere else in this repo money is integer paise, and that rule
 * stands — but this file is read by a person, and `5850` is not a number anybody recognises as
 * ₹58.50. The conversion happens once, on the way out, and nothing reads this file back.
 */

import { costKit, type Kit, type Material, type SavedKit } from "./inventory-core.js";
import { parcelFor, type PackagingSpec } from "./packaging.js";

/** RFC-4180 enough for Excel: quote anything with a comma, quote or newline, and double quotes. */
function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (...cells: (string | number | null | undefined)[]) => cells.map(cell).join(",");

/** Paise as a plain decimal — `58.50`, not `₹58.50`, so Excel treats the column as a number. */
const money = (paise: number | null | undefined): string =>
  paise === null || paise === undefined ? "" : (paise / 100).toFixed(2);

const priceAt = (costPaise: number, marginPercent: number) =>
  Math.round(costPaise / (1 - Math.min(Math.max(marginPercent, 0), 95) / 100));

export interface CsvOptions {
  materials: Material[];
  /** Null when no packaging rules shipped — the parcel block is then simply left out. */
  packaging: PackagingSpec | null;
}

/**
 * One kit as a block of rows.
 *
 * Costed fresh from today's price list rather than from anything stored, for the same reason the
 * panel does it: a saved total would be last month's balloon price with nothing to say so.
 */
function block(saved: SavedKit, opts: CsvOptions): string[] {
  const kit: Kit = costKit(saved.lines, opts.materials, saved.overrides ?? {}, saved.sku);
  const pieces = kit.lines.reduce((n, l) => n + l.qty, 0);
  const margin = saved.marginPercent ?? 50;
  const flat = saved.flatPaise ?? 0;

  const out: string[] = [];

  out.push(row("SKU", "Total pieces", "Materials cost", `Sell at ${margin}% margin`, `Sell at cost + ${money(flat)}`));
  out.push(row(saved.sku || "(no code)", pieces, money(kit.totalPaise), money(priceAt(kit.totalPaise, margin)), money(kit.totalPaise + flat)));

  // Only printed when there IS something wrong, so a clean kit's block stays short and a bad one
  // cannot be skimmed past. The total excludes these lines, which is the thing worth shouting.
  if (kit.uncosted > 0) {
    out.push(row("WARNING", `${kit.uncosted} line(s) are not counted in the cost above, so it is too low`));
  }

  out.push("");
  out.push(row("Category", "Material as the sheet has it", "Count", "Each", "Line cost", "Priced as", "Note"));
  for (const l of kit.lines) {
    const note = l.match === null
      ? "NOT ON THE PRICE LIST"
      : l.paise === null
        ? "no price set for this material"
        : l.overridden
          ? "corrected by hand"
          : l.flagged
            ? "matched loosely - check it"
            : "";
    out.push(row(l.match?.category ?? "", l.item, l.qty, money(l.match?.paise), money(l.paise), l.match?.material ?? "", note));
  }
  out.push(row("", "", pieces, "", money(kit.totalPaise), "TOTAL", ""));

  const places = Object.entries(saved.marketplaces ?? {}).filter(([, v]) => v?.pricePaise);
  if (places.length > 0) {
    out.push("");
    out.push(row("Where", "Listed at", "Delivery", "Delivery share", "Left after materials + delivery"));
    for (const [id, v] of places) {
      const price = v.pricePaise ?? 0;
      const ship = v.shippingPaise ?? 0;
      const left = price - kit.totalPaise - ship;
      out.push(row(
        id,
        money(price),
        v.shippingPaise === undefined ? "not filled in" : money(ship),
        `${Math.round((ship / price) * 100)}%`,
        money(left),
      ));
    }
  }

  if (opts.packaging) {
    const p = parcelFor(saved.lines, opts.materials, opts.packaging);
    out.push("");
    out.push(row("Parcel", "Length cm", "Breadth cm", "Height cm", "Weight g", "Volumetric g", "Flipkart bills"));
    out.push(row(p.applied.length ? `bigger: ${p.applied.join(" + ")}` : "standard box", p.lengthCm, p.breadthCm, p.heightCm, p.grams, p.volumetricGrams, `${p.billedGrams} g`));
  }

  if (saved.savedAt) out.push(row("Saved", saved.savedAt));
  return out;
}

/**
 * Every kit as one spreadsheet, newest first, blank line between blocks.
 *
 * A BOM leads the file because Excel on Windows reads a plain UTF-8 CSV as the system codepage
 * and turns any non-ASCII into mojibake — and the material names are the whole point of the file.
 */
export function kitsToCsv(kits: SavedKit[], opts: CsvOptions): string {
  const blocks = kits.map((k) => block(k, opts).join("\n"));
  return `﻿${blocks.join("\n\n\n")}\n`;
}

/** Exported for the tests, and because a one-kit export is the common case. */
export const kitToCsv = (kit: SavedKit, opts: CsvOptions): string => kitsToCsv([kit], opts);

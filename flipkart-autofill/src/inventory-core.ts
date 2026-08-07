/**
 * inventory-core.ts — cost a kit from the item list the AI read off the inventory image.
 *
 * The Excel this replaces is slow for one reason: every line is a dropdown and a kit is twenty
 * lines. The counts are already printed on the sheet the partner sends, so nobody should be
 * re-typing them.
 *
 * **There is no OCR here, and that is the whole design.** Reading the image was briefly going to
 * be `tesseract.js`, which works — but OCR only gets you a string, and the hard half is deciding
 * which price row `SILVER MATALIC BALLOONS` is. A fuzzy matcher gets that wrong quietly, and a
 * quietly wrong line in a cost sheet is the one failure that costs real money. `PROMPT-inventory.md`
 * is handed the price list and asked to answer **in those exact names**, so the match is an
 * equality test, not a guess. Same shape as every other step in this app: copy a prompt, attach
 * the image, drop the reply back.
 *
 * Money is integer paise (CLAUDE.md). 3.5 rupees times twenty is where a cost sheet starts
 * disagreeing with itself.
 */

import fs from "node:fs";
import path from "node:path";
import { CATEGORIES_DIR } from "./paths.js";

export interface Material {
  category: string;
  material: string;
  /** Cost of ONE, in paise. */
  paise: number;
}

/** One line of the AI's reply. */
export interface KitLine {
  material: string;
  qty: number;
}

export interface CostedLine extends KitLine {
  /** Null when the name is in no price row — shown, and costing nothing, never guessed. */
  match: Material | null;
  /** qty x unit cost, or null when unmatched. */
  paise: number | null;
}

export interface Kit {
  lines: CostedLine[];
  /** Sum of every line that HAS a price. */
  totalPaise: number;
  /** Lines carrying no price. Above zero, the total is an underestimate and must say so. */
  unpriced: number;
}

// ---------------------------------------------------------------- the price list

/**
 * The price list ships with the app — `extraResources` already covers `categories/*.json`, so both
 * machines always agree on what a balloon costs and a price change goes out as a release. It lives
 * in `categories/` rather than a folder of its own precisely because that needs no build-config
 * change; `loadProduct()` only ever reads `<category>.*.defaults.json` from there, so this file
 * cannot reach the Flipkart form.
 */
export function loadMaterials(dir = CATEGORIES_DIR): Material[] {
  const file = path.join(dir, "materials.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return (parsed.materials ?? []).filter(
    (m: Material) => typeof m?.paise === "number" && typeof m?.material === "string",
  );
}

/** Lowercase, letters and digits only, single-spaced — so `CONFETI  Silver-Balloons!` is one key. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** `category|material`, the value the review dropdown sends back. */
export const materialKey = (m: Material): string => `${m.category}|${m.material}`;

// ---------------------------------------------------------------- the costed kit

/**
 * Read the AI's reply. Tolerant about shape and strict about content: `lines` or `items`, `qty` or
 * `quantity` or `count`, because the reply is generated text and one renamed key should not read
 * as an empty kit. Anything without a name and a positive whole number is dropped — a line with no
 * quantity priced as one unit is a wrong total nobody would question.
 */
export function readKitFile(json: unknown): KitLine[] {
  const raw = (json as Record<string, unknown>) ?? {};
  const list = (raw.lines ?? raw.items ?? raw.materials ?? []) as Record<string, unknown>[];
  if (!Array.isArray(list)) return [];
  return list.flatMap((l) => {
    const material = String(l?.material ?? l?.name ?? "").trim();
    const qty = Number(l?.qty ?? l?.quantity ?? l?.count);
    return material && Number.isInteger(qty) && qty > 0 ? [{ material, qty }] : [];
  });
}

/**
 * Price the lines.
 *
 * `overrides` maps a line's index to a `category|material` key — what the review dropdown sends
 * when a human corrects a row. An override always wins: they have looked at the image.
 */
export function costKit(
  lines: KitLine[],
  materials: Material[],
  overrides: Record<number, string> = {},
): Kit {
  const byKey = new Map(materials.map((m) => [materialKey(m), m]));
  const byName = new Map(materials.map((m) => [normalize(m.material), m]));

  const costed: CostedLine[] = lines.map((line, i) => {
    const override = overrides[i];
    const match = override !== undefined
      ? (byKey.get(override) ?? null)
      : (byName.get(normalize(line.material)) ?? null);
    return { ...line, match, paise: match ? match.paise * line.qty : null };
  });

  return {
    lines: costed,
    totalPaise: costed.reduce((sum, l) => sum + (l.paise ?? 0), 0),
    unpriced: costed.filter((l) => l.paise === null).length,
  };
}

/**
 * The selling price leaving `marginPercent` of the PRICE as margin — `cost / (1 - margin)`, not
 * `cost * (1 + margin)`, which is markup and a different, smaller number.
 *
 * ponytail: margin over cost of goods ONLY. It knows nothing about Meesho's commission, the
 * shipping fee, GST or packaging, so what it prints is a floor and not the price to list at.
 * Replace with the real model once Vansh sends the sheet that computes it.
 */
export function priceAt(costPaise: number, marginPercent: number): number {
  const m = Math.min(Math.max(marginPercent, 0), 95) / 100;
  return Math.round(costPaise / (1 - m));
}

/** Paise to a rupee string, for display only. */
export const rupees = (paise: number): string =>
  `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;

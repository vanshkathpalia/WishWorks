/**
 * inventory-core.ts — cost a kit from the item list the AI read off the inventory sheet.
 *
 * The Excel this replaces is slow for one reason: every line is a dropdown and a kit is twenty
 * lines. The counts are already printed on the sheet the partner sends, so this reads them once.
 *
 * **The AI reads the picture; this file owns the data.** An earlier version pushed the whole price
 * list into the prompt and asked for names copied back verbatim, which made matching a plain
 * equality test — but it sent hundreds of names up on every single sheet, and it left the app with
 * nothing of its own: no catalogue lookup, no place to save a costed kit, nothing to mold. So the
 * prompt is now short and generic ("what is on this sheet, in the words the sheet uses") and the
 * matching happens here, against `categories/materials.json`.
 *
 * That trade buys freedom and costs certainty, so the certainty is bought back on screen rather
 * than pretended away. **Every line carries the score it matched on**, and the three bands are
 * different states, not decoration:
 *   - `>= SURE` priced and quiet — the name is the row, allowing for plurals and a typo.
 *   - `>= FLOOR` priced and FLAGGED — likely right, worth a glance against the picture.
 *   - below      left UNPRICED and counted, never mapped to the nearest thing.
 * A wrong row is invisible in a total; a flagged row is not. That is the whole safety argument.
 *
 * Money is integer paise (CLAUDE.md). 3.5 rupees times twenty is where a cost sheet starts
 * disagreeing with itself.
 */

import fs from "node:fs";
import path from "node:path";
import { CATEGORIES_DIR, ROOT } from "./paths.js";

export interface Material {
  category: string;
  material: string;
  /**
   * Cost of ONE, in paise. **`null` means the price cell is blank in the sheet** — a real material
   * whose price nobody has filled in yet, which is a different problem from "not on the list" and
   * has a different fix. It is never treated as free: a kit containing one is short, and says so.
   */
  paise: number | null;
  /** What we stock, when it is known. Free text — "10 inch", "3.3 ft x 6.5 ft". WW-116. */
  size?: string;
  /**
   * Earlier names for the same material, which still match.
   *
   * The 2026-08-07 clean-up renamed 76 of these rows. The partner's inventory pictures and every
   * kit saved before that day still say `CONFETI SILVER BALLOONS`, so a rename that dropped the
   * old name would silently un-match a year of sheets. Rename freely; add the old one here.
   */
  aka?: string[];
}

/** One line of the AI's reply, in the sheet's own words. */
export interface KitLine {
  item: string;
  qty: number;
  /** The size printed on the sheet, if it printed one. Never inferred. */
  size?: string;
}

export interface Candidate {
  material: Material;
  /** 0-1. 1 is identical after normalising. */
  score: number;
}

export interface CostedLine extends KitLine {
  /** Null when nothing scored above the floor — shown, costing nothing, never guessed. */
  match: Material | null;
  score: number;
  /** True when it was priced but is worth checking against the picture. */
  flagged: boolean;
  /** Set when a human picked this row; it is never re-scored. */
  overridden: boolean;
  /** The best few rows, so the dropdown opens on the likely answers. */
  choices: Candidate[];
  /** qty x unit cost, or null when unmatched. */
  paise: number | null;
}

export interface Kit {
  sku: string;
  lines: CostedLine[];
  /** Sum of every line that HAS a price. */
  totalPaise: number;
  /** Lines matching no material at all — someone has to add a row, or correct the line. */
  unmatched: number;
  /** Lines whose material IS on the list but has a blank price cell — someone fills a cell. */
  noPrice: number;
  /** Priced, but matched loosely enough to be worth a look against the picture. */
  flagged: number;
  /** `unmatched + noPrice` — how much of the kit the total silently leaves out. */
  uncosted: number;
}

/** A costed kit as it is kept on disk, so it can be reopened and corrected later. */
export interface SavedKit {
  sku: string;
  /** The sheet it was read from, for the picture beside the table. */
  image: string | null;
  /** Exactly what the AI replied, so a re-match after a price-list change starts from the truth. */
  lines: KitLine[];
  /** Line index → `category|material`. The corrections, kept apart from the reading. */
  overrides: Record<number, string>;
  marginPercent: number;
  savedAt: string;
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
  // A row is kept if it names a material. A missing or non-numeric price becomes `null`, which
  // the panel reports as a gap — dropping those rows instead would make a known material read as
  // "not on the price list", sending someone off to add a row that is already there.
  return (parsed.materials ?? [])
    .filter((m: Material) => typeof m?.material === "string" && m.material.trim() !== "")
    .map((m: Material) => ({ ...m, paise: typeof m.paise === "number" ? m.paise : null }));
}

/**
 * What the price list still needs. Shown in the app rather than only known here — these are cells
 * somebody has to go and fill in, and a gap nobody can see is a gap nobody fills.
 */
export function gaps(materials: Material[]): { noPrice: Material[]; noSize: Material[] } {
  return {
    noPrice: materials.filter((m) => m.paise === null),
    noSize: materials.filter((m) => !m.size),
  };
}

// ---------------------------------------------------------------- matching

/** Lowercase, letters and digits only, single-spaced. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Words that appear on every inventory sheet and identify nothing. Left in, they pull every line
 * toward every row — `pcs` alone would tie `1 pc Banner` against half the price list.
 */
const NOISE = new Set([
  "x", "pc", "pcs", "piece", "pieces", "no", "nos", "qty", "set", "sets", "pack", "packs",
  "of", "the", "and", "a", "with", "for",
]);

/**
 * Trailing `s` off anything long enough for it to be a plural. Crude on purpose: `BALLOONS` and
 * `Balloon` are the same material on every sheet either of us has ever seen, and without this the
 * commonest difference between a sheet and the price list scores as a mismatch.
 */
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

export const tokens = (s: string): string[] =>
  normalize(s)
    .split(" ")
    .filter((w) => w && !NOISE.has(w))
    .map(stem);

/** Standard Levenshtein, two rows. Short strings only — the longest name here is a few words. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Are these the same word? Equal, or close enough that it is a typo rather than a different thing.
 *
 * The tolerance scales with length because a one-character difference means opposite things at
 * opposite ends: `metallic`/`matalic` is a misspelling we have in the real data, while `red`/`led`
 * are two words. Short words must match exactly.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len < 5) return false;
  return distance(a, b) <= (len >= 8 ? 2 : 1);
}

/**
 * How well a read name matches a price row, 0-1 — Dice over the words, with typo-tolerant equality
 * and each word usable once.
 *
 * Dice rather than "share of the row's words present" because it penalises BOTH directions: a
 * two-word read cannot claim a five-word row, and a five-word read cannot claim a two-word row.
 * `blue balloon` therefore scores 1.0 against `BLUE Balloon` and 0.8 against `BLUE Dark Balloon`,
 * which is the ordering that matters — those two are the pair most likely to be confused, and
 * they differ by one word and 0 paise today but will not always.
 *
 * ponytail: no TF-IDF, no phonetics. Word-level Dice plus edit distance is enough for a list of a
 * few hundred short product names, and everything it gets wrong lands in front of a human with a
 * dropdown. Revisit only if real sheets show misses the review step is not catching.
 */
export function score(name: string, m: Material): number {
  // Best over the current name and every old one. A sheet written before the 2026-08-07 rename
  // says `CONFETI SILVER BALLOONS`; it has to land on `Silver Confetti Balloon` just as squarely.
  return Math.max(...[m.material, ...(m.aka ?? [])].map((n) => scoreName(name, n, m.category)));
}

function scoreName(name: string, against: string, category = ""): number {
  const b = tokens(against);
  // A word the CATEGORY explains is not a missing word. Sheets say "Kitty Foil Balloon" where the
  // list says "Kitty Foil" in the category "Foil Balloon" — the extra "Balloon" is the category
  // spelled out, and counting it as a miss dropped that line to 80% and flagged it for nothing.
  // Only ever drops a word the row itself does NOT have, so it cannot manufacture confidence: a
  // bare "Balloons" against "Black Balloon" is untouched, because that row does contain "balloon".
  const explained = new Set(tokens(category).filter((w) => !b.includes(w)));
  const a = tokens(name).filter((w) => !explained.has(w));
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(" ") === b.join(" ")) return 1;

  // Exact first, so a row that really has the word cannot lose it to a row that merely has
  // something one letter away. A typo-tolerant hit then counts for slightly less than an exact
  // one — enough to order two otherwise equal rows, not enough to reject a real misspelling.
  const used = new Array(b.length).fill(false);
  let hits = 0;
  for (const pass of [0, 1]) {
    for (const wa of a) {
      const j = b.findIndex((wb, k) => !used[k] && (pass === 0 ? wa === wb : sameWord(wa, wb)));
      if (j !== -1) {
        used[j] = true;
        hits += pass === 0 ? 1 : 0.85;
      }
    }
  }
  return (2 * hits) / (a.length + b.length);
}

/** Priced and quiet at or above this. */
export const SURE = 0.85;
/** Priced but flagged at or above this; below it, left unpriced. */
export const FLOOR = 0.6;

export function candidates(name: string, materials: Material[], top = 5): Candidate[] {
  return materials
    .map((material) => ({ material, score: score(name, material) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

// ---------------------------------------------------------------- reading the reply

/** `category|material`, the value the review dropdown sends back. */
export const materialKey = (m: Material): string => `${m.category}|${m.material}`;

/**
 * Read the AI's reply. Tolerant about shape and strict about content: `lines` or `items`, `item`
 * or `material` or `name`, `qty` or `quantity` or `count`, because the reply is generated text and
 * one renamed key should not read as an empty kit. Anything without a name and a positive whole
 * number is dropped — a line with no quantity priced as one unit is a wrong total nobody would
 * question.
 */
export function readKitFile(json: unknown): { sku: string; lines: KitLine[] } {
  const raw = (json as Record<string, unknown>) ?? {};
  const list = (raw.lines ?? raw.items ?? raw.materials ?? []) as Record<string, unknown>[];
  const lines = !Array.isArray(list)
    ? []
    : list.flatMap((l) => {
        const item = String(l?.item ?? l?.material ?? l?.name ?? "").trim();
        const qty = Number(l?.qty ?? l?.quantity ?? l?.count);
        const size = String(l?.size ?? "").trim();
        return item && Number.isInteger(qty) && qty > 0
          ? [size ? { item, qty, size } : { item, qty }]
          : [];
      });
  return { sku: String(raw.sku ?? "").trim(), lines };
}

// ---------------------------------------------------------------- the costed kit

/**
 * Price the lines.
 *
 * `overrides` maps a line's index to a `category|material` key — what the review dropdown sends
 * when a human corrects a row, and `""` for "none of these". An override always wins and is never
 * re-scored: they have looked at the picture, which is more than the matcher can do.
 */
export function costKit(
  lines: KitLine[],
  materials: Material[],
  overrides: Record<number, string> = {},
  sku = "",
): Kit {
  const byKey = new Map(materials.map((m) => [materialKey(m), m]));

  const costed: CostedLine[] = lines.map((line, i) => {
    const choices = candidates(line.item, materials);
    const override = overrides[i];
    const overridden = override !== undefined;
    const best = choices[0];

    const match = overridden
      ? (byKey.get(override) ?? null)
      : best && best.score >= FLOOR
        ? best.material
        : null;
    const s = overridden ? 1 : (best?.score ?? 0);

    return {
      ...line,
      match,
      score: s,
      flagged: !overridden && match !== null && s < SURE,
      overridden,
      choices,
      // A matched material with a blank price cell costs `null`, never 0. Zero would fold into
      // the total as if the item were free, and nothing on screen would ever say otherwise.
      paise: match && match.paise !== null ? match.paise * line.qty : null,
    };
  });

  const unmatched = costed.filter((l) => l.match === null).length;
  const noPrice = costed.filter((l) => l.match !== null && l.paise === null).length;

  return {
    sku,
    lines: costed,
    totalPaise: costed.reduce((sum, l) => sum + (l.paise ?? 0), 0),
    unmatched,
    noPrice,
    flagged: costed.filter((l) => l.flagged).length,
    uncosted: unmatched + noPrice,
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

// ---------------------------------------------------------------- keeping them

/**
 * Where costed kits are kept. User state, so it follows the workspace like `products/` — NOT
 * `categories/`, which ships read-only inside the app and would lose every saved kit on update.
 */
export const KITS_DIR = process.env.WW_KITS_DIR ?? path.join(ROOT, "inventory");

/** Filesystem-safe, and stable for the same kit so re-saving overwrites instead of piling up. */
const kitFile = (name: string) =>
  path.join(KITS_DIR, `${name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "kit"}.json`);

/**
 * Save the READING and the CORRECTIONS, never the costed table.
 *
 * The prices are in `materials.json`, which ships with the app and changes with it. Storing a
 * computed total would freeze a kit at last month's balloon price and there would be no sign of
 * it — reopening re-costs from what the reading said, which is the only number on disk that
 * cannot go stale.
 */
export function saveKit(kit: SavedKit, dir = KITS_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(kitFile(kit.sku || "kit")));
  fs.writeFileSync(file, JSON.stringify({ ...kit, savedAt: new Date().toISOString() }, null, 2));
  return file;
}

export function listKits(dir = KITS_DIR): { sku: string; file: string; savedAt: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const k = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SavedKit;
        return [{ sku: k.sku || path.basename(f, ".json"), file: path.join(dir, f), savedAt: k.savedAt ?? "" }];
      } catch {
        return []; // a half-written file is not a reason for the list to fail
      }
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function readKit(file: string): SavedKit {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

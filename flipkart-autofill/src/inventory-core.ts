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
   * What a BUYER would call this, when the stock name is not it.
   *
   * `material` is the name that prices correctly and matches the partner's sheets — supplier
   * language, and eight rows here are abbreviations no shopper has ever typed: `GTB Foil`,
   * `HBD Banner`, `BTB Sash`. Put one of those in a listing and it is invisible to search.
   *
   * `PROMPT-product.md` rule 8 already exists to fix this and uses this exact case as its
   * example — *"Foil Letter Kit" -> "Groom To Be Foil Banner" (people search BANNER)*. But it
   * fixes it by asking a model to expand an abbreviation it has to recognise first, every time,
   * on every listing. GTB is knowable here, once, so it is data rather than a guess.
   *
   * Omitted when the stock name is already the buyer's name, which is most rows.
   */
  sellsAs?: string;
  /**
   * How many PIECES come in one of these, when it is bought as a pack rather than singly.
   *
   * The failure this exists to stop: an inventory sheet counts what a buyer sees — *16 photo
   * props* — while `paise` is the price of the PACK those sixteen arrive in. Multiplying them
   * costed one ₹25 kit at ₹400 and pushed a real kit's total from ₹81.50 to ₹456.50, with every
   * individual figure on screen correct. Set this and the cost becomes
   * `ceil(pieces / piecesPerPack) x paise`, so sixteen pieces is one pack, and thirty-two is two.
   *
   * Absent means what it says: this material is bought and priced one at a time, like a balloon.
   */
  piecesPerPack?: number;
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
  /** The unit price actually used — the price list's, or this kit's own. Null when unknown. */
  each: number | null;
  /** True when `each` came from this kit rather than the shipped list. */
  ownPrice: boolean;
  score: number;
  /** True when it was priced but is worth checking against the picture. */
  flagged: boolean;
  /** Set when a human picked this row; it is never re-scored. */
  overridden: boolean;
  /** The best few rows, so the dropdown opens on the likely answers. */
  choices: Candidate[];
  /** How many PACKS this line's pieces work out to. Equals `qty` for anything sold singly. */
  packs: number;
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
  /**
   * Unit prices that apply to THIS KIT ONLY, keyed `category|material`, in paise.
   *
   * Two different things a wrong price can mean, and they must not share one control: *this batch
   * cost me more* (belongs here, on one kit) versus *the price list is wrong* (belongs in
   * materials.json, where it reaches every kit and both machines). Anything here is deliberately
   * NOT a correction to the list — it is a fact about one purchase.
   */
  prices?: Record<string, number>;
  /**
   * Corrected counts, keyed by line index. The reading in `lines` is left exactly as the AI gave
   * it, for the same reason the material corrections are kept apart from it: what was read and
   * what a human decided are two different facts, and one of them is evidence.
   */
  counts?: Record<number, number>;
  /** Both pricing methods are kept, because the panel shows both and neither is "the" answer. */
  marginPercent: number;
  /** Flat rupees added on top of cost, in paise. The partner's rule of thumb is +₹60. */
  flatPaise?: number;
  /**
   * What this kit is actually listed at, and what delivery actually costs, per marketplace.
   *
   * Both are typed in by hand and neither can be computed: Meesho sets the shipping fee from the
   * main image by a rule fourteen tests failed to pin down (SHIPPING-COST.md), and the two
   * marketplaces are rarely listed at the same price. Kept per kit because the question they
   * answer — *what share of the price is delivery* — is the one that decides which SKU gets ad
   * spend, and it is different for the same kit on each platform.
   */
  marketplaces?: Record<string, { pricePaise?: number; shippingPaise?: number }>;
  /**
   * A parcel size or weight chosen by hand, overruling the rules for this kit.
   *
   * The rules in `packaging.json` get it right for the common cases and a human gets it right for
   * the rest — a kit that happens to pack flatter, or a batch that came out heavier. Only the
   * fields actually chosen are stored, so a kit that only had its weight corrected still follows
   * the rules for its size, and picks up a corrected rule on the next release.
   */
  parcel?: { lengthCm?: number; breadthCm?: number; heightCm?: number; grams?: number };
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
 * Change a material's price in the list itself — permanently, for every kit and both machines.
 *
 * **Deliberately separate from a kit's own price.** A wrong number means one of two things and they
 * need different homes: *this batch cost me more* is a fact about one purchase (`SavedKit.prices`),
 * while *the list is wrong* — Kitty Foil at ₹1.50 when a character supershape is nearer ₹35 — has
 * to reach every kit ever costed and the other machine too. Only this one does that.
 *
 * Rewrites the file in place, so every `_` comment, the `aka` lists and the row order all survive;
 * the alternative was regenerating it, which would throw away the notes explaining the data.
 *
 * **Fails loudly where the folder is read-only.** Packaged, `categories/` lives inside the app
 * bundle, and a silent no-op would look exactly like a saved change until the next kit disagreed.
 */
export function setMaterialPrice(
  key: string,
  paise: number | null,
  dir = CATEGORIES_DIR,
): Material[] {
  const file = path.join(dir, "materials.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const row = (parsed.materials ?? []).find((m: Material) => materialKey(m) === key);
  if (!row) throw new Error(`No material called "${key}" in the price list.`);
  row.paise = paise;
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return loadMaterials(dir);
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
  // One word being the start of the other is the same root, not a typo: gold/golden,
  // metal/metallic, confetti/confettis. Edit distance cannot see this — `gold` to `golden` is two
  // insertions on a six-letter word, so it failed the test below, and `GOLD BALLOONS` matched
  // **Rose Gold Balloon** over Golden Balloon on a shared exact word. Four letters minimum, which
  // keeps the short-word guard intact: `net` still does not match `netted`.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;

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
/**
 * Pull the JSON object out of whatever was pasted.
 *
 * The reply arrives as a ```json code block in the chat, not as a download — asking for a file is
 * an extra step ChatGPT does not always offer. So the normal case is somebody selecting the block
 * and hitting copy, and what lands on the clipboard carries the fence, sometimes a "Here you go:"
 * before it, and sometimes a sentence after.
 *
 * Taking everything between the FIRST `{` and the LAST `}` handles all three without knowing
 * anything about markdown. `null` on anything that will not parse, so the caller can say something
 * useful instead of throwing.
 */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function readKitFile(json: unknown): {
  sku: string;
  lines: KitLine[];
  /**
   * Line index → the price-list row a HUMAN put on that line, by name.
   *
   * Never written by the AI: it is ours, and it is how a correction survives a trip through the
   * text box. The reading in `item` is left exactly as the sheet had it — that column is what gets
   * checked against the picture, and overwriting it with our own name would destroy the only
   * evidence on the screen. Kept by index rather than by name because two lines can read the same.
   */
  picks: Record<number, string>;
} {
  const raw = (json as Record<string, unknown>) ?? {};
  const list = (raw.lines ?? raw.items ?? raw.materials ?? []) as Record<string, unknown>[];
  const lines: KitLine[] = [];
  const picks: Record<number, string> = {};
  if (Array.isArray(list)) {
    for (const l of list) {
      const item = String(l?.item ?? l?.material ?? l?.name ?? "").trim();
      const qty = Number(l?.qty ?? l?.quantity ?? l?.count);
      const size = String(l?.size ?? "").trim();
      if (!item || !Number.isInteger(qty) || qty <= 0) continue; // a line we cannot read is not a line
      // Present-but-empty is a decision — *this is on no row at all* — and a different thing from
      // absent, which is "nobody has said". `in`, not truthiness, is what tells them apart.
      if (l !== null && typeof l === "object" && "pick" in l) {
        picks[lines.length] = String(l.pick ?? "").trim();
      }
      lines.push(size ? { item, qty, size } : { item, qty });
    }
  }
  return { sku: String(raw.sku ?? "").trim(), lines, picks };
}

/**
 * Turn `pick` names into the `category|material` keys `costKit` takes as overrides.
 *
 * A name that is not on the list is DROPPED rather than guessed at — the line then matches
 * normally and is flagged or not on its own merits, which is the same place it would have been
 * without the pick. Silently resolving it to the nearest row would be the one thing an explicit
 * human correction must never do.
 */
export function resolvePicks(
  picks: Record<number, string>,
  materials: Material[],
): Record<number, string> {
  const byName = new Map(materials.map((m) => [m.material.toLowerCase(), m]));
  return Object.fromEntries(
    Object.entries(picks).flatMap(([i, name]) => {
      if (name === "") return [[Number(i), ""]]; // "on no row at all" — an override that matches nothing
      const m = byName.get(name.toLowerCase());
      return m ? [[Number(i), materialKey(m)]] : [];
    }),
  );
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
  /** Per-kit unit prices, keyed `category|material`. See `SavedKit.prices`. */
  prices: Record<string, number> = {},
  /** Corrected counts by line index. See `SavedKit.counts`. */
  counts: Record<number, number> = {},
): Kit {
  const byKey = new Map(materials.map((m) => [materialKey(m), m]));

  const costed: CostedLine[] = lines.map((read, i) => {
    // A corrected count replaces the read one everywhere below, so the packs, the line cost and
    // the piece total all agree with what is on screen.
    const line = counts[i] !== undefined ? { ...read, qty: counts[i] } : read;
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

    // A price given for THIS kit wins over the list, and counts even where the list has none —
    // that is the whole point of it, for a material nobody has priced yet.
    const each = match ? (prices[materialKey(match)] ?? match.paise) : null;

    // What is BOUGHT, which is not always what is counted. A sheet says "16 photo props"; the
    // price is for the one pack they come in. `ceil` because half a pack cannot be bought.
    const per = match?.piecesPerPack;
    const packs = per && per > 0 ? Math.ceil(line.qty / per) : line.qty;

    /**
     * Another row scored exactly as well, so which one won was the order of the list.
     *
     * `Star Foil` against `Blue Star Foil`, `Golden Star Foil` and `Pink Star Foil` is 0.80 three
     * times over — the read name simply does not say which, and the one that gets picked is
     * whichever `materials.json` happens to list first. That is a coin toss, and a coin toss must
     * never be quiet: this flags on top of the score band, so a tie is checked even if it lands
     * above SURE. The right fix is at the source (the prompt asks for the colour), but the sheet
     * does not always print one, and this is the case where being wrong costs real money.
     */
    const tied = !overridden && best !== undefined && choices.filter((c) => c.score === best.score).length > 1;

    return {
      ...line,
      match,
      score: s,
      flagged: !overridden && match !== null && (s < SURE || tied),
      overridden,
      choices,
      /** Set when this line's unit price came from the kit rather than the price list. */
      ownPrice: match !== null && prices[materialKey(match)] !== undefined,
      each,
      packs,
      // A matched material with a blank price cell costs `null`, never 0. Zero would fold into
      // the total as if the item were free, and nothing on screen would ever say otherwise.
      paise: each !== null && each !== undefined ? each * packs : null,
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

/** The GST rate the listings carry — `GST_5` on the Flipkart form. Editable per kit on screen. */
export const DEFAULT_GST_PERCENT = 5;

/**
 * What a sale actually leaves: the listed price, less the materials, the delivery and the GST.
 *
 * Indian marketplace prices are GST-INCLUSIVE, so the tax is EXTRACTED from what is left after
 * delivery (`base × rate / (100 + rate)`) rather than added on top — adding it would invent money
 * the buyer never paid. The Inventory panel's delivery table computes the same figure inline for
 * the kit being edited, because there the price is being typed and cannot come from disk; keep the
 * two in step. Still not profit: the marketplace commission, its own GST, packaging and ad spend
 * are all outside it.
 */
export function leftAfterEverything(
  pricePaise: number,
  shippingPaise: number,
  materialsPaise: number,
  gstPercent = DEFAULT_GST_PERCENT,
): number {
  const taxable = Math.max(pricePaise - shippingPaise, 0);
  return pricePaise - materialsPaise - shippingPaise - Math.round((taxable * gstPercent) / (100 + gstPercent));
}

export interface KitRow {
  sku: string;
  file: string;
  savedAt: string;
  /**
   * Per marketplace, what this kit leaves after everything — present only for marketplaces that
   * have a listed price, and only when `materials` was passed. Absent is a real state and not
   * zero: a kit costed but never listed has no margin to be right or wrong about.
   */
  left?: Record<string, number>;
}

/**
 * Every saved kit, newest first — and, when the price list is handed in, what each one leaves.
 *
 * Costed fresh here rather than read off the file, for the reason nothing stores a total: the
 * prices ship with the app, so a stored figure would be last month's balloon price with nothing
 * on screen to say so.
 */
export function listKits(dir = KITS_DIR, materials?: Material[]): KitRow[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const k = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SavedKit;
        const row: KitRow = {
          sku: k.sku || path.basename(f, ".json"),
          file: path.join(dir, f),
          savedAt: k.savedAt ?? "",
        };
        if (materials) {
          const cost = costKit(
            k.lines ?? [], materials, k.overrides ?? {}, k.sku, k.prices ?? {}, k.counts ?? {},
          ).totalPaise;
          const left: Record<string, number> = {};
          for (const [id, v] of Object.entries(k.marketplaces ?? {})) {
            if (!v?.pricePaise) continue; // no price listed is not a margin of zero
            left[id] = leftAfterEverything(v.pricePaise, v.shippingPaise ?? 0, cost);
          }
          if (Object.keys(left).length > 0) row.left = left;
        }
        return [row];
      } catch {
        return []; // a half-written file is not a reason for the list to fail
      }
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function readKit(file: string): SavedKit {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

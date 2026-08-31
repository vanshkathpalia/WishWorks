/**
 * stock-core.ts — the raw material actually in the building, and what is about to run out.
 *
 * **Not the same thing as a kit.** A kit says what one listing is made of; this says what is on the
 * shelf. Vansh, 2026-08-21: *"a raw inventory, not inventory of a listing but our company side
 * inventory… so that we know what products are going to exhaust soon."*
 *
 * The job it removes is a tally done twice on paper. The supplier sends a claim:
 *
 *     Vansh 19.8.26
 *     Groom to be foil 5 pkt ok
 *     1 pkt silver chrome ok
 *     Blue no foil. 0 to9 450 pcs ok
 *
 * Vansh then counts the delivery himself and writes his own list. The two are the same delivery in
 * two people's handwriting, and **the whole difficulty is that they are not the same WORDS** —
 * `2,pkt annprashan gold foil` against `Annaprashan Gold Foil Balloon`, quantity first on one line
 * and last on the next.
 *
 * **Nothing here matches names.** That was already solved: `candidates`/`score` in
 * `inventory-core.ts` is the matcher the costing panel uses against the same 121-row price list,
 * with the same three bands (`SURE`, `FLOOR`, below) and the same escape hatch — a human picks the
 * row and it is never re-scored. Writing a second matcher would be a second opinion about which
 * material this is, and the costing panel has already been through the argument (WW-115).
 *
 * **What is stored is deliveries, never a stock level.** On-hand is `received − used`, and both
 * sides are already facts we hold: deliveries here, and usage as the parcel ledger multiplied by
 * each kit's own material lines. A stored total would be a second answer to a question that
 * already has one, which this repo has been bitten by twice (C-049, C-061).
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./paths.js";
import { candidates, materialKey, FLOOR, SURE, type Candidate, type Material } from "./inventory-core.js";

/** Beside the orders, because both are records of a day's real-world event, not app state. */
export const STOCK_DIR = process.env.WW_STOCK_DIR ?? path.join(ROOT, "stock");

/** One line of a delivery note, as somebody wrote it. */
export interface NoteLine {
  /** How many. */
  qty: number;
  /** `pkt`, `pcs`, `petti`, `bandal`… — kept as written, never converted. See `onHand`. */
  unit: string;
  /** The material, in the writer's own words. */
  name: string;
  /** The line exactly as typed, so a wrong parse is visible beside its source. */
  raw: string;
}

/** The units these two write in. `pkt` is packets; `petti` and `bandal` are whole cartons. */
const UNITS = "pkt|pkts|packet|packets|pcs|pc|piece|pieces|petti|peti|bandal|bandel|bundle|kg|mtr";

/**
 * A handwritten delivery note, one line per material.
 *
 * **The quantity is not always first.** `5 pkt kitty five pcs set` starts with it; `Groom to be
 * foil 5 pkt` ends with it; `Blue no foil. 0 to9 450 pcs` buries it after a name that contains
 * digits of its own. So the rule is: find the number that has a UNIT against it, and the name is
 * whatever is left. That handles all three, and it is why the unit list above matters — without a
 * unit to anchor on, `0 to9` in the third line reads as the quantity.
 *
 * Lines with no number at all are still returned, with `qty: 0`. A line the reader could not
 * understand must appear on screen saying so; dropping it silently is how a delivery goes uncounted.
 *
 * ponytail: `ok` at the end is the writer ticking his own list, so it is stripped. If a material is
 * ever actually called "ok" this is wrong, and it is a one-word fix in `clean` below.
 */
export function readNote(text: string): NoteLine[] {
  const out: NoteLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    // A date line — `Vansh 19.8.26` — is a header, not a material.
    if (/^[A-Za-z]*\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\.?$/.test(line)) continue;

    const m = new RegExp(`(\\d+)\\s*[,.]?\\s*(${UNITS})\\b`, "i").exec(line);
    const qty = m === null ? 0 : Number(m[1]);
    const unit = m === null ? "" : m[2].toLowerCase();
    const name = clean(m === null ? line : line.slice(0, m.index) + " " + line.slice(m.index + m[0].length));
    out.push({ qty, unit, name: name || clean(line), raw: line });
  }
  return out;
}

/**
 * Trailing self-tick, stray punctuation and doubled spaces — not part of any material's name.
 *
 * Punctuation is stripped from BOTH ends: `2 pkt. brtb bunting golden ok` leaves the full stop
 * behind when the unit is cut out of the middle, and `. brtb bunting golden` matches nothing.
 */
const clean = (s: string): string =>
  s.replace(/\bok\b\.?\s*$/i, "").replace(/^[.,\s]+|[.,\s]+$/g, "").replace(/\s+/g, " ").trim();

/** One material across the two lists, and whether they agree about it. */
export interface TallyRow {
  /** The material as the SUPPLIER wrote it, or as we did when only we listed it. */
  name: string;
  /** `category|material` from the price list. Null means nothing on the list matched. */
  key: string | null;
  /** What the matcher scored, 0-1. 1 when a human picked the row. */
  score: number;
  /** The best few rows, so the dropdown opens on the likely answers. */
  choices: Candidate[];
  /** True when somebody picked this row by hand; it is never re-scored. */
  overridden: boolean;
  /** What the supplier says he sent. Null when only we listed it. */
  claimed: number | null;
  /** What we counted. Null when we have not counted it — NOT zero, which means "none arrived". */
  counted: number | null;
  unit: string;
  /** The two lists disagree about the number. Only meaningful when both sides have one. */
  mismatch: boolean;
}

/**
 * The supplier's list against ours, one row per material.
 *
 * **Matched on the price-list row, not on the words.** That is what lets `2,pkt annprashan gold
 * foil` and `Annaprashan Gold Foil` land on the same line: both score against the same 121 rows,
 * and two lines that resolve to one row ARE one material. Two lines nobody could match stay
 * separate and say so, because merging on spelling alone is how a real discrepancy gets hidden.
 *
 * `picks` is the human's answer, keyed by the supplier's exact wording — the same shape the costing
 * panel's overrides use, and for the same reason: somebody has looked at the box, which is more
 * than the matcher can do.
 */
export function tally(
  claimed: NoteLine[],
  counted: NoteLine[],
  materials: Material[],
  picks: Record<string, string> = {},
): TallyRow[] {
  const rows = new Map<string, TallyRow>();
  const resolve = (name: string) => {
    const pick = picks[name];
    const choices = candidates(name, materials, 5);
    if (pick !== undefined) {
      const chosen = materials.find((m) => materialKey(m) === pick);
      if (chosen) return { key: pick, score: 1, choices, overridden: true };
    }
    const best = choices[0];
    return {
      key: best !== undefined && best.score >= FLOOR ? materialKey(best.material) : null,
      score: best?.score ?? 0,
      choices,
      overridden: false,
    };
  };

  const add = (line: NoteLine, side: "claimed" | "counted") => {
    const r = resolve(line.name);
    // Unmatched lines are kept apart by their own wording: two things nobody could identify are
    // not evidence that they are the same thing.
    const id = r.key ?? `?${line.name.toLowerCase()}`;
    const row = rows.get(id) ?? {
      name: line.name, ...r, claimed: null, counted: null, unit: line.unit, mismatch: false,
    };
    row[side] = (row[side] ?? 0) + line.qty;
    if (row.unit === "") row.unit = line.unit;
    // The supplier's wording wins the label, because his note is the one being checked.
    if (side === "claimed") row.name = line.name;
    rows.set(id, row);
  };
  for (const l of claimed) add(l, "claimed");
  for (const l of counted) add(l, "counted");

  return [...rows.values()]
    .map((r) => ({ ...r, mismatch: r.claimed !== null && r.counted !== null && r.claimed !== r.counted }))
    // Everything needing a decision first: a disagreement, then anything one side missed, then
    // anything the matcher was unsure of. A tally is a worklist, not a report.
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const rank = (r: TallyRow): number =>
  r.mismatch ? 0
  : r.claimed === null || r.counted === null ? 1
  : r.key === null ? 2
  : r.score < SURE ? 3
  : 4;

/** A delivery, once it has been checked — what is stored, and the only thing that is. */
export interface Delivery {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Both notes exactly as pasted, so a bad parse can always be re-read rather than re-typed. */
  claimedNote: string;
  countedNote: string;
  /** The human's material picks, keyed by the wording they were made against. */
  picks: Record<string, string>;
  /**
   * What actually came in. **The counted figure, not the claimed one** — the count is the one
   * somebody did with their hands, and the claim is what it is checked against.
   */
  lines: { key: string | null; name: string; qty: number; unit: string }[];
}

export async function listDeliveries(): Promise<Delivery[]> {
  const names = (await readdir(STOCK_DIR).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
  const all = await Promise.all(
    names.map((n) =>
      readFile(path.join(STOCK_DIR, n), "utf8").then((t) => JSON.parse(t) as Delivery).catch(() => null),
    ),
  );
  return all.filter((d): d is Delivery => d !== null).sort((a, b) => b.date.localeCompare(a.date));
}

export async function writeDelivery(d: Delivery): Promise<void> {
  await mkdir(STOCK_DIR, { recursive: true });
  await writeFile(path.join(STOCK_DIR, `${d.date}.json`), `${JSON.stringify(d, null, 2)}\n`);
}

/** One material's stock: what came in, what the packing ate, what is left. */
export interface OnHand {
  key: string;
  name: string;
  received: number;
  /** Packs consumed by parcels packed since the first delivery was recorded. */
  used: number;
  left: number;
  unit: string;
  /**
   * Weeks of stock at the recent rate, or null when nothing has been used yet.
   *
   * **The number the whole panel exists for** — *"so that we know what products are going to
   * exhaust soon"*. A quantity on its own does not say that: 200 LEDs is a lot of one thing and a
   * fortnight of another.
   */
  weeksLeft: number | null;
}

/**
 * What is on the shelf: deliveries in, packing out.
 *
 * **Usage is counted only from the first delivery on record**, because before that there was no
 * stock figure for it to come off. Counting a year of packing against a carton that arrived on
 * Tuesday would show every material as deeply negative and the panel would be useless on day one.
 *
 * ponytail: units are taken at face value — a `pkt` in a delivery is netted against a `pack` in a
 * kit, and a `pcs` line against a kit that counts pieces. That is right for every material here
 * because both sides are describing the same box, but a supplier who switches from packets to
 * pieces mid-list will read wrong; the unit is on screen next to the number so it is visible. If
 * it ever bites, the fix is a pieces-per-pack column on the material, not arithmetic here.
 */
export function onHand(
  deliveries: Delivery[],
  /** Packs used per material key, from the parcel ledger x each kit's lines. */
  usedByKey: Map<string, number>,
  names: Map<string, string> = new Map(),
): OnHand[] {
  const rows = new Map<string, OnHand>();
  for (const d of deliveries) {
    for (const l of d.lines) {
      if (l.key === null) continue; // not on the price list — there is nothing to net it against
      const r = rows.get(l.key)
        ?? { key: l.key, name: names.get(l.key) ?? l.name, received: 0, used: 0, left: 0, unit: l.unit, weeksLeft: null };
      r.received += l.qty;
      if (r.unit === "") r.unit = l.unit;
      rows.set(l.key, r);
    }
  }
  for (const r of rows.values()) {
    r.used = usedByKey.get(r.key) ?? 0;
    r.left = r.received - r.used;
  }
  return [...rows.values()].sort((a, b) => a.left - b.left);
}

/** The earliest delivery on record — the day usage starts counting from. `null` when there are none. */
export const firstDelivery = (deliveries: Delivery[]): string | null =>
  deliveries.length === 0 ? null : deliveries.map((d) => d.date).sort()[0];

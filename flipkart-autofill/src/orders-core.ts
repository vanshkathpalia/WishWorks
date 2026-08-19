/**
 * orders-core.ts — the day's orders: read the manifest PDF, remember what was packed and by whom.
 *
 * The job it removes: reading the acceptance page and writing every order and SKU onto paper by
 * hand. The marketplace already knows what it sent — Meesho's Supplier Manifest carries a
 * **Picklist** page which is exactly the list being copied out, so the copying is the only part
 * that was ever ours, and it is the part that made mistakes.
 *
 * **The PDF is read here, with `node:zlib` and nothing else.** A manifest is a machine-generated
 * table: every cell is one `(text)Tj` after a `x y Td`, in a Flate-compressed content stream, and
 * a row is the cells that share a `y`. That is ~30 lines. `pdfjs-dist` is 3 MB of dependency for
 * fonts, shading and encrypted documents, none of which appears in a picklist.
 *
 * What is stored: one file per day, `orders/YYYY-MM-DD.json`, holding the SKUs, their quantities
 * and who packed each one. Who packed it is the point — the workers are paid monthly by how many
 * packets they did, and that number currently lives on the same piece of paper.
 */

import zlib from "node:zlib";
import { copyFile, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./paths.js";

/** One text cell as the PDF draws it: where it sits, and which stream (≈ page) drew it. */
type Cell = { page: number; x: number; y: number; text: string };

/** A SKU on the manifest, and what has since happened to it here. */
export interface OrderRow {
  sku: string;
  /** Total packets to make — summed if the same SKU appears on more than one manifest page. */
  qty: number;
  /**
   * Who packed it. Empty means not packed yet; more than one name splits the credit evenly,
   * which is what the workers already do between themselves ("fifty fifty, six and four, same
   * thing"). Deliberately not per-packet: nobody is going to record that one at a time.
   */
  packedBy: string[];
}

/** One working day. The file the whole panel reads and writes. */
export interface OrderDay {
  /** `YYYY-MM-DD`, taken from the manifest itself so nobody types a date. */
  date: string;
  /**
   * The manifests already merged in, by filename. Two couriers means two manifests in one day,
   * and dropping the same one in twice would otherwise double every quantity silently.
   */
  sources: string[];
  rows: OrderRow[];
}

export const ORDERS_DIR = process.env.WW_ORDERS_DIR ?? path.join(ROOT, "orders");

/**
 * Every `(text)Tj` in the file, with the position it was drawn at.
 *
 * Streams are found by scanning for the keyword rather than by parsing the object table: the
 * `/Length` of a stream is often an indirect reference, so honouring it means resolving objects,
 * and inflate already tells us where the data ends. **`i` must jump past `endstream`** — landing
 * on the `stream` inside that word is what made the first version see 1 of 13 streams and read a
 * manifest as empty.
 */
function cells(pdf: Buffer): Cell[] {
  const out: Cell[] = [];
  let i = 0;
  let page = 0;
  while ((i = pdf.indexOf("stream", i)) !== -1) {
    let s = i + "stream".length;
    if (pdf[s] === 0x0d) s++;
    if (pdf[s] === 0x0a) s++;
    const end = pdf.indexOf("endstream", s);
    let text = "";
    try {
      // latin1, not utf8: these are single-byte PDF string bytes, and utf8 would mangle any
      // that are not ASCII rather than leaving them alone.
      text = zlib.inflateSync(pdf.subarray(s, end === -1 ? pdf.length : end)).toString("latin1");
    } catch {
      // Not a Flate stream — an image, a font, or the cross-reference table. Nothing to read.
    }
    if (text.includes("Tj")) {
      page++;
      for (const m of text.matchAll(/([\d.-]+) ([\d.-]+) Td\s*\(((?:\\.|[^\\()])*)\)Tj/g)) {
        out.push({
          page,
          x: Number(m[1]),
          y: Number(m[2]),
          text: m[3].replace(/\\([()\\])/g, "$1").trim(),
        });
      }
    }
    i = end === -1 ? pdf.length : end + "endstream".length;
  }
  return out;
}

/** Cells sharing a page and a baseline, left to right — one row of the table. */
function rows(all: Cell[]): Cell[][] {
  const by = new Map<string, Cell[]>();
  for (const c of all) {
    const line = `${c.page}|${c.y}`;
    if (!by.has(line)) by.set(line, []);
    by.get(line)!.push(c);
  }
  return [...by.values()].map((r) => r.sort((a, b) => a.x - b.x));
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** `Date : 19 Aug, 2026` → `2026-08-19`. Null when the manifest does not say. */
function manifestDate(all: Cell[]): string | null {
  for (const c of all) {
    const m = /Date\s*:\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})/.exec(c.text);
    if (!m) continue;
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month < 0) continue;
    return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * The Picklist table out of a supplier manifest: `SKU | Color | Size | Total Quantity`.
 *
 * The picklist is used rather than the per-shipment pages because it is already the aggregate —
 * one line per SKU with the total — and it survives running onto a second page, since the totals
 * are summed here anyway.
 *
 * A data row is four cells whose last is a whole number, starting left of the `Color` column and
 * ending right of the `Size` one. The header row fails the number test and drops out on its own.
 *
 * ponytail: a SKU that is nothing but digits is skipped, because that is the one rule separating
 * a picklist row from a four-cell shipment row (`1 | 32116501352 | … | 1`). Every real SKU seen
 * so far has letters in it (`SVP025`, `007 annaprashan ct`). If a numeric-only SKU ever appears,
 * scope the search to pages carrying the `Total Quantity` header instead.
 */
export function parseManifest(bytes: Buffer): { date: string | null; rows: { sku: string; qty: number }[] } {
  const all = cells(bytes);
  const header = rows(all).find((r) => r.length === 4 && r[0].text === "SKU" && r[3].text === "Total Quantity");
  const totals = new Map<string, number>();
  if (header) {
    for (const r of rows(all)) {
      if (r.length !== 4) continue;
      const [sku, , , qty] = r.map((c) => c.text);
      if (!/^\d+$/.test(qty) || /^\d*$/.test(sku)) continue;
      if (r[0].x >= header[1].x || r[3].x < header[2].x) continue;
      totals.set(sku, (totals.get(sku) ?? 0) + Number(qty));
    }
  }
  return {
    date: manifestDate(all),
    rows: [...totals].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => b.qty - a.qty),
  };
}

/**
 * Fold a manifest into the day it belongs to, keeping whatever has already been packed.
 *
 * Re-dropping the same file is a no-op — the second courier's manifest arrives on the same day
 * and looks exactly like a repeat until you read the filename, so the filename is what decides.
 */
export function mergeManifest(
  day: OrderDay | null,
  parsed: { date: string | null; rows: { sku: string; qty: number }[] },
  source: string,
): OrderDay {
  const date = day?.date ?? parsed.date ?? new Date().toISOString().slice(0, 10);
  const base: OrderDay = day ?? { date, sources: [], rows: [] };
  if (base.sources.includes(source)) return base;
  const rows = base.rows.map((r) => ({ ...r }));
  for (const { sku, qty } of parsed.rows) {
    const found = rows.find((r) => r.sku === sku);
    if (found) found.qty += qty;
    else rows.push({ sku, qty, packedBy: [] });
  }
  return { date, sources: [...base.sources, source], rows: rows.sort((a, b) => b.qty - a.qty) };
}

/**
 * Packets per worker across the days given — what the monthly pay is worked out from.
 *
 * A SKU packed by two people is half each. Fractions are kept rather than rounded: three people
 * on ten packets is 3.33 each, and rounding every row would quietly lose packets over a month.
 */
export function workerCredit(days: OrderDay[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of days) {
    for (const row of day.rows) {
      if (row.packedBy.length === 0) continue;
      for (const who of row.packedBy) out[who] = (out[who] ?? 0) + row.qty / row.packedBy.length;
    }
  }
  return out;
}

/** `SVP033 - ANP002` → `SVP033ANP002`. Matching key only — never shown, never written to disk. */
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The second finished image for a SKU, out of the ready folder — the one that shows what goes in
 * the packet, which is the picture the person packing actually needs.
 *
 * Matched on the name containing the SKU, because the ready folder names a file
 * `<ID>-<title>-2.jpg` and the manifest carries only the ID part. Null when nothing matches, and
 * that is a state the panel draws rather than an error: a SKU can be sold before its images were
 * ever finished here.
 */
export async function imageForSku(readyDir: string, sku: string, position = 2): Promise<string | null> {
  const want = key(sku);
  if (!want) return null;
  const tail = new RegExp(`-${position}\\.(jpe?g|png)$`, "i");
  const stack = [readyDir];
  /**
   * An EXACT name wins over one that merely contains the SKU, and that is what makes
   * `addSkuImage` authoritative: a picture added here is filed as `SVP025-2.jpg`, while a
   * finished listing is `ANP-9-annaprashan-decoration-kit-…-2.jpg`. Without the preference the
   * two would tie and the answer would be whichever the directory walk reached first.
   */
  let loose: string | null = null;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!tail.test(e.name)) continue;
      const found = key(e.name.replace(tail, ""));
      if (found === want) return full;
      if (loose === null && found.includes(want)) loose = full;
    }
  }
  return loose;
}

/**
 * Put a picture on a SKU by hand, filed where the finished ones live.
 *
 * Vansh, 2026-08-19: *"my image files have the SKU name and all, the partner has not"* — his own
 * listings come out of the finish step already named and grouped, and his partner's do not, so
 * every one of his partner's SKUs shows *no image* on the packing screen. This is the way in for
 * a photo that was never through the pipeline.
 *
 * **Filed by `skuGroup`, the engine's own rule** — `SVP025` under `SVP/`, the same folder
 * `Sort into groups` would move it to — so the shared Drive folder stays readable to a person and
 * one rule keeps naming the subfolders. A SKU with no code in it (`007 annaprashan ct`) has no
 * group and lands in the root, which is exactly where `tidyReady` leaves that case too.
 *
 * The name is `<sku>-<position>.<ext>`, which is what `imageForSku` prefers, so **adding a picture
 * to a slot replaces what that slot showed** rather than leaving two candidates to choose between.
 * The original is copied, never moved: the photo is usually sitting in someone's Downloads and is
 * theirs, not ours.
 */
export async function addSkuImage(
  readyDir: string,
  sku: string,
  position: number,
  file: string,
): Promise<string> {
  const { skuGroup } = await import("./finish-core.js");
  const name = sku.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const dir = path.join(readyDir, skuGroup(sku));
  await mkdir(dir, { recursive: true });
  const to = path.join(dir, `${name}-${position}${path.extname(file).toLowerCase()}`);
  await copyFile(file, to);
  return to;
}

/** Null for a day nobody has recorded — the normal state of every day before the manifest lands. */
export async function readDay(date: string): Promise<OrderDay | null> {
  const text = await readFile(path.join(ORDERS_DIR, `${date}.json`), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as OrderDay);
}

export async function writeDay(day: OrderDay): Promise<void> {
  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(path.join(ORDERS_DIR, `${day.date}.json`), JSON.stringify(day, null, 2));
}

/** Every day on file, newest first. Small files, and a month of them is what pay day reads. */
export async function listDays(): Promise<OrderDay[]> {
  const names = (await readdir(ORDERS_DIR).catch(() => [])).filter((n) => n.endsWith(".json"));
  const days = await Promise.all(
    names.map((n) => readFile(path.join(ORDERS_DIR, n), "utf8").then((t) => JSON.parse(t) as OrderDay).catch(() => null)),
  );
  return days.filter((d): d is OrderDay => d !== null).sort((a, b) => b.date.localeCompare(a.date));
}

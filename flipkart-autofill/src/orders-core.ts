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
import { leadCode } from "./id.js";
import { ROOT } from "./paths.js";

/** One text cell as the PDF draws it: where it sits, and which stream (≈ page) drew it. */
type Cell = { page: number; x: number; y: number; text: string };

/** A SKU on the manifest, and what has since happened to it here. */
export interface OrderRow {
  sku: string;
  /** Total packets to make — summed if the same SKU appears on more than one manifest page. */
  qty: number;
  /**
   * Done. **Its own fact, separate from who did it**, because those are two answers and the second
   * one is optional: the packing is finished the moment the box is closed, and whether anybody has
   * said yet who closed it is a different question. It used to be inferred from `packedBy` being
   * non-empty, which forced a name out of you before you could tick anything off.
   *
   * Absent on a day recorded before this existed — a row with names on it was packed, and reading
   * it that way is what keeps those days right.
   */
  packed?: boolean;
  /**
   * Who packed it. Empty means not packed yet; more than one name splits the credit evenly,
   * which is what the workers already do between themselves ("fifty fifty, six and four, same
   * thing"). Deliberately not per-packet: nobody is going to record that one at a time.
   */
  packedBy: string[];
}

/**
 * One parcel on the manifest — one line of one order, with the number that identifies it for ever.
 *
 * **This is the unit that makes the arithmetic honest.** Meesho's manifest is a snapshot of
 * *everything ready to ship*, so the 12pm download says ANP006 × 6 and the 2pm one says × 10 —
 * the same six plus four more. Two couriers' manifests on one day, on the other hand, say 6 and 4
 * for genuinely different subOrders. At SKU level those two cases are identical and no rule can tell
 * them apart. At sub-order level there is nothing to decide: the same id is the same parcel, a new
 * id is a new parcel, and both cases come out right by counting the ids.
 *
 * `subOrder` is Meesho's own, and it is drawn across TWO baselines in the PDF — `32116501352`
 * then `6408960_1` — because the column is narrow. Both halves are needed: the tail is the line
 * number within an order, so two items of one order share the first half.
 */
export interface Shipment {
  /** `321165013526408960_1` — the identity. Stable across every re-download. */
  subOrder: string;
  /** The courier's tracking number. Changes if a parcel is re-booked, so it is not the identity. */
  awb: string;
  sku: string;
  /** Almost always 1 — one parcel, one item — but the column exists, so it is read, not assumed. */
  qty: number;
  /** Which courier is taking it, off the section header. Handover is per courier. */
  courier: string;
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
 * One parcel, as it is kept — the manifest's facts plus what has happened to it here.
 *
 * **Two dates, and they are not the same date.** `firstSeen` is the manifest's own, which is when
 * the marketplace expects it dispatched; `packedOn` is the day somebody actually closed the box.
 * They differ whenever tomorrow's dispatch gets packed today, which is normal here — Vansh:
 * *"sometimes if any order's dispatch is tomorrow, maybe we will pack it today only."* Pay is
 * worked out from `packedOn`, because that is the day the work was done.
 */
export interface SubOrder extends Shipment {
  /** `YYYY-MM-DD` — the date on the manifest this parcel first appeared on. */
  firstSeen: string;
  /** `YYYY-MM-DD` — the day it was packed. Absent means it is still outstanding. */
  packedOn?: string;
  /** Who packed it. Empty or absent even when packed: the names can be filled in later. */
  packedBy?: string[];
}

/**
 * A month of subOrders — the file on disk, and the only record of what anybody is owed.
 *
 * **Per month rather than per day**, because a day is not a unit of anything here: subOrders arrive
 * across a day and get packed across the next one, and pay is monthly. Per month also keeps the
 * file small enough to read whole and to back up, and lines the files up with the thing they are
 * used for.
 *
 * Filed by `firstSeen`, so a parcel never moves between files once written. Anything that counts
 * by `packedOn` — which is pay — reads every ledger and filters, since a parcel seen on the 31st
 * and packed on the 1st belongs to one month's file and the other month's wages.
 */
export interface Ledger {
  /** `YYYY-MM`. */
  month: string;
  /** Manifest filenames merged in. Kept for the record only — subOrders dedupe on their own ids. */
  sources: string[];
  subOrders: SubOrder[];
}

const ledgerFile = (month: string) => path.join(ORDERS_DIR, `${month}.json`);

/**
 * Fold a manifest's subOrders into a month, keeping everything already known about each one.
 *
 * **This is the whole answer to "did we already count this?"** and it needs no rule, because the
 * sub-order number is the parcel's identity. A manifest re-downloaded at 2pm lists the 12pm
 * subOrders again with the same ids and they are recognised; a second courier's manifest lists
 * different subOrders with different ids and they are added. Those two cases are indistinguishable
 * at SKU level — 6 then 10 versus 6 plus 4 — and no amount of arithmetic separates them.
 *
 * A parcel already here keeps its `firstSeen` and everything about its packing: seeing it again is
 * not new information about it. Only the courier is refreshed, because a parcel really can be
 * re-booked with a different one before it goes.
 */
export function mergeShipments(
  ledger: Ledger | null,
  shipments: Shipment[],
  seen: string,
  source: string,
): Ledger {
  const month = ledger?.month ?? seen.slice(0, 7);
  const subOrders = (ledger?.subOrders ?? []).map((p) => ({ ...p }));
  const byId = new Map(subOrders.map((p) => [p.subOrder, p]));

  for (const s of shipments) {
    const known = byId.get(s.subOrder);
    if (known) {
      known.courier = s.courier;
      known.awb = s.awb;
      continue;
    }
    const parcel: SubOrder = { ...s, firstSeen: seen };
    subOrders.push(parcel);
    byId.set(s.subOrder, parcel);
  }

  const sources = ledger?.sources ?? [];
  return {
    month,
    sources: sources.includes(source) ? sources : [...sources, source],
    subOrders,
  };
}

/** Still to pack, grouped by SKU, most first — the list the packing screen works down. */
export function outstanding(subOrders: SubOrder[]): { sku: string; qty: number; subOrders: SubOrder[] }[] {
  const by = new Map<string, SubOrder[]>();
  for (const p of subOrders) {
    if (p.packedOn) continue;
    if (!by.has(p.sku)) by.set(p.sku, []);
    by.get(p.sku)!.push(p);
  }
  return [...by]
    .map(([sku, ps]) => ({ sku, qty: ps.reduce((n, p) => n + p.qty, 0), subOrders: ps }))
    .sort((a, b) => b.qty - a.qty);
}

/**
 * Mark every outstanding parcel of one SKU packed, on a given day, by whoever did it.
 *
 * **Everything outstanding, because that is what the tick means** — this SKU is done. Parcels that
 * arrive afterwards are new ids and come back as a new, smaller number, which is exactly the
 * behaviour asked for: *"the checkbox means that SKU to 0… and then if any other manifest adds 4
 * more, re-render with 4."*
 *
 * ponytail: no partial packing. Four of six done needs a count box, and it has not come up; the
 * six would have to be ticked when the last one is closed. Add it if it does.
 */
export function packSku(ledger: Ledger, sku: string, on: string, by: string[] = []): Ledger {
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) =>
      p.sku === sku && !p.packedOn ? { ...p, packedOn: on, packedBy: by } : p,
    ),
  };
}

/** Undo the tick for one SKU on one day — everything it marked, and nothing anyone else did. */
export function unpackSku(ledger: Ledger, sku: string, on: string): Ledger {
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) => {
      if (p.sku !== sku || p.packedOn !== on) return p;
      const { packedOn: _gone, packedBy: _also, ...rest } = p;
      return rest;
    }),
  };
}

/** Name the packers on subOrders already ticked — the answer that is allowed to arrive later. */
export function creditSku(ledger: Ledger, sku: string, on: string, by: string[]): Ledger {
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) =>
      p.sku === sku && p.packedOn === on ? { ...p, packedBy: by } : p,
    ),
  };
}

export async function readLedger(month: string): Promise<Ledger | null> {
  const text = await readFile(ledgerFile(month), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as Ledger);
}

export async function writeLedger(ledger: Ledger): Promise<void> {
  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(ledgerFile(ledger.month), JSON.stringify(ledger, null, 2));
}

/** Every month on file, newest first. Small files, and pay day reads more than one of them. */
export async function listLedgers(): Promise<Ledger[]> {
  const names = (await readdir(ORDERS_DIR).catch(() => [])).filter((n) => /^\d{4}-\d{2}\.json$/.test(n));
  const all = await Promise.all(
    names.map((n) =>
      readFile(path.join(ORDERS_DIR, n), "utf8").then((t) => JSON.parse(t) as Ledger).catch(() => null),
    ),
  );
  return all.filter((l): l is Ledger => l !== null).sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Packets per person for one month, **counted by the day they were packed**.
 *
 * Reads every ledger rather than one, because the month a parcel is FILED under is the month it
 * arrived in, and the month it is PAID in is the month it was packed. Those differ around the
 * turn of a month, which is precisely when getting it wrong costs somebody money.
 *
 * A parcel packed with nobody named counts for nobody — it is not lost, it is simply not yet
 * anyone's; the names can be added to it any time.
 */
export function parcelCredit(ledgers: Ledger[], month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ledger of ledgers) {
    for (const p of ledger.subOrders) {
      if (!p.packedOn?.startsWith(month) || !p.packedBy?.length) continue;
      for (const who of p.packedBy) out[who] = (out[who] ?? 0) + p.qty / p.packedBy.length;
    }
  }
  return out;
}

/** What happened on one day: what was packed, by whom, and where it is going. */
export function daySummary(ledgers: Ledger[], on: string) {
  const packed = ledgers.flatMap((l) => l.subOrders.filter((p) => p.packedOn === on));
  const bySku = new Map<string, number>();
  const byPacker = new Map<string, number>();
  const byCourier = new Map<string, number>();
  for (const p of packed) {
    bySku.set(p.sku, (bySku.get(p.sku) ?? 0) + p.qty);
    byCourier.set(p.courier || "—", (byCourier.get(p.courier || "—") ?? 0) + p.qty);
    for (const who of p.packedBy ?? []) {
      byPacker.set(who, (byPacker.get(who) ?? 0) + p.qty / (p.packedBy?.length ?? 1));
    }
  }
  const rank = (m: Map<string, number>) =>
    [...m].map(([name, qty]) => ({ name, qty: Number(qty.toFixed(2)) })).sort((a, b) => b.qty - a.qty);
  return {
    date: on,
    packets: packed.reduce((n, p) => n + p.qty, 0),
    /** Ticked but with nobody named yet — the one number worth chasing before pay day. */
    unnamed: packed.filter((p) => !p.packedBy?.length).reduce((n, p) => n + p.qty, 0),
    left: ledgers.flatMap((l) => l.subOrders).filter((p) => !p.packedOn).reduce((n, p) => n + p.qty, 0),
    bySku: rank(bySku),
    byPacker: rank(byPacker),
    byCourier: rank(byCourier),
  };
}

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
export function parseManifest(bytes: Buffer): {
  date: string | null;
  rows: { sku: string; qty: number }[];
  shipments: Shipment[];
} {
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
    shipments: shipments(all),
  };
}

/**
 * The per-parcel pages: `S. No. | Sub Order No. | AWB | SKU | Qty. | Size`, one parcel per block.
 *
 * The block is three baselines and the spacing is regular — the row itself, the AWB about 8pt
 * below it, and the tail of the sub-order number about 15pt below. So: find the rows that look
 * like a parcel, then read the two lines under each. 20pt is comfortably inside the ~48pt gap to
 * the next parcel, so a block can never borrow its neighbour's number.
 *
 * A row is a parcel when it has five cells, starts with a serial number, carries a long digit run
 * next to it, and has a whole number where the quantity goes. The header row fails all three.
 */
function shipments(all: Cell[]): Shipment[] {
  // Which courier is carrying which page — the section header sits above its own subOrders, and
  // handover happens per courier, so it is worth keeping.
  const courierOf = new Map<number, string>();
  let courier = "";
  for (const c of all) {
    const m = /^Courier\s*:\s*(.+)$/.exec(c.text);
    if (m) courier = m[1].trim();
    if (!courierOf.has(c.page)) courierOf.set(c.page, courier);
  }

  const out: Shipment[] = [];
  for (const r of rows(all)) {
    if (r.length !== 5) continue;
    const [serial, head, sku, qty] = r.map((c) => c.text);
    if (!/^\d+$/.test(serial) || !/^\d{6,}$/.test(head) || !/^\d+$/.test(qty)) continue;

    const under = all.filter((c) => c.page === r[0].page && c.y < r[0].y && c.y > r[0].y - 20);
    // The AWB is the one indented past the sub-order column; the tail is the one that is not.
    const awb = under.find((c) => c.x > r[1].x + 40)?.text ?? "";
    const tail = under.find((c) => c.x <= r[1].x + 40)?.text ?? "";
    out.push({
      subOrder: head + tail,
      awb,
      sku,
      qty: Number(qty),
      courier: courierOf.get(r[0].page) ?? "",
    });
  }
  return out;
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
  /**
   * `ANP001` and `ANP-1-annaprasan-decoration-kit-…` are the same listing — see `leadCode`. When
   * the SKU carries a code, that code IS the comparison and a name merely CONTAINING it is not
   * good enough: `ANP001` sits inside `ANP-10-…` as happily as inside `ANP-1-…`, and showing a
   * packer the wrong kit is the one failure this screen must not have. A SKU with no code in it
   * (`007 annaprashan ct`) has nothing to compare, so those fall back to the plain contains.
   */
  const wantCode = leadCode(sku);
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
      const base = e.name.replace(tail, "");
      if (key(base) === want) return full;
      if (loose !== null) continue;
      if (wantCode ? leadCode(base) === wantCode : key(base).includes(want)) loose = full;
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

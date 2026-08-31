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
import { leadCode, themeIn } from "./id.js";
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
  /**
   * Which marketplace it came from.
   *
   * Stored per parcel rather than per file because the money differs by marketplace — a kit is
   * listed at one price on Meesho and another on Flipkart, and settles differently again — so
   * every figure downstream has to know which one paid. Set at import; the two manifests are
   * different documents and will be read by different parsers.
   */
  market: string;
  /** `YYYY-MM-DD` — the date on the manifest this parcel first appeared on. */
  firstSeen: string;
  /** `YYYY-MM-DD` — the day it was packed. Absent means it is still outstanding. */
  packedOn?: string;
  /**
   * The exact moment of the tick, ISO UTC — `packedOn` is the working day, this is the clock.
   *
   * **Added before anything reads it, which is the only time it can be.** Packets per person per
   * hour is a question somebody will ask, and it is the one figure here that cannot be worked out
   * later: a date says a packet was done on Tuesday and nothing on disk will ever say when on
   * Tuesday. One field, written at a moment we were already writing.
   *
   * Nothing computes pay or money from it — those use `packedOn`, the day, because a day is what a
   * wage is counted in and a parcel packed at 00:30 for the day before must not move months.
   */
  packedAt?: string;
  /** Who packed it. Empty or absent even when packed: the names can be filled in later. */
  packedBy?: string[];
  /**
   * What became of it. Absent means it went and stayed gone, which is the normal ending.
   *
   * **`rto`** — never delivered, refused or undeliverable, and it comes back. **`returned`** — it
   * was delivered and the buyer sent it back. They are different money: an RTO parcel usually
   * comes back sellable, a returned one often does not, and the fees differ. Kept as one field
   * with a date rather than as a rewrite of the packing record, because **a day's numbers must
   * not change after the day** — see `reversals` in `money()`.
   */
  status?: "rto" | "returned";
  /** `YYYY-MM-DD` — the day it came back, which is the day the money moves. */
  statusOn?: string;
  /**
   * What this parcel was worth **when it was packed**, in paise — the money, frozen at the tick.
   *
   * Vansh spotted the hole: *"all that name SKU cost the same, but that may not be true — maybe we
   * raise a ticket before and after so rates differ, but deduction will happen on the latest cost
   * in the JSON only… one solution is to timestamp the cost and bank settlement, but that is too
   * much overwork."* Right about the problem, and right that dated prices are the wrong fix.
   *
   * **The cheap and standard answer is to copy the numbers onto the record**, the way an invoice
   * stores a price rather than joining to a product table. Two integers, written once, at a moment
   * we are already writing. Correcting a kit's price then moves *today* and not last month, which
   * has already been reported; and an RTO reverses exactly what was booked rather than whatever
   * the kit says weeks later. Versioned prices would need a date lookup on every read and a screen
   * to manage them, to answer the same question worse.
   *
   * **Absent means "nothing had costed it yet"**, and the money falls back to what the kit says
   * today — right for every parcel packed before this existed, and for a SKU costed only after it
   * shipped. That fallback is what lets this arrive without a migration.
   */
  paidPaise?: number;
  /** What the materials cost when it was packed, in paise. Frozen with `paidPaise`, same reason. */
  materialsPaise?: number;
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
  market = "meesho",
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
    const parcel: SubOrder = { ...s, market, firstSeen: seen };
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
export function outstanding(
  subOrders: SubOrder[],
): { sku: string; qty: number; byMarket: { name: string; qty: number }[]; subOrders: SubOrder[] }[] {
  const by = new Map<string, SubOrder[]>();
  for (const p of subOrders) {
    if (p.packedOn) continue;
    if (!by.has(p.sku)) by.set(p.sku, []);
    by.get(p.sku)!.push(p);
  }
  return [...by]
    .map(([sku, ps]) => {
      // The split, because one SKU sells on both marketplaces and they are not interchangeable:
      // the money differs, and at handover the parcels go to different couriers.
      const m = new Map<string, number>();
      for (const p of ps) m.set(p.market, (m.get(p.market) ?? 0) + p.qty);
      return {
        sku,
        qty: ps.reduce((n, p) => n + p.qty, 0),
        byMarket: [...m].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
        subOrders: ps,
      };
    })
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
export function packSku(
  ledger: Ledger,
  sku: string,
  on: string,
  by: string[] = [],
  /**
   * How many packets this tick covers. `Infinity` — the usual — is *all of them*.
   *
   * Vansh, 2026-08-20: *"if not all 2 or all x, we should be able to enter a number for now, that
   * we packed y, so x−y is left."* Which is the honest shape of a working morning: half a SKU
   * gets done, the rest after lunch. The remainder stays in the queue as itself.
   *
   * ponytail: it stops at the first parcel that takes it past the number, so a parcel holding
   * more than one item can overshoot by that parcel. Every parcel seen so far is a single item.
   */
  limit = Infinity,
  /**
   * What each parcel is worth, resolved at the moment of the tick and frozen onto it.
   *
   * A function rather than two numbers, because parcels of one SKU can be on different
   * marketplaces and those pay differently. `null` means nothing has costed it yet, and the parcel
   * is left without a snapshot — a real state, not a zero.
   */
  priceAt: (p: SubOrder) => { paidPaise: number; materialsPaise: number } | null = () => null,
): Ledger {
  let left = limit;
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) => {
      if (p.sku !== sku || p.packedOn || left <= 0) return p;
      left -= p.qty;
      return { ...p, packedOn: on, packedAt: new Date().toISOString(), packedBy: by, ...(priceAt(p) ?? {}) };
    }),
  };
}

/** How many packets of one SKU are still to do — what the queue shows, and what a limit counts. */
export const leftToPack = (ledger: Ledger, sku: string): number =>
  ledger.subOrders.filter((p) => p.sku === sku && !p.packedOn).reduce((n, p) => n + p.qty, 0);

/** Undo the tick for one SKU on one day — everything it marked, and nothing anyone else did. */
export function unpackSku(ledger: Ledger, sku: string, on: string): Ledger {
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) => {
      if (p.sku !== sku || p.packedOn !== on) return p;
      const { packedOn: _gone, packedAt: _when, packedBy: _also, ...rest } = p;
      return rest;
    }),
  };
}

/** Name the packers on subOrders already ticked — the answer that is allowed to arrive later. */
export function creditSku(
  ledger: Ledger,
  sku: string,
  on: string,
  by: string[],
  /**
   * Whose names this is replacing — `[]` means *the ones nobody has been named on*.
   *
   * **It matters when a SKU is packed twice in a day.** Two go out in the morning credited to
   * Asha, two more after lunch credited to Ravi; a blanket "everything of this SKU today" would
   * quietly move the morning's work onto Ravi. Naming the batch being changed keeps each one to
   * itself, and still lets a name be toggled off and on while the chooser is open.
   */
  replacing: string[] = [],
): Ledger {
  const same = (a: string[]) => a.length === replacing.length && a.every((n) => replacing.includes(n));
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) =>
      p.sku === sku && p.packedOn === on && same(p.packedBy ?? []) ? { ...p, packedBy: by } : p,
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
  return all
    .filter((l): l is Ledger => l !== null)
    // Parcels written before `market` existed are Meesho's — it was the only manifest the app
    // could read. Defaulting on the way IN means nothing downstream has to remember this: without
    // it every one of them costed as `pays[undefined]`, which read as "no kit" and reported ₹0.
    .map((l) => ({ ...l, subOrders: l.subOrders.map((p) => ({ ...p, market: p.market || "meesho" })) }))
    .sort((a, b) => b.month.localeCompare(a.month));
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
  const rank = (m: Map<string, number>) =>
    [...m].map(([name, qty]) => ({ name, qty: Number(qty.toFixed(2)) })).sort((a, b) => b.qty - a.qty);
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
  return {
    date: on,
    packets: packed.reduce((n, p) => n + p.qty, 0),
    /** Ticked but with nobody named yet — the one number worth chasing before pay day. */
    unnamed: packed.filter((p) => !p.packedBy?.length).reduce((n, p) => n + p.qty, 0),
    /**
     * …and WHICH SKUs those are, so the screen can offer them back.
     *
     * Naming is deliberately allowed to lag the tick — the box gets closed in a hurry and the
     * names come later. That only works if there is a way back to what was ticked, otherwise
     * "later" means never and the month ends with packets nobody is paid for.
     */
    unnamedBySku: rank(
      packed.filter((p) => !p.packedBy?.length).reduce((m, p) => m.set(p.sku, (m.get(p.sku) ?? 0) + p.qty), new Map<string, number>()),
    ),
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
/**
 * A finished image's name, taken apart: which listing it belongs to and which slot it is.
 *
 * **Two spellings are in the ready folder and both are ours**, which is what WW-189 was:
 *
 *     ANP-4-annaprashan-decoration-kit-red-gold-balloons-2.jpg     the finish step's naming
 *     ANP-4.2.jpg  ·  HBD-01.2.jpg  ·  02.3.jpg                    the older, shorter naming
 *
 * The first was the only one the matcher understood, because it required a dash before the slot
 * number. Half the folder is written with a dot, and every one of those read as *no picture*.
 *
 * **The slot is the LAST number in the name**, not the second — Vansh's rule is "the second
 * number", which is the same thing on every name here, but the last one also survives a title that
 * carries a number of its own (`…-16-photo-booth-props-2`). The code is the `<letters><number>`
 * the name starts with, zero-insensitive, so `HBD-01` and `HBD001` are one listing.
 */
function pictureName(file: string): { code: string; slot: number | null; withoutSlot: string } {
  const base = file.replace(/\.(jpe?g|png|webp)$/i, "");
  const nums = base.match(/\d+/g) ?? [];
  return {
    code: leadCode(base),
    // Fewer than two numbers means the only number IS the listing's, so no slot is named.
    slot: nums.length >= 2 ? Number(nums[nums.length - 1]) : null,
    withoutSlot: base.replace(/[-_. ]*\d+$/, ""),
  };
}

export async function imageForSku(readyDir: string, sku: string, position = 2): Promise<string | null> {
  const want = key(sku);
  if (!want) return null;
  /**
   * `ANP001` and `ANP-1-annaprasan-…` are the same listing — see `leadCode`. When the SKU carries
   * a code, that code IS the comparison and a name merely CONTAINING it is not good enough:
   * `ANP001` sits inside `ANP-10-…` as happily as inside `ANP-1-…`, and showing a packer the wrong
   * kit is the one failure this screen must not have. A SKU with no code in it (`007 annaprashan
   * ct`) has nothing to compare, so those fall back to the plain contains.
   */
  const wantCode = leadCode(sku);
  const stack = [readyDir];
  /**
   * An EXACT name wins over one that merely belongs to the same listing, and that is what makes
   * `addSkuImage` authoritative: a picture added by hand is filed as `SVP025-2.jpg`, while a
   * finished listing is `ANP-9-annaprashan-…-2.jpg`. Without the preference the two would tie and
   * the answer would be whichever the directory walk reached first.
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
      // Pictures only. Without this, `SVP033-ANP002.csv` parses as "listing SVP033, slot 2" and
      // gets handed to the packing screen as an image — the folder holds spreadsheets too.
      if (!/\.(jpe?g|png|webp)$/i.test(e.name)) continue;
      const { code, slot, withoutSlot } = pictureName(e.name);
      if (slot !== position) continue;
      if (key(withoutSlot) === want) return full;
      if (loose !== null) continue;
      if (wantCode ? code === wantCode : key(withoutSlot).includes(want)) loose = full;
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
  // Tag then theme, the same two levels the finish step writes — otherwise a hand-added picture
  // would sit in `HBD/` while the finished ones for that listing sit in `HBD/peppa/`.
  const dir = path.join(readyDir, skuGroup(sku), themeIn(sku));
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
  // `YYYY-MM-DD.json` and nothing else. This folder holds the month ledgers and `packers.json`
  // too, and both parse perfectly well as JSON — so a loose `.endsWith(".json")` handed back
  // objects with no `date`, and the first thing that read `.date` threw. The whole packing screen
  // then sat on "Looking…" for ever, because a rejected IPC call never settles (WW-182).
  const names = (await readdir(ORDERS_DIR).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
  const days = await Promise.all(
    names.map((n) => readFile(path.join(ORDERS_DIR, n), "utf8").then((t) => JSON.parse(t) as OrderDay).catch(() => null)),
  );
  return days
    .filter((d): d is OrderDay => typeof d?.date === "string" && Array.isArray(d.rows))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Mark a parcel as come back — RTO or a return — on the day it came back.
 *
 * **The packing day is never rewritten.** Vansh asked whether the day's cost and profit should be
 * updated when something comes back; they should not, and this is the one design decision in here
 * worth defending. A figure that was reported on Tuesday has to still be that figure on Friday, or
 * nothing can ever be reconciled against a settlement statement — and things come back weeks
 * later. So the return is an event on ITS own day: the revenue is reversed there, the packing that
 * happened on Tuesday still happened, and a month adds up correctly either way round.
 */
export function markBack(
  ledger: Ledger,
  subOrder: string,
  status: "rto" | "returned",
  on: string,
): Ledger {
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) => (p.subOrder === subOrder ? { ...p, status, statusOn: on } : p)),
  };
}

/** Undo a wrongly-marked return. The parcel goes back to simply having been packed. */
export function clearBack(ledger: Ledger, subOrder: string): Ledger {
  return {
    ...ledger,
    subOrders: ledger.subOrders.map((p) => {
      if (p.subOrder !== subOrder) return p;
      const { status: _s, statusOn: _o, ...rest } = p;
      return rest;
    }),
  };
}

/** What one kit is worth, as the money view needs it. Filled from `listKits`. */
export interface KitMoney {
  sku: string;
  /** Materials, in paise, at today's prices. */
  costPaise?: number;
  /** Per marketplace, what a sale brings in. */
  pays?: Record<string, number>;
}

/**
 * Which costed kit is this manifest SKU?
 *
 * The manifest carries the seller's own code and a kit is filed under its listing name, and those
 * agree only sometimes: `SVP033` is the kit `SVP033 - ANP002`, and `ANP001` is the kit
 * `WKU001-ANP001` — a combo, where the code that matters is not the leading one. So **every
 * `<letters><number>` pair in the kit's name is a name it answers to**, which is the same rule the
 * kit list already groups by.
 *
 * Null when nothing matches, and that is a state to SHOW, not to treat as zero: a SKU with no kit
 * is not a free product, it is one nobody has costed. The whole panel exists to stop a missing
 * number quietly becoming a profit.
 */
export function kitForSku<T extends { sku: string }>(sku: string, kits: T[]): T | null {
  const want = leadCode(sku);
  if (!want) return null;
  return (
    kits.find((k) => codesIn(k.sku).includes(want)) ??
    kits.find((k) => leadCode(k.sku) === want) ??
    null
  );
}

/** Every `<letters><number>` in a name, normalised — `WKU001-ANP001` → `["WKU1", "ANP1"]`. */
const codesIn = (name: string): string[] =>
  [...name.matchAll(/([A-Za-z]+)[\s_-]*0*(\d+)/g)].map((m) => `${m[1].toUpperCase()}${m[2]}`);

/**
 * What was spent on ads and boost, in paise, by day and by marketplace.
 *
 * **The one cost here that nothing can derive.** Materials and revenue both fall out of the kit
 * and the ledger, which is why this repo refuses to store a second copy of them — but no parcel
 * knows what its marketplace charged to promote it, and no report we read carries it. Meesho's
 * Ads dashboard shows a spend per day; Flipkart's PLA campaigns show the same thing under
 * Advertising. Somebody reads the number off and types it in, and that is the whole mechanism.
 *
 * Per DAY rather than per month because the money screen's windows are today / this week / this
 * month, and a monthly lump would make two of the three lie. Per MARKETPLACE because the screen
 * splits by one, and a total that cannot be split is one the Meesho/Flipkart switch has to ignore.
 */
export type AdSpend = Record<string, Record<string, number>>;

/** Ads and boost inside a window, for one marketplace or all of them. */
export function adSpend(ads: AdSpend, from: string, to: string, market?: string): number {
  let paise = 0;
  for (const [day, byMarket] of Object.entries(ads)) {
    if (day < from || day > to) continue;
    for (const [name, amount] of Object.entries(byMarket)) {
      if (market === undefined || name === market) paise += amount;
    }
  }
  return paise;
}

/**
 * What a stretch of days was worth: what was packed, what it cost in materials, what came back.
 *
 * **Three separate facts, never one number.** Revenue and materials come from the costed kit;
 * anything with no kit is counted as `uncosted` and left OUT of both, because a SKU nobody has
 * costed contributes an unknown, not a zero. A screen that folded those into the profit would be
 * confidently wrong on exactly the days the partner's SKUs sold well.
 *
 * `reversals` are parcels that came back **in this window**, whenever they were packed — that is
 * the point of dating a return to its own day rather than editing the packing record.
 */
export function money(
  ledgers: Ledger[],
  kits: KitMoney[],
  from: string,
  to: string,
  /**
   * One marketplace, or all of them.
   *
   * **There is no settlement to reconcile between the two**, which is the answer to the question
   * it looks like it raises: a kit stores what each marketplace pays *separately*, so a parcel is
   * always priced by the one that sold it. Filtering here is about reading — *how did Meesho do
   * against Flipkart* — not about resolving a conflict, because there is not one.
   */
  market?: string,
  /** Ads and boost, by day and marketplace. Absent means none was ever typed in — not zero spend. */
  ads: AdSpend = {},
): {
  packets: number;
  revenuePaise: number;
  materialsPaise: number;
  /** Ads and boost in the window. Typed in by hand; nothing we read carries it. */
  adsPaise: number;
  profitPaise: number;
  /**
   * Every costed SKU and what it put in — the working, not just the answer.
   *
   * On screen because "where is this number coming from?" is the first thing anybody asks of a
   * total, and a total that cannot be taken apart is one nobody trusts. It also names the kit that
   * priced each line, which is the bit that surprises: `SVP033` is priced by the kit
   * `SVP033 - ANP002`, and it is easy to forget that kit exists.
   */
  costed: { name: string; kit: string; qty: number; revenuePaise: number; materialsPaise: number }[];
  /** Packed in the window but with no costed kit — shown, never folded into the total. */
  uncosted: { name: string; qty: number }[];
  /** Came back in the window: what it takes off the revenue, and the materials at risk with it. */
  reversals: { packets: number; revenuePaise: number; materialsPaise: number; rto: number; returned: number };
  byMarket: { name: string; qty: number }[];
} {
  const inWindow = (d?: string) => d !== undefined && d >= from && d <= to;
  const all = ledgers.flatMap((l) => l.subOrders);
  const uncosted = new Map<string, number>();
  const byMarket = new Map<string, number>();
  const costed = new Map<string, { kit: string; qty: number; revenuePaise: number; materialsPaise: number }>();
  let packets = 0;
  let revenuePaise = 0;
  let materialsPaise = 0;

  for (const p of all) {
    if (!inWindow(p.packedOn) || (market !== undefined && p.market !== market)) continue;
    packets += p.qty;
    byMarket.set(p.market, (byMarket.get(p.market) ?? 0) + p.qty);
    // **Frozen first, today's kit second.** What a parcel earned is a fact about the day it went
    // out, so correcting a price now must not rewrite a month already reported — the same rule
    // that dates a return to the day it came back rather than to its packing day.
    const kit = kitForSku(p.sku, kits);
    const paid = p.paidPaise ?? kit?.pays?.[p.market];
    const cost = p.materialsPaise ?? kit?.costPaise;
    if (paid === undefined || cost === undefined) {
      uncosted.set(p.sku, (uncosted.get(p.sku) ?? 0) + p.qty);
      continue;
    }
    revenuePaise += paid * p.qty;
    materialsPaise += cost * p.qty;
    const row = costed.get(p.sku)
      ?? { kit: kit?.sku ?? "priced when packed", qty: 0, revenuePaise: 0, materialsPaise: 0 };
    row.qty += p.qty;
    row.revenuePaise += paid * p.qty;
    row.materialsPaise += cost * p.qty;
    costed.set(p.sku, row);
  }

  const back = all.filter((p) => inWindow(p.statusOn) && (market === undefined || p.market === market));
  const reversals = { packets: 0, revenuePaise: 0, materialsPaise: 0, rto: 0, returned: 0 };
  for (const p of back) {
    reversals.packets += p.qty;
    if (p.status === "rto") reversals.rto += p.qty;
    if (p.status === "returned") reversals.returned += p.qty;
    // A reversal takes off exactly what was booked, not what the kit happens to say today.
    const kit = kitForSku(p.sku, kits);
    reversals.revenuePaise += (p.paidPaise ?? kit?.pays?.[p.market] ?? 0) * p.qty;
    reversals.materialsPaise += (p.materialsPaise ?? kit?.costPaise ?? 0) * p.qty;
  }

  const rank = (m: Map<string, number>) =>
    [...m].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);

  const adsPaise = adSpend(ads, from, to, market);

  return {
    packets,
    revenuePaise,
    materialsPaise,
    adsPaise,
    profitPaise: revenuePaise - materialsPaise - reversals.revenuePaise - adsPaise,
    costed: [...costed]
      .map(([name, r]) => ({ name, ...r }))
      .sort((a, b) => b.revenuePaise - a.revenuePaise),
    uncosted: rank(uncosted),
    reversals,
    byMarket: rank(byMarket),
  };
}

/**
 * What a kit is made of, as the reorder view needs it. Filled from `listKits`.
 *
 * Packs rather than pieces, because a pack is what gets bought: *"you are using 40 gold balloons a
 * week"* is only useful next to *"the last purchase was 500"*, and both are counted the same way.
 */
export interface KitMaterials {
  sku: string;
  materials?: { key: string; name: string; packs: number }[];
}

/**
 * How it sells: what comes back, what has stopped selling, and what is being used up.
 *
 * **Three questions neither seller panel can answer**, which is the whole reason this exists rather
 * than being a worse copy of their dashboards. Meesho shows Meesho's returns; Flipkart shows
 * Flipkart's; neither shows both in one place, neither joins any of it to what a kit costs US, and
 * **neither cuts by courier at all** — which is the actionable one, because if one courier RTOs
 * twice as often on the same SKU that is a handover decision the next morning.
 *
 * **The rate is attributed to the parcels PACKED in the window, not to the returns received in it.**
 * Those are different questions and only the first one is about a SKU or a courier: a return that
 * arrives in August belongs to whoever shipped it in July. Dividing this month's returns by this
 * month's packing would mix two populations and move every rate whenever volume changed.
 *
 * ponytail: the consequence is that a recent window UNDER-reports — parcels packed last week have
 * not had time to come back yet — so the screen says so and offers a window that ends weeks ago.
 * The fix, if it ever matters, is a cohort age cutoff; nobody has asked the question that needs it.
 */
export function howItSells(
  ledgers: Ledger[],
  kits: (KitMoney & KitMaterials)[],
  from: string,
  to: string,
  market?: string,
): {
  /** Per SKU, per courier, per marketplace — the same arithmetic, cut three ways. */
  bySku: BackRate[];
  byCourier: BackRate[];
  byMarket: BackRate[];
  /**
   * Parcels packed across every ledger, whenever. **Not a statistic — it is how the screen tells
   * *nothing sold in these 90 days* from *no manifest has ever been read*.** Those need different
   * sentences and different advice, and with no ledger every costed kit is trivially a slow mover,
   * which would print 26 rows of nonsense.
   */
  packedEver: number;
  /** Costed kits with nothing packed in the window: stock held for nobody. */
  slow: { sku: string; lastPacked: string | null }[];
  /**
   * Materials consumed by the window's packing, and what that is per week.
   *
   * Keyed as well as named, because the raw-stock panel nets this against deliveries and the name
   * is a label — two materials in different categories can share one.
   */
  burn: { key: string; name: string; packs: number; perWeek: number }[];
} {
  const all = ledgers.flatMap((l) => l.subOrders);
  const packed = all.filter(
    (p) => p.packedOn && p.packedOn >= from && p.packedOn <= to && (market === undefined || p.market === market),
  );

  const cut = (key: (p: SubOrder) => string): BackRate[] => {
    const rows = new Map<string, BackRate>();
    for (const p of packed) {
      const name = key(p) || "unknown";
      const r = rows.get(name) ?? { name, packets: 0, rto: 0, returned: 0, backRate: 0, lostPaise: 0 };
      r.packets += p.qty;
      if (p.status === "rto") r.rto += p.qty;
      if (p.status === "returned") r.returned += p.qty;
      // What a parcel that came back cost us: the sale we did not keep. Frozen figures first, for
      // the same reason `money` uses them — a price corrected today must not rewrite last month.
      if (p.status) r.lostPaise += (p.paidPaise ?? kitForSku(p.sku, kits)?.pays?.[p.market] ?? 0) * p.qty;
      rows.set(name, r);
    }
    return [...rows.values()]
      .map((r) => ({ ...r, backRate: r.packets === 0 ? 0 : (r.rto + r.returned) / r.packets }))
      .sort((a, b) => b.backRate - a.backRate || b.packets - a.packets);
  };

  // Last packed across EVERY ledger, not just the window — "nothing since March" is the sentence,
  // and it needs the date outside the window to be able to say it.
  const lastPacked = new Map<string, string>();
  for (const p of all) {
    if (!p.packedOn) continue;
    const kit = kitForSku(p.sku, kits);
    if (!kit) continue;
    const seen = lastPacked.get(kit.sku);
    if (seen === undefined || p.packedOn > seen) lastPacked.set(kit.sku, p.packedOn);
  }
  const sold = new Set(packed.map((p) => kitForSku(p.sku, kits)?.sku).filter(Boolean));
  const slow = kits
    .filter((k) => k.costPaise !== undefined && !sold.has(k.sku))
    .map((k) => ({ sku: k.sku, lastPacked: lastPacked.get(k.sku) ?? null }))
    .sort((a, b) => (a.lastPacked ?? "").localeCompare(b.lastPacked ?? ""));

  const used = new Map<string, { name: string; packs: number }>();
  for (const p of packed) {
    for (const m of kitForSku(p.sku, kits)?.materials ?? []) {
      const u = used.get(m.key) ?? { name: m.name, packs: 0 };
      u.packs += m.packs * p.qty;
      used.set(m.key, u);
    }
  }
  const weeks = Math.max(1, (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 6.048e8);
  const burn = [...used]
    .map(([key, u]) => ({ key, name: u.name, packs: u.packs, perWeek: Math.round((u.packs / weeks) * 10) / 10 }))
    .sort((a, b) => b.packs - a.packs);

  return {
    bySku: cut((p) => p.sku),
    byCourier: cut((p) => p.courier),
    byMarket: cut((p) => p.market),
    packedEver: all.filter((p) => p.packedOn).length,
    slow,
    burn,
  };
}

/** One cut of the return figures — a SKU, a courier or a marketplace, counted the same way. */
export interface BackRate {
  name: string;
  packets: number;
  rto: number;
  returned: number;
  /** `(rto + returned) / packets`, 0-1. */
  backRate: number;
  /** The revenue on the ones that came back, frozen at the tick. */
  lostPaise: number;
}

/**
 * Packets per person over a stretch of days, and what that comes to at their rate.
 *
 * A packet packed by two people is half each, and the halves are kept rather than rounded — three
 * people on ten packets is 3.33 each, and rounding every row loses packets over a month.
 */
export function packerPay(
  ledgers: Ledger[],
  from: string,
  to: string,
  rates: Record<string, number> = {},
  market?: string,
): { name: string; packets: number; paise: number }[] {
  const out = new Map<string, number>();
  for (const p of ledgers.flatMap((l) => l.subOrders)) {
    if (!p.packedOn || p.packedOn < from || p.packedOn > to || !p.packedBy?.length) continue;
    if (market !== undefined && p.market !== market) continue;
    for (const who of p.packedBy) out.set(who, (out.get(who) ?? 0) + p.qty / p.packedBy.length);
  }
  return [...out]
    .map(([name, packets]) => ({
      name,
      packets: Number(packets.toFixed(2)),
      paise: Math.round(packets * (rates[name] ?? 0)),
    }))
    .sort((a, b) => b.packets - a.packets);
}

/**
 * Every scrap of text in a file, whatever kind of file it is.
 *
 * **The trick that makes reading a marketplace's report possible without knowing its format.** A
 * returns report arrives as CSV one month and XLSX the next, with columns nobody documented and
 * headings that change — and matching on columns means guessing, and guessing about which parcel
 * came back is guessing about money. So nothing here parses a format: it gets the text out and
 * `idsInFile` looks for ids WE ALREADY KNOW. A file that mentions our order number is about our
 * parcel, wherever in it the number sits.
 *
 * Three shapes, because that is what the two marketplaces hand out: plain text (CSV), a zip
 * (XLSX is a zip of XML), and PDF (already handled by the manifest reader). Anything else falls
 * through as raw text, which still finds a number if the number is stored as text.
 */
function textIn(bytes: Buffer): string {
  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    return cells(bytes).map((c) => c.text).join("\n");
  }
  if (bytes.subarray(0, 2).toString("latin1") === "PK") {
    // A zip. Walk the local file headers and inflate each entry — for an XLSX the numbers live in
    // `sharedStrings.xml` and the sheet XML, and both come out as text.
    const out: string[] = [];
    let i = 0;
    while ((i = bytes.indexOf("PK\x03\x04", i, "latin1")) !== -1) {
      const method = bytes.readUInt16LE(i + 8);
      const nameLen = bytes.readUInt16LE(i + 26);
      const extraLen = bytes.readUInt16LE(i + 28);
      const start = i + 30 + nameLen + extraLen;
      let size = bytes.readUInt32LE(i + 18);
      // A streamed entry writes its size afterwards, so read to the next header instead.
      if (size === 0) {
        const next = bytes.indexOf("PK\x03\x04", start, "latin1");
        size = (next === -1 ? bytes.length : next) - start;
      }
      const chunk = bytes.subarray(start, start + size);
      try {
        out.push((method === 0 ? chunk : zlib.inflateRawSync(chunk)).toString("utf8"));
      } catch {
        // A compression this build cannot read, or a truncated entry — skip it, keep the rest.
      }
      i = start + size;
    }
    if (out.length > 0) return out.join("\n");
  }
  return bytes.toString("utf8");
}

/**
 * Which of our parcels does this file mention?
 *
 * Matches on the sub-order number and on the AWB, both exactly, because both are ours and both
 * appear in these reports. **Exact only, and deliberately:** a partial match on an order number
 * would tie every line item of one order together, and marking the wrong parcel returned moves
 * real money. A file that matches nothing is reported as matching nothing — never as a guess.
 */
export function idsInFile(bytes: Buffer, parcels: SubOrder[]): SubOrder[] {
  const text = textIn(bytes);
  // One pass over the text rather than one search per parcel: a month of packing against a long
  // report is otherwise thousands of scans of the same string.
  const seen = new Set(text.match(/[A-Za-z0-9_-]{8,}/g) ?? []);
  return parcels.filter((p) => seen.has(p.subOrder) || (p.awb !== "" && seen.has(p.awb)));
}

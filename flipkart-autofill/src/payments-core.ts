/**
 * payments-core.ts — what the marketplaces actually paid, per SKU and all together, off their own
 * payment files.
 *
 * Vansh, 2026-09-26: *"what we actually earn — return 0, RTO 0 income, only delivered… meesho and
 * flipkart provide a pdf or excel for payments, let's use that."* It replaces his partner's
 * *Meesho calculator* workbook: the same arithmetic, without pasting rows or typing pocket costs.
 *
 * **The marketplace's settlement column is the answer, not ours.** Meesho's *Final Settlement
 * Amount* and Flipkart's *Bank Settlement Value* are per order, after commission, shipping, return
 * charges, TCS and TDS. An RTO settles at 0; a customer return settles at minus its charges.
 * Checked on the partner's 289 Meesho orders: every return's settlement equals its return shipping
 * charge exactly, so summing settlements is his formula, not a new one.
 *
 * **Every payment LINE is kept, not one per order.** A marketplace can take money back after paying
 * it — a return after payout comes in a later file as a minus against the same order. Keeping only
 * the newest line per order would overwrite the payment with the deduction instead of adding them.
 *
 * On top of the files, four figures of Vansh's own (`PaymentSettings`): what an RTO and a return
 * cost beyond the settlement (tape, bag, time — his ₹5 and ₹10), and the parcel (₹3) — each
 * editable, the parcel switchable off in favour of a real logistics spend typed per range.
 *
 * XLSX is read with `zipEntries` and regexes — no spreadsheet library, for the same reason the
 * manifest has no PDF library: two known tables do not need a general parser.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { ORDERS_DIR, zipEntries } from "./orders-core.js";

export type Market = "meesho" | "flipkart";
export type Kind = "delivered" | "rto" | "return" | "other";

/** One payment line for one order, as a payment file reports it. Money in paise. */
export interface Payment {
  market: Market;
  /** Meesho's sub-order, Flipkart's order item — the id a manifest carries too. */
  subOrder: string;
  sku: string;
  /** `YYYY-MM-DD`. */
  orderDate: string;
  /** The marketplace's own words, as written: `Delivered`, `RTO`, `Customer Return`… */
  status: string;
  kind: Kind;
  /** `YYYY-MM-DD`; "" when the file does not say (an RTO that was never paid). */
  paymentDate: string;
  /** The bank transfer — Meesho `AXISCN…`, Flipkart `NFT-/XUTR/DEUTH…`. What a bank statement shows. */
  txn: string;
  /** Meesho's *Order source* says "Ad order". Flipkart does not say. */
  adOrder: boolean;
  /** What the buyer paid, incl. shipping and GST. */
  salePaise: number;
  /** What reaches the bank for this line. */
  settledPaise: number;
  /** The product's GST %, for the output-tax estimate. */
  gstRate: number;
  /** GST that can be claimed back: the GST inside the marketplace's fees, plus TCS. Positive. */
  creditPaise: number;
  /** Income-tax TDS the marketplace deducted — claimed at income-tax filing, not GST. Positive. */
  tdsPaise: number;
  /** From an OUTSTANDING file: Meesho's estimate of a payment not made yet. See `isUpcomingFile`. */
  expected?: boolean;
}

/** A line that is not an order: ads, a fee, a compensation, a recovery. Signed — ads are negative. */
export interface OtherLine {
  market: Market;
  kind: "ads" | "fee" | "compensation";
  /** The day it is about — for ads, the day the ads RAN, so "ads in a range of days" is honest. */
  date: string;
  paise: number;
  /** Campaign id for ads; what it was for, otherwise. */
  note: string;
  /** From an OUTSTANDING file — not deducted yet. */
  expected?: boolean;
}

/** Vansh's own figures, in paise. Editable on the screen; these are his 2026-09-27 defaults. */
export interface PaymentSettings {
  /** Beyond Meesho's ₹0 — print, tape, bag, a little damage. */
  rtoLossPaise: number;
  /** Beyond the marketplace's return charge — time, and the odd kit that comes back empty. */
  returnLossPaise: number;
  /** Bag and label per parcel sent. Off when a real logistics spend is typed instead. */
  parcelPaise: number;
  parcelOn: boolean;
}

export const DEFAULT_SETTINGS: PaymentSettings = {
  rtoLossPaise: 500,
  returnLossPaise: 1000,
  parcelPaise: 300,
  parcelOn: true,
};

export interface PaymentBook {
  payments: Payment[];
  other: OtherLine[];
  files: string[];
  settings?: PaymentSettings;
}

const BOOK = () => path.join(ORDERS_DIR, "payments.json");

export async function readPayments(): Promise<PaymentBook> {
  const text = await readFile(BOOK(), "utf8").catch(() => null);
  return text === null ? { payments: [], other: [], files: [] } : (JSON.parse(text) as PaymentBook);
}

/** Temp file then rename, like `writeLedger`: a payment book is never left half-written. */
export async function writePayments(book: PaymentBook): Promise<void> {
  await mkdir(ORDERS_DIR, { recursive: true });
  const tmp = `${BOOK()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, JSON.stringify(book, null, 1));
  await rename(tmp, BOOK());
}

// ---------------------------------------------------------------- reading an XLSX

// Numeric entities too: Flipkart's two-line headers carry their line break as `&#10;`.
const unxml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** `AB12` → 27 (zero-based column). */
const colOf = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Every sheet of an XLSX, by tab name, as rows of text cells. Blank cells are "". */
export function sheets(bytes: Buffer): Map<string, string[][]> {
  const z = zipEntries(bytes);
  const shared = [...(z.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const rels = new Map(
    [...(z.get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)]
      .map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, "xl/")]),
  );
  const out = new Map<string, string[][]>();
  for (const m of (z.get("xl/workbook.xml") ?? "").matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    const xml = z.get(rels.get(m[2]) ?? "") ?? "";
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, ref, attrs, body = ""] = c;
        const t = /t="(\w+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        row[colOf(ref)] =
          t === "s" ? (shared[Number(v)] ?? "")
          : t === "inlineStr" ? unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""))
          : unxml(v);
      }
      rows.push(Array.from(row, (x) => (x ?? "").trim()));
    }
    out.set(unxml(m[1]), rows);
  }
  return out;
}

const paise = (s: string | undefined) => Math.round(Number(s || 0) * 100) || 0;

/**
 * `2026-08-01 18:58:59` → `2026-08-01`, and an Excel day number (`46235.79`) the same way — a file
 * that has been opened and saved in Excel carries dates as numbers. "" for anything else.
 */
export function dayOf(s: string | undefined): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  return "";
}

/**
 * A table on a sheet: the first row with a header starting `key` is the header row, and every later
 * row becomes a record keyed by header. A header is cut at its first line or " = " — Flipkart writes
 * `Bank Settlement Value (Rs.) \n= SUM(J:R)` — and the FIRST column of a repeated name wins.
 */
function table(rows: string[][] | undefined, key: string): Record<string, string>[] {
  const clean = (h: string) => h.split("\n")[0].split(" = ")[0].trim();
  const at = rows?.findIndex((r) => r.some((h) => clean(h).startsWith(key))) ?? -1;
  if (!rows || at === -1) return [];
  const head = rows[at].map(clean);
  return rows.slice(at + 1).map((r) => {
    const rec: Record<string, string> = {};
    head.forEach((h, i) => {
      if (h && !(h in rec)) rec[h] = r[i] ?? "";
    });
    return rec;
  });
}

/** The marketplace's word, put in a bucket. Flipkart's RTO is a *Courier Return*. */
export function kindOf(status: string): Kind {
  const s = status.toLowerCase();
  if (s.includes("rto") || s.includes("courier return")) return "rto";
  if (s.includes("return")) return "return";
  if (s.includes("deliver") || s === "na" || s === "") return "delivered";
  return "other";
}

/**
 * A file's orders and other lines — empty when it is neither marketplace's payment file. `unread`
 * names any tab that holds numbers this reader could not place, so a new kind of deduction is
 * reported instead of silently left out of the profit.
 */
export type Read = { market: Market | null; payments: Payment[]; other: OtherLine[]; unread: string[] };

/**
 * Meesho's payment file — *Payments → Previous payments* (or *Upcoming*, same layout). Order rows
 * are the ones whose first cell is a sub-order (`315118640940072128_1`).
 *
 * The fees are not read column by column: they are what is left of the settlement once the sale,
 * the returned sale, TCS and TDS are taken out. That covers every fee Meesho adds later without a
 * new column here. The GST inside them (18%) is claimable, and so is the TCS.
 */
function meesho(all: Map<string, string[][]>): Payment[] {
  return table(all.get("Order Payments"), "Sub Order No")
    .filter((r) => /^\d+_\d+$/.test(r["Sub Order No"]))
    .map((r) => {
      const sale = paise(r["Total Sale Amount (Incl. Shipping & GST)"]);
      const saleBack = paise(r["Total Sale Return Amount (Incl. Shipping & GST)"]);
      const settled = paise(r["Final Settlement Amount"]);
      const tcs = paise(r["TCS"]);
      const tds = paise(r["TDS"]);
      const fees = settled - sale - saleBack - tcs - tds; // negative: what Meesho kept, GST included
      return {
        market: "meesho" as const,
        subOrder: r["Sub Order No"],
        sku: r["Supplier SKU"],
        orderDate: dayOf(r["Order Date"]),
        status: r["Live Order Status"],
        kind: kindOf(r["Live Order Status"]),
        paymentDate: dayOf(r["Payment Date"]),
        txn: r["Transaction ID"] === "NA" ? "" : r["Transaction ID"],
        adOrder: /ad order/i.test(r["Order source"]),
        salePaise: sale,
        settledPaise: settled,
        gstRate: Number(r["Product GST %"]) || 5,
        creditPaise: Math.round((-fees * 18) / 118) - tcs,
        tdsPaise: -tds,
      };
    });
}

function meeshoOther(all: Map<string, string[][]>): OtherLine[] {
  // Ads are money out and inside no order's settlement. Dated by the day they ran.
  const ads = table(all.get("Ads Cost"), "Total Ads Cost")
    .filter((r) => dayOf(r["Deduction Duration"] || r["Deduction Date"]))
    .map((r) => ({
      market: "meesho" as const, kind: "ads" as const, date: dayOf(r["Deduction Duration"] || r["Deduction Date"]),
      paise: -Math.abs(paise(r["Total Ads Cost"])), note: r["Campaign ID"],
    }));
  const comp = table(all.get("Compensation and Recovery"), "Amount (inc GST) INR")
    .filter((r) => dayOf(r["Date"]))
    .map((r) => ({
      market: "meesho" as const, kind: "compensation" as const, date: dayOf(r["Date"]),
      paise: paise(r["Amount (inc GST) INR"]), note: [r["Program Name"], r["Reason"]].filter(Boolean).join(" — "),
    }));
  const referral = table(all.get("Referral Payments"), "Net Referral Amount")
    .filter((r) => dayOf(r["Payment Date"]))
    .map((r) => ({
      market: "meesho" as const, kind: "compensation" as const, date: dayOf(r["Payment Date"]),
      paise: paise(r["Net Referral Amount"]), note: ["Referral", r["Reason"]].filter(Boolean).join(" — "),
    }));
  return [...ads, ...comp, ...referral];
}

/**
 * A tab this reader does not know by name, read as dated amounts — the first column whose header
 * says *date* and the first that says *amount / cost / value / fee / charge*.
 *
 * **Why it exists: boost.** Vansh, 2026-09-27: Meesho's *boost a listing* is ₹100 a day for about
 * five days and comes off the payout — but no file seen so far has had one, so its tab and columns
 * are unknown. A tab named for ads, boost or promotion counts as ad spend (always money out);
 * anything else as a fee, signed as written. A tab with numbers and no such columns is `unread`.
 */
export function unknownTab(market: Market, name: string, rows: string[][]): { lines: OtherLine[]; unread: boolean } {
  const at = rows.findIndex((r) => r.some((h) => /date/i.test(h)) && r.some((h) => /amount|cost|value|fee|charge/i.test(h)));
  const hasNumbers = rows.slice(2).some((r) => r.some((c) => /^-?\d+(\.\d+)?$/.test(c)));
  if (at === -1) return { lines: [], unread: hasNumbers };
  const head = rows[at];
  const dateCol = head.findIndex((h) => /date/i.test(h));
  const amountCol = head.findIndex((h) => /amount|cost|value|fee|charge/i.test(h));
  const ads = /ads|boost|promot/i.test(name);
  const lines = rows
    .slice(at + 1)
    .map((r) => ({ date: dayOf(r[dateCol]), v: r[amountCol] }))
    .filter((x) => x.date && x.v !== "" && Number.isFinite(Number(x.v)))
    .map((x) => ({
      market,
      kind: ads ? ("ads" as const) : ("fee" as const),
      date: x.date,
      paise: ads ? -Math.abs(paise(x.v)) : paise(x.v),
      note: name,
    }));
  return { lines, unread: lines.length === 0 && hasNumbers };
}

/** Tabs each reader knows by name — the rest go through `unknownTab`. */
const KNOWN: Record<Market, Set<string>> = {
  meesho: new Set(["Disclaimer", "Order Payments", "Ads Cost", "Referral Payments", "Compensation and Recovery"]),
  flipkart: new Set(["Report Help", "Summary of report", "Orders", "GST_Details"]),
};

/**
 * Flipkart's *Settled Transactions* report (Seller Hub → Reports → Payment Reports), one per payout.
 * Order rows are on *Orders*; a sale with no return is delivered. Flipkart states the claimable GST
 * and TCS per order (*Input GST + TCS Credits*) and the TDS (*Income Tax Credits*), so neither is
 * worked out here.
 *
 * ponytail: the product's GST rate is not in this file; 5% is assumed, which every kit sold so far is.
 */
function flipkart(all: Map<string, string[][]>): Payment[] {
  return table(all.get("Orders"), "Order item ID")
    .filter((r) => /^\d+$/.test(r["Order item ID"]))
    .map((r) => {
      const ret = r["Return Type"] && r["Return Type"] !== "NA" ? r["Return Type"] : "";
      return {
        market: "flipkart" as const,
        subOrder: r["Order item ID"],
        sku: r["Seller SKU"],
        orderDate: dayOf(r["Order Date"]),
        status: ret || "Delivered",
        kind: ret ? kindOf(ret) : "delivered",
        paymentDate: dayOf(r["Payment Date"]),
        txn: r["NEFT ID"],
        adOrder: false,
        salePaise: paise(r["Sale Amount (Rs.)"]),
        settledPaise: paise(r["Bank Settlement Value (Rs.)"]),
        gstRate: 5,
        creditPaise: paise(r["Input GST + TCS Credits (Rs.)"]),
        tdsPaise: paise(r["Income Tax Credits (Rs.)"]),
      };
    });
}

/** Every other Flipkart sheet with a *Settlement Value*: ads, storage, fines, services, rebates. */
function flipkartOther(all: Map<string, string[][]>): OtherLine[] {
  const out: OtherLine[] = [];
  for (const [name, rows] of all) {
    if (KNOWN.flipkart.has(name)) continue;
    for (const r of table(rows, "Settlement Value")) {
      const v = r["Settlement Value (Rs.)"] ?? r["Settlement Value(Rs.)"];
      const date = dayOf(r["Payment Date"]);
      if (!v || !date) continue;
      out.push({
        market: "flipkart", kind: /ads/i.test(name) ? "ads" : "fee", date,
        paise: paise(v), note: [name, r["Campaign / Transaction ID"] ?? r["Service Name"] ?? ""].filter(Boolean).join(" — "),
      });
    }
  }
  return out;
}

/** Either marketplace's payment file, told apart by its sheets. */
export function readPaymentFile(bytes: Buffer): Read {
  const all = sheets(bytes);
  const market: Market | null = all.has("Order Payments") ? "meesho" : all.has("Orders") && all.has("GST_Details") ? "flipkart" : null;
  if (market === null) return { market, payments: [], other: [], unread: [] };
  const payments = market === "meesho" ? meesho(all) : flipkart(all);
  const other = market === "meesho" ? meeshoOther(all) : flipkartOther(all);
  const unread: string[] = [];
  for (const [name, rows] of all) {
    if (KNOWN[market].has(name)) continue;
    // Flipkart's other tabs carry a Settlement Value and were read above; a tab that has one is done.
    if (market === "flipkart" && rows.some((r) => r.some((h) => h.startsWith("Settlement Value")))) continue;
    const t = unknownTab(market, name, rows);
    other.push(...t.lines);
    if (t.unread) unread.push(name);
  }
  return { market, payments, other, unread };
}

/**
 * Meesho's *Outstanding payment* file: what it expects to pay, and when — estimates, per its own
 * disclaimer, until logistics are settled. Same sheets as a *Previous payment* file, so only the name
 * tells them apart; its lines also carry no transaction id yet (but so does a paid RTO, so that alone
 * is not enough).
 */
export const isUpcomingFile = (file: string): boolean => /OUTSTANDING/i.test(file);

/**
 * The same order, and the same thing happening to it — how an estimate finds the payment that
 * replaces it. `Shipped` (kind other) is an order still on its way: whatever it becomes, the real
 * line replaces it.
 */
const sameOutcome = (est: Payment, paid: Payment) =>
  est.market === paid.market && est.subOrder === paid.subOrder && (est.kind === paid.kind || est.kind === "other");

/** The book with no estimates in it: money actually received and actually deducted. */
export function settledOnly(book: PaymentBook): PaymentBook {
  return { ...book, payments: book.payments.filter((p) => !p.expected), other: book.other.filter((o) => !o.expected) };
}

/** What is still to come, whatever the range: how much, how many orders, and between which dates. */
export function upcoming(book: PaymentBook, market?: Market) {
  const lines = book.payments.filter((p) => p.expected && (!market || p.market === market));
  const others = book.other.filter((o) => o.expected && (!market || o.market === market));
  const dates = lines.map((p) => p.paymentDate).filter(Boolean).sort();
  return {
    paise: lines.reduce((n, p) => n + p.settledPaise, 0) + others.reduce((n, o) => n + o.paise, 0),
    orders: new Set(lines.map((p) => p.subOrder)).size,
    /** Meesho's "unscheduled": no payment date yet — mostly not delivered, or delivered too recently. */
    undated: lines.filter((p) => !p.paymentDate).length,
    /** Still `Shipped` — the estimate that is likeliest to change, into an RTO at ₹0. */
    shipped: lines.filter((p) => p.kind === "other" && /ship/i.test(p.status)).length,
    from: dates[0] ?? "",
    to: dates[dates.length - 1] ?? "",
  };
}

/**
 * Fold a file into the book. **A line is its order AND its transfer**: the same order paid in one
 * payout and taken back in a later one is two lines, and both count. Re-reading a file matches every
 * line it already added, so it changes nothing.
 */
export function mergePayments(book: PaymentBook, read: { payments: Payment[]; other: OtherLine[] }, file: string): PaymentBook {
  let old = book.payments;
  let oldOther = book.other;
  let incoming = read.payments;
  let incomingOther = read.other;
  const markets = new Set([...read.payments, ...read.other].map((x) => x.market));
  if (isUpcomingFile(file)) {
    // **The newest outstanding file is the whole picture of what is coming**, so the estimates from an
    // older one go. ponytail: newest-imported wins, not newest-dated; import an older one last and it
    // replaces the newer. Estimates for an outcome already paid are not taken at all.
    old = old.filter((p) => !(p.expected && markets.has(p.market)));
    oldOther = oldOther.filter((o) => !(o.expected && markets.has(o.market)));
    incoming = read.payments
      .filter((e) => !old.some((p) => !p.expected && sameOutcome(e, p)))
      .map((p) => ({ ...p, expected: true }));
    incomingOther = read.other.map((o) => ({ ...o, expected: true }));
  } else {
    // A real payment arrives: the estimate it replaces goes, or both would count.
    old = old.filter((e) => !(e.expected && read.payments.some((p) => sameOutcome(e, p))));
  }
  const key = (p: Payment) => `${p.market}|${p.subOrder}|${p.txn}|${p.paymentDate}|${p.settledPaise}`;
  const by = new Map(old.map((p) => [key(p), p]));
  for (const p of incoming) by.set(key(p), p);
  // Ads are keyed by the day they ran, so the real deduction overwrites its estimate by itself.
  const okey = (o: OtherLine) => `${o.market}|${o.kind}|${o.date}|${o.paise}|${o.note}`;
  const other = new Map(oldOther.map((o) => [okey(o), o]));
  for (const o of incomingOther) other.set(okey(o), o);
  return {
    ...book,
    payments: [...by.values()],
    other: [...other.values()],
    files: book.files.includes(file) ? book.files : [...book.files, file],
  };
}

// ---------------------------------------------------------------- adding it up

type Counts = { delivered: number; rto: number; return: number; other: number };

/** One SKU's — or everything's — figures. Money in paise. */
export interface Figures {
  counts: Counts;
  /** Sum of settlements: delivered pays, RTO 0, returns minus. */
  paidPaise: number;
  /** Kit cost × delivered orders. Uncosted SKUs are left out and named in `uncosted`. */
  pocketPaise: number;
  /** RTO + return losses of Vansh's own, and the parcel when it is on. */
  lossesPaise: number;
  profitPaise: number;
}

export interface Summary {
  range: { from: string; to: string };
  total: Figures;
  bySku: (Figures & { sku: string; rtoPercent: number; perOrderPaise: number; uncosted: boolean })[];
  /** Ads in the range, by the day they ran — all together and per campaign. */
  ads: { totalPaise: number; byCampaign: { market: Market; campaign: string; paise: number }[] };
  /** Fees, compensation and recoveries that are not an order. Signed. */
  otherPaise: number;
  /** A logistics spend typed for this range, used instead of the per-parcel figure. */
  logisticsPaise: number;
  /** Profit after ads, other lines and logistics — before GST. */
  netPaise: number;
  gst: { outputPaise: number; creditPaise: number; payablePaise: number; tdsPaise: number };
  /** Net after the GST estimate (a credit left over is not added — it is not money in hand). */
  afterGstPaise: number;
  /** Orders that came from ads against the rest — ads charged to the ad orders. */
  adEffect: { ad: Figures; organic: Figures; adsPaise: number } | null;
  uncosted: string[];
}

const zero = (): Figures => ({
  counts: { delivered: 0, rto: 0, return: 0, other: 0 }, paidPaise: 0, pocketPaise: 0, lossesPaise: 0, profitPaise: 0,
});

/**
 * Everything for one range of PAYMENT dates (`from`/`to` inclusive, "" = open). `costOf` is the
 * kit's pocket cost for a SKU, or null when it has none — never 0, because an uncosted kit is not a
 * free one.
 */
export function summarise(
  book: PaymentBook,
  opts: {
    from?: string;
    to?: string;
    market?: Market;
    costOf?: (sku: string) => number | null;
    /** A real logistics spend for this range; when given, the per-parcel figure is not used. */
    logisticsPaise?: number;
  } = {},
): Summary {
  const { from = "", to = "", market, costOf = () => null, logisticsPaise = 0 } = opts;
  const s = { ...DEFAULT_SETTINGS, ...book.settings };
  const perParcel = s.parcelOn && !logisticsPaise ? s.parcelPaise : 0;
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  // An RTO is often never paid and carries no payment date — its order date places it instead.
  const lines = book.payments.filter((p) => (!market || p.market === market) && inRange(p.paymentDate || p.orderDate));

  /**
   * Which lines are a FOLLOW-UP — the same order, paid in an earlier payout. Worked out over the
   * whole book, not the range, because the earlier line may sit in last month. A follow-up is not
   * a second parcel; and a delivered order that turns into a return gives its kit back (it comes
   * back usable — Vansh's ₹10 return loss is what it costs), so its pocket cost is credited back.
   */
  const earlier = new Map<Payment, Payment>();
  const byOrder = new Map<string, Payment[]>();
  for (const p of book.payments) {
    const k = `${p.market}|${p.subOrder}`;
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k)!.push(p);
  }
  for (const ps of byOrder.values()) {
    ps.sort((a, b) => (a.paymentDate || a.orderDate).localeCompare(b.paymentDate || b.orderDate));
    ps.forEach((p, i) => i > 0 && earlier.set(p, ps[i - 1]));
  }

  const uncosted = new Set<string>();
  const add = (f: Figures, p: Payment) => {
    const before = earlier.get(p);
    f.counts[p.kind]++;
    f.paidPaise += p.settledPaise;
    const kit = () => {
      const c = costOf(p.sku);
      if (c === null) uncosted.add(p.sku);
      return c ?? 0;
    };
    if (p.kind === "delivered" && !before) f.pocketPaise += kit();
    if (p.kind !== "delivered" && before?.kind === "delivered") f.pocketPaise -= kit();
    f.lossesPaise += (p.kind === "rto" ? s.rtoLossPaise : p.kind === "return" ? s.returnLossPaise : 0) + (before ? 0 : perParcel);
    f.profitPaise = f.paidPaise - f.pocketPaise - f.lossesPaise;
  };

  const total = zero();
  const skus = new Map<string, Figures>();
  const ad = zero();
  const organic = zero();
  for (const p of lines) {
    add(total, p);
    if (!skus.has(p.sku)) skus.set(p.sku, zero());
    add(skus.get(p.sku)!, p);
    add(p.adOrder ? ad : organic, p);
  }

  const others = book.other.filter((o) => (!market || o.market === market) && inRange(o.date));
  const adLines = others.filter((o) => o.kind === "ads");
  const byCampaign = new Map<string, { market: Market; campaign: string; paise: number }>();
  for (const o of adLines) {
    const k = `${o.market}|${o.note}`;
    if (!byCampaign.has(k)) byCampaign.set(k, { market: o.market, campaign: o.note, paise: 0 });
    byCampaign.get(k)!.paise += o.paise;
  }
  const adsPaise = adLines.reduce((n, o) => n + o.paise, 0);
  const otherPaise = others.filter((o) => o.kind !== "ads").reduce((n, o) => n + o.paise, 0);

  // GST on what was actually sold: delivered only — a return's credit note cancels it, an RTO was
  // never a sale. Credits are every line's, returns included: their fees carried GST too.
  const outputPaise = lines
    .filter((p) => p.kind === "delivered")
    .reduce((n, p) => n + Math.round((p.salePaise * p.gstRate) / (100 + p.gstRate)), 0);
  const creditPaise = lines.reduce((n, p) => n + p.creditPaise, 0);
  const payablePaise = outputPaise - creditPaise;
  const netPaise = total.profitPaise + adsPaise + otherPaise - logisticsPaise;

  const handled = (f: Figures) => f.counts.delivered + f.counts.rto + f.counts.return + f.counts.other;
  return {
    range: { from, to },
    total,
    bySku: [...skus]
      .map(([sku, f]) => ({
        sku,
        ...f,
        rtoPercent: handled(f) ? Math.round((f.counts.rto / handled(f)) * 100) : 0,
        perOrderPaise: handled(f) ? Math.round(f.profitPaise / handled(f)) : 0,
        uncosted: uncosted.has(sku),
      }))
      .sort((a, b) => b.profitPaise - a.profitPaise),
    ads: { totalPaise: adsPaise, byCampaign: [...byCampaign.values()].sort((a, b) => a.paise - b.paise) },
    otherPaise,
    logisticsPaise,
    netPaise,
    gst: { outputPaise, creditPaise, payablePaise, tdsPaise: lines.reduce((n, p) => n + p.tdsPaise, 0) },
    afterGstPaise: netPaise - Math.max(0, payablePaise),
    adEffect: ad.counts.delivered + ad.counts.rto + ad.counts.return > 0
      ? { ad: { ...ad, profitPaise: ad.profitPaise + adsPaise }, organic, adsPaise }
      : null,
    uncosted: [...uncosted].sort(),
  };
}

/**
 * Payment against order — Vansh: *"to see what and how many orders' settlement has been done
 * properly."* Per month of ORDER date: how many orders the files have settled, as what, and — from
 * the packing ledger — how many packed parcels no payment file has mentioned yet, with the oldest.
 */
export function paymentVsOrder(
  book: PaymentBook,
  packed: { subOrder: string; sku: string; packedOn: string; market: string }[],
  /**
   * The screen's range, applied to the day an order was PLACED (and a parcel packed) — Vansh: *"day
   * range should work on all of these fields"*. The other tables read it as a payment date.
   */
  { from = "", to = "" }: { from?: string; to?: string } = {},
) {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const seen = new Set(book.payments.map((p) => `${p.market}|${p.subOrder}`));
  const months = new Map<string, Counts & { waiting: number; oldestWaiting: string }>();
  const month = (m: string) => {
    if (!months.has(m)) months.set(m, { delivered: 0, rto: 0, return: 0, other: 0, waiting: 0, oldestWaiting: "" });
    return months.get(m)!;
  };
  // One order can have two lines (paid, then taken back). It is counted once, as its latest word.
  const latest = new Map<string, Payment>();
  for (const p of book.payments) {
    const k = `${p.market}|${p.subOrder}`;
    const was = latest.get(k);
    if (!was || p.paymentDate >= was.paymentDate) latest.set(k, p);
  }
  for (const p of latest.values()) if (inRange(p.orderDate)) month(p.orderDate.slice(0, 7))[p.kind]++;
  for (const p of packed) {
    if (!inRange(p.packedOn)) continue;
    if (seen.has(`${p.market || "meesho"}|${p.subOrder}`)) continue;
    const m = month(p.packedOn.slice(0, 7));
    m.waiting++;
    if (!m.oldestWaiting || p.packedOn < m.oldestWaiting) m.oldestWaiting = p.packedOn;
  }
  return [...months].map(([m, c]) => ({ month: m, ...c })).sort((a, b) => b.month.localeCompare(a.month));
}

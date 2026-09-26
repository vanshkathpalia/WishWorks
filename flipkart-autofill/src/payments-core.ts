/**
 * payments-core.ts — what the marketplaces actually paid, read off their own payment files.
 *
 * Vansh, 2026-09-26: *"is there any system that reads the payment and tells me what we actually
 * earn — return giving 0, RTO 0 income, only delivered… meesho and flipkart provide a pdf or excel
 * for payments, let's use that."* The Money screen estimates from kit prices and waits 20 days
 * (`SETTLE_DAYS`); this is the other half — the figure the marketplace itself wrote down.
 *
 * **Meesho's column is the answer, not ours.** Its payment file carries a *Final Settlement Amount*
 * per sub-order, after commission, shipping, return charges, TCS and TDS. An RTO settles at 0 and a
 * customer return carries its return charge as a minus, so summing that one column IS "only
 * delivered earns, returns cost". Nothing here re-derives a fee.
 *
 * The file is an XLSX, read with `zipEntries` and a few regexes — no spreadsheet library, for the
 * same reason the manifest has no PDF library: one known table does not need a general parser.
 *
 * ponytail: Meesho only. Flipkart's *Settled Transactions* report gets its own reader once a real
 * file has been seen — guessing its columns would be guessing about money.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { ORDERS_DIR, zipEntries } from "./orders-core.js";

/** One sub-order as the payment file reports it. Money in paise. */
export interface Payment {
  market: "meesho" | "flipkart";
  subOrder: string;
  sku: string;
  /** `YYYY-MM-DD`. */
  orderDate: string;
  /** The marketplace's own words — `Delivered`, `RTO`, `Return`… — kept as written. */
  status: string;
  /** `YYYY-MM-DD`, or "" when the file does not say. A date after today is money still to come. */
  paymentDate: string;
  /** What the buyer paid, incl. shipping and GST. */
  salePaise: number;
  /** What reaches the bank for this sub-order. The number everything here adds up. */
  settledPaise: number;
}

/** A line that is not an order: an ad deduction, a compensation, a recovery. Signed. */
export interface OtherLine {
  market: "meesho" | "flipkart";
  kind: "ads" | "compensation";
  date: string;
  paise: number;
  note: string;
}

export interface PaymentBook {
  payments: Payment[];
  other: OtherLine[];
  /** Files read in, by name. For the record — re-reading one changes nothing. */
  files: string[];
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

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

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
      rows.push(Array.from(row, (x) => x ?? ""));
    }
    out.set(unxml(m[1]), rows);
  }
  return out;
}

const paise = (s: string | undefined) => Math.round(Number(s || 0) * 100);

/** A table on a sheet: the row holding `key` is the header, and each later row becomes a record. */
function table(rows: string[][] | undefined, key: string): Record<string, string>[] {
  const at = rows?.findIndex((r) => r.includes(key)) ?? -1;
  if (!rows || at === -1) return [];
  const head = rows[at];
  return rows.slice(at + 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * Meesho's payment file — *Payments → Previous payments* or *Upcoming payments*, both the same
 * layout. Order rows are the ones whose first cell is a sub-order number (`315118640940072128_1`);
 * the line of formulas under the header and any "No data" line are skipped by that alone.
 */
export function readMeeshoPayments(bytes: Buffer): { payments: Payment[]; other: OtherLine[] } {
  const all = sheets(bytes);
  const payments = table(all.get("Order Payments"), "Sub Order No")
    .filter((r) => /^\d+_\d+$/.test(r["Sub Order No"]))
    .map((r) => ({
      market: "meesho" as const,
      subOrder: r["Sub Order No"],
      sku: r["Supplier SKU"],
      orderDate: r["Order Date"].slice(0, 10),
      status: r["Live Order Status"],
      paymentDate: /^\d{4}-\d{2}-\d{2}/.test(r["Payment Date"]) ? r["Payment Date"].slice(0, 10) : "",
      salePaise: paise(r["Total Sale Amount (Incl. Shipping & GST)"]),
      settledPaise: paise(r["Final Settlement Amount"]),
    }));
  // Ads are money OUT and not inside any order's settlement, so they are a line of their own.
  const ads = table(all.get("Ads Cost"), "Total Ads Cost")
    .filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r["Deduction Date"]))
    .map((r) => ({
      market: "meesho" as const, kind: "ads" as const, date: r["Deduction Date"].slice(0, 10),
      paise: -Math.abs(paise(r["Total Ads Cost"])), note: `campaign ${r["Campaign ID"]}`,
    }));
  const comp = table(all.get("Compensation and Recovery"), "Amount (inc GST) INR")
    .filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r["Date"]))
    .map((r) => ({
      market: "meesho" as const, kind: "compensation" as const, date: r["Date"].slice(0, 10),
      paise: paise(r["Amount (inc GST) INR"]), note: [r["Program Name"], r["Reason"]].filter(Boolean).join(" — "),
    }));
  return { payments, other: [...ads, ...comp] };
}

/**
 * Fold a file into the book. **The newer file wins per sub-order**: an order first seen in
 * *Upcoming* comes back in *Previous* with its real date and amount, and an order can turn from
 * Delivered into Return between two files. Other lines are kept once each.
 */
export function mergePayments(book: PaymentBook, read: { payments: Payment[]; other: OtherLine[] }, file: string): PaymentBook {
  const by = new Map(book.payments.map((p) => [`${p.market}|${p.subOrder}`, p]));
  for (const p of read.payments) by.set(`${p.market}|${p.subOrder}`, p);
  const key = (o: OtherLine) => `${o.market}|${o.kind}|${o.date}|${o.paise}|${o.note}`;
  const other = new Map(book.other.map((o) => [key(o), o]));
  for (const o of read.other) other.set(key(o), o);
  return {
    payments: [...by.values()],
    other: [...other.values()],
    files: book.files.includes(file) ? book.files : [...book.files, file],
  };
}

/** Delivered, RTO, customer return, or anything else — the marketplace's word, put in a bucket. */
export function kindOf(status: string): "delivered" | "rto" | "return" | "other" {
  const s = status.toLowerCase();
  if (s.includes("rto")) return "rto";
  if (s.includes("return")) return "return";
  if (s.includes("deliver")) return "delivered";
  return "other";
}

type Bucket = { orders: number; settledPaise: number };

/**
 * What the book adds up to. **Received** is paid on or before `today`; **to come** is dated later,
 * which only an *Upcoming payments* file contains. Materials are costed for DELIVERED orders only —
 * an RTO comes back unopened and goes back on the shelf.
 *
 * ponytail: a customer return's kit is counted as not lost. If returns come back unusable, count
 * them in `materialsPaise` too.
 */
export function paymentSummary(
  book: PaymentBook,
  today: string,
  costOf: (sku: string) => number | null = () => null,
) {
  const markets = [...new Set(book.payments.map((p) => p.market))];
  return markets.map((market) => {
    const ps = book.payments.filter((p) => p.market === market);
    const by: Record<"delivered" | "rto" | "return" | "other", Bucket> = {
      delivered: { orders: 0, settledPaise: 0 }, rto: { orders: 0, settledPaise: 0 },
      return: { orders: 0, settledPaise: 0 }, other: { orders: 0, settledPaise: 0 },
    };
    let receivedPaise = 0;
    let toComePaise = 0;
    let materialsPaise = 0;
    const uncosted = new Set<string>();
    for (const p of ps) {
      const k = kindOf(p.status);
      by[k].orders++;
      by[k].settledPaise += p.settledPaise;
      if (p.paymentDate && p.paymentDate <= today) receivedPaise += p.settledPaise;
      else toComePaise += p.settledPaise;
      if (k === "delivered") {
        const c = costOf(p.sku);
        if (c === null) uncosted.add(p.sku);
        else materialsPaise += c;
      }
    }
    const lines = book.other.filter((o) => o.market === market);
    const adsPaise = lines.filter((o) => o.kind === "ads").reduce((n, o) => n + o.paise, 0);
    const compensationPaise = lines.filter((o) => o.kind === "compensation").reduce((n, o) => n + o.paise, 0);
    return {
      market,
      from: ps.map((p) => p.orderDate).sort()[0] ?? "",
      to: ps.map((p) => p.orderDate).sort().at(-1) ?? "",
      by,
      receivedPaise,
      toComePaise,
      adsPaise,
      compensationPaise,
      materialsPaise,
      /** SKUs with delivered orders and no costed kit — their materials are missing from the total. */
      uncosted: [...uncosted].sort(),
      /** Received + to come + compensation − ads − materials. Ads are already negative. */
      earnedPaise: receivedPaise + toComePaise + compensationPaise + adsPaise - materialsPaise,
    };
  });
}

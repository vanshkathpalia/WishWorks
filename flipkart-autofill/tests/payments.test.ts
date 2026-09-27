/**
 * payments.test.ts — both marketplaces' payment files read into what was actually paid and earned.
 *
 * Fixtures are real files: Meesho *Previous payments* 25 Jul – 24 Aug 2026 (10 delivered, 1 RTO)
 * and a Flipkart *Settled Transactions* 28 Aug – 27 Sep 2026 (14 sales, 2 returns). The totals were
 * checked by hand against each file's own settlement column, and Flipkart's against its summary sheet.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dayOf, kindOf, mergePayments, paymentVsOrder, readPaymentFile, settledOnly, summarise, unknownTab, upcoming, type Payment, type PaymentBook } from "../src/payments-core.js";

const fixture = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f));
const empty = (): PaymentBook => ({ payments: [], other: [], files: [] });
const meesho = readPaymentFile(fixture("meesho-payments.xlsx"));
const flipkart = readPaymentFile(fixture("flipkart-payments.xlsx"));

describe("reading payment files", () => {
  it("reads Meesho's sub-orders with status, settlement and the GST pieces", () => {
    expect(meesho.market).toBe("meesho");
    expect(meesho.payments).toHaveLength(11);
    expect(meesho.payments[0]).toMatchObject({
      subOrder: "315118640940072128_1", sku: "SVP033", kind: "rto", paymentDate: "2026-08-12", salePaise: 20500, settledPaise: 0,
    });
    // ₹200 sale, ₹56.19 shipping kept by Meesho (18% GST inside: ₹8.57), TCS ₹0.95, TDS ₹0.19.
    expect(meesho.payments[1]).toMatchObject({ settledPaise: 14267, creditPaise: 857 + 95, tdsPaise: 19, txn: "AXISCN1437120821" });
  });

  it("reads Flipkart's order items, returns and stated credits", () => {
    expect(flipkart.market).toBe("flipkart");
    expect(flipkart.payments.filter((p) => p.kind === "delivered")).toHaveLength(14);
    expect(flipkart.payments.filter((p) => p.kind === "return")).toHaveLength(2);
    // Flipkart's summary sheet: ₹1,370.177 for orders. Rounded per line to whole paise.
    expect(flipkart.payments.reduce((n, p) => n + p.settledPaise, 0)).toBe(137016);
    // ANP017's customer return: ₹176 refunded and ₹170 reverse shipping, with ₹31.50 GST back.
    expect(flipkart.payments.find((p) => p.subOrder === "438555243086801100")).toMatchObject({
      sku: "ANP017", kind: "return", settledPaise: -20650, creditPaise: 3150,
    });
  });

  it("reads a tab it has never seen — a boost charge is ad spend, not left out", () => {
    const boost = [["Boost"], ["Boost Date", "Listing", "Boost Amount"], ["2026-09-20", "ANP001", "100"], ["2026-09-21", "ANP001", "100"]];
    expect(unknownTab("meesho", "Boost Charges", boost)).toEqual({
      lines: [
        { market: "meesho", kind: "ads", date: "2026-09-20", paise: -10000, note: "Boost Charges" },
        { market: "meesho", kind: "ads", date: "2026-09-21", paise: -10000, note: "Boost Charges" },
      ],
      unread: false,
    });
    // Numbers but no date/amount columns: reported, never quietly dropped.
    expect(unknownTab("meesho", "Mystery", [["x"], ["Id", "Units"], ["1", "5"]]).unread).toBe(true);
    // Meesho's "No data is available" tabs are not an alarm.
    expect(unknownTab("meesho", "Empty", [["Ads Cost"], ["Deduction Date", "Total Ads Cost"], ["No data is available for these dates."]]).unread).toBe(false);
    expect(meesho.unread).toEqual([]);
    expect(flipkart.unread).toEqual([]);
  });

  it("buckets the marketplaces' words, and reads Excel's number dates", () => {
    expect(["Delivered", "RTO", "Customer Return", "Courier Return", "NA", "Shipped"].map(kindOf))
      .toEqual(["delivered", "rto", "return", "rto", "delivered", "other"]);
    expect(dayOf("46235.79")).toBe("2026-08-01");
  });
});

describe("adding it up", () => {
  const book = mergePayments(mergePayments(empty(), meesho, "m.xlsx"), flipkart, "f.xlsx");

  it("re-reading a file changes nothing", () => {
    expect(mergePayments(book, meesho, "m.xlsx")).toEqual(book);
  });

  it("keeps a later take-back as its own line, so paid-then-returned nets out", () => {
    const paid = meesho.payments[1];
    const back: Payment = { ...paid, kind: "return", status: "Return", paymentDate: "2026-09-10", txn: "AXISCN9", settledPaise: -6069 };
    const b = mergePayments(mergePayments(empty(), { payments: [paid], other: [] }, "a"), { payments: [back], other: [] }, "b");
    expect(b.payments).toHaveLength(2);
    const t = summarise(b, { costOf: () => 8000 }).total;
    expect(t.paidPaise).toBe(14267 - 6069);
    // One parcel, not two; the kit came back, so no pocket cost; the ₹10 return loss applies.
    expect(t.pocketPaise).toBe(0);
    expect(t.lossesPaise).toBe(300 + 1000);
    // Seen from August alone, it was a delivered sale with its kit used.
    expect(summarise(b, { to: "2026-08-31", costOf: () => 8000 }).total.pocketPaise).toBe(8000);
  });

  it("pays in delivered, 0 for RTO, minus for returns; costs and losses come off", () => {
    const s = summarise(book, { market: "meesho", costOf: (sku) => (sku === "SVP033" ? 7700 : 8200) });
    expect(s.total.counts).toMatchObject({ delivered: 10, rto: 1 });
    expect(s.total.paidPaise).toBe(138557);
    // ₹5 RTO loss, and ₹3 parcel on each of the 11 parcels.
    expect(s.total.lossesPaise).toBe(500 + 11 * 300);
    expect(s.total.profitPaise).toBe(138557 - s.total.pocketPaise - 3800);
    expect(s.bySku.map((r) => r.sku)).toEqual(expect.arrayContaining(["SVP033", "ANP001", "ANP003"]));
    expect(s.uncosted).toEqual([]);
  });

  it("uses a typed logistics spend instead of the per-parcel figure", () => {
    const s = summarise(book, { market: "meesho", costOf: () => 0, logisticsPaise: 10000 });
    expect(s.total.lossesPaise).toBe(500); // the RTO loss only
    expect(s.netPaise).toBe(138557 - 500 - 10000);
  });

  it("an uncosted SKU is named, not counted as free", () => {
    const s = summarise(book, { market: "flipkart" });
    expect(s.uncosted.length).toBeGreaterThan(0);
    expect(s.total.pocketPaise).toBe(0);
  });

  it("filters by payment date", () => {
    expect(summarise(book, { from: "2026-09-01" }).total.counts.delivered).toBe(14); // Flipkart's only
    expect(summarise(book, { to: "2026-08-31" }).total.counts.delivered).toBe(10); // Meesho's only
  });

  it("estimates GST: output on delivered sales less the claimable credits", () => {
    const s = summarise(book, { market: "meesho" });
    expect(s.gst.outputPaise).toBe(8176);
    expect(s.gst.creditPaise).toBe(5719);
    expect(s.gst.payablePaise).toBe(8176 - 5719);
  });

  it("counts packed parcels no payment file has mentioned yet", () => {
    const rows = paymentVsOrder(book, [
      { subOrder: meesho.payments[1].subOrder, sku: "SVP033", packedOn: "2026-08-03", market: "meesho" },
      { subOrder: "999_1", sku: "ANP001", packedOn: "2026-09-20", market: "meesho" },
    ]);
    expect(rows.find((r) => r.month === "2026-09")).toMatchObject({ waiting: 1, oldestWaiting: "2026-09-20" });
    expect(rows.find((r) => r.month === "2026-07")?.waiting ?? 0).toBe(0);
  });

  it("limits payment against order to orders placed in the range", () => {
    const rows = paymentVsOrder(book, [], { from: "2026-08-01", to: "2026-08-31" });
    expect(rows.map((r) => r.month)).toEqual(["2026-08"]);
  });
});

describe("upcoming payments — Meesho's outstanding file", () => {
  const OUT = "4576865_SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_OUTSTANDING_PAYMENT_2026-09-28.xlsx";
  const PAID = "4576865_SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_PREVIOUS_PAYMENT_2026-09-25_2026-10-24.xlsx";
  const at = (o: Partial<Payment>): Payment => ({ ...meesho.payments[1], txn: "", subOrder: "A_1", ...o });
  const est = at({ status: "Delivered", kind: "delivered", settledPaise: 15000, paymentDate: "2026-09-30" });
  const shipped = at({ subOrder: "B_1", status: "Shipped", kind: "other", settledPaise: 16000, paymentDate: "2026-10-05" });
  const book = mergePayments(empty(), { payments: [est, shipped], other: [{ market: "meesho", kind: "ads", date: "2026-09-24", paise: -165, note: "1" }] }, OUT);

  it("keeps estimates apart: out of the settled book, counted only when asked", () => {
    expect(book.payments.every((p) => p.expected)).toBe(true);
    expect(settledOnly(book).payments).toHaveLength(0);
    expect(upcoming(book)).toMatchObject({ paise: 31000 - 165, orders: 2, shipped: 1, from: "2026-09-30", to: "2026-10-05" });
    expect(summarise(book).total.paidPaise).toBe(31000);
    expect(summarise(settledOnly(book)).total.paidPaise).toBe(0);
  });

  it("drops an estimate when its real payment arrives, including a shipped one that got delivered", () => {
    const real = [at({ txn: "AXISCN1", status: "Delivered", kind: "delivered", settledPaise: 14800 }),
      at({ subOrder: "B_1", txn: "AXISCN1", status: "Delivered", kind: "delivered", settledPaise: 15900 })];
    const after = mergePayments(book, { payments: real, other: [] }, PAID);
    expect(after.payments.map((p) => [p.subOrder, p.settledPaise, !!p.expected])).toEqual([["A_1", 14800, false], ["B_1", 15900, false]]);
  });

  it("lets a newer outstanding file replace the older estimates, and never re-adds a paid one", () => {
    const paidA = mergePayments(book, { payments: [at({ txn: "AXISCN1", kind: "delivered", status: "Delivered", settledPaise: 14800 })], other: [] }, PAID);
    const next = mergePayments(paidA, { payments: [est, at({ subOrder: "C_1", kind: "delivered", status: "Delivered", settledPaise: 9000 })], other: [] }, OUT.replace("09-28", "10-05"));
    expect(next.payments.filter((p) => p.expected).map((p) => p.subOrder)).toEqual(["C_1"]);
    expect(next.payments.filter((p) => !p.expected).map((p) => p.subOrder)).toEqual(["A_1"]);
  });
});

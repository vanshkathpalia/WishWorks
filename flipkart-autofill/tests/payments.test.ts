/**
 * payments.test.ts — Meesho's payment file read into what was actually paid.
 *
 * The fixture is a real *Previous payments* file (25 Jul – 24 Aug 2026): 10 delivered and 1 RTO.
 * The totals below were worked out by hand from its *Final Settlement Amount* column.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { kindOf, mergePayments, paymentSummary, readMeeshoPayments } from "../src/payments-core.js";

const file = readFileSync(path.join(import.meta.dirname, "fixtures", "meesho-payments.xlsx"));

describe("readMeeshoPayments", () => {
  it("reads every sub-order with its status and settlement", () => {
    const { payments, other } = readMeeshoPayments(file);
    expect(payments).toHaveLength(11);
    expect(payments[0]).toMatchObject({
      subOrder: "315118640940072128_1", sku: "SVP033", status: "RTO", paymentDate: "2026-08-12", salePaise: 20500, settledPaise: 0,
    });
    expect(other).toEqual([]); // the ads and compensation tabs say "No data" in this file
  });

  it("adds up to what reached the bank: delivered pays, RTO pays nothing", () => {
    const book = mergePayments({ payments: [], other: [], files: [] }, readMeeshoPayments(file), "a.xlsx");
    const [m] = paymentSummary(book, "2026-09-26", (sku) => (sku === "SVP033" ? 5000 : null));
    expect(m.by.delivered).toEqual({ orders: 10, settledPaise: 138557 });
    expect(m.by.rto).toEqual({ orders: 1, settledPaise: 0 });
    expect(m.receivedPaise).toBe(138557);
    expect(m.toComePaise).toBe(0);
    // Reading the same file twice changes nothing.
    expect(mergePayments(book, readMeeshoPayments(file), "a.xlsx")).toEqual(book);
    expect(m.earnedPaise).toBe(138557 - m.materialsPaise);
  });

  it("puts the marketplace's words in the right bucket", () => {
    expect(["Delivered", "RTO", "RTO_COMPLETE", "Return", "Customer Return", "Shipped"].map(kindOf))
      .toEqual(["delivered", "rto", "rto", "return", "return", "other"]);
  });
});

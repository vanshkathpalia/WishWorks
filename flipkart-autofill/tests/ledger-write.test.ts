/**
 * ledger-write.test.ts — a month's ledger is never left half-written.
 *
 * 2026-09-26: two saves overlapped and `orders/2026-09.json` came back with a second copy's tail on
 * the end. The packing screen then read the month as empty. Its own file because `ORDERS_DIR` is
 * fixed at import, so the env has to be set before the engine loads.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "ww-ledger-"));
process.env.WW_ORDERS_DIR = dir;
const { writeLedger, listLedgers } = await import("../src/orders-core.js");

const ledger = (n: number) => ({
  month: "2026-09",
  sources: [],
  subOrders: Array.from({ length: n }, (_, i) => ({
    subOrder: String(i), awb: "", sku: "ANP1", qty: 1, courier: "Valmo", market: "meesho", firstSeen: "2026-09-26",
  })),
});

describe("writeLedger", () => {
  it("leaves a readable file when a long and a short save overlap", async () => {
    await Promise.all([writeLedger(ledger(500) as never), writeLedger(ledger(1) as never)]);
    const n = JSON.parse(readFileSync(path.join(dir, "2026-09.json"), "utf8")).subOrders.length;
    expect([1, 500]).toContain(n);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a damaged month rather than reading it as empty", async () => {
    writeFileSync(path.join(dir, "2026-09.json"), '{"month":"2026-09","subOrders":[]}\n}junk');
    await expect(listLedgers()).rejects.toThrow(/2026-09\.json is damaged/);
  });
});

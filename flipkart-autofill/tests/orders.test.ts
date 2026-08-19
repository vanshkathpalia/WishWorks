/**
 * orders.test.ts — the manifest reader replaces a list written out by hand, so the failure that
 * matters is a QUIET one: a SKU missed, or a quantity read low. Nothing on screen would show it.
 *
 * The fixture is a real Meesho Supplier Manifest (19 Aug 2026, 41 packets over 7 SKUs). It stays
 * in the repo because it is the only proof this reader works — a hand-written sample would be a
 * test of a PDF we wrote, not of the one Meesho sends.
 *
 *   1. Every picklist SKU is found, with its total — including `007 annaprashan ct`, whose name
 *      starts with digits and contains spaces.
 *   2. Nothing from the per-shipment pages leaks in as a SKU (they are four-cell rows too).
 *   3. The same manifest dropped twice does not double the day.
 *   4. Split packing divides the credit; that number is what a worker is paid on.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addSkuImage, imageForSku, mergeManifest, parseManifest, workerCredit } from "../src/orders-core.js";

const pdf = readFileSync(path.join(import.meta.dirname, "fixtures", "meesho-manifest.pdf"));

describe("parseManifest", () => {
  const parsed = parseManifest(pdf);

  it("reads the date off the manifest, so nobody types one", () => {
    expect(parsed.date).toBe("2026-08-19");
  });

  it("finds every picklist SKU with its total", () => {
    expect(Object.fromEntries(parsed.rows.map((r) => [r.sku, r.qty]))).toEqual({
      "007 annaprashan ct": 19,
      SVP033: 14,
      SVP025: 2,
      SVP027: 2,
      SVP051: 2,
      SVP043: 1,
      MKU0001: 1,
    });
  });

  it("keeps the shipment rows out — they are four cells with a number on the end too", () => {
    // A leaked shipment row would arrive as a serial number or a sub-order number.
    expect(parsed.rows.every((r) => !/^\d+$/.test(r.sku))).toBe(true);
    expect(parsed.rows).toHaveLength(7);
  });
});

describe("mergeManifest", () => {
  it("adds a second courier's manifest and keeps what is already packed", () => {
    const first = mergeManifest(null, parseManifest(pdf), "delhivery.pdf");
    first.rows.find((r) => r.sku === "SVP033")!.packedBy = ["Asha"];

    const both = mergeManifest(first, { date: null, rows: [{ sku: "SVP033", qty: 3 }, { sku: "NEW1", qty: 5 }] }, "shadowfax.pdf");
    expect(both.rows.find((r) => r.sku === "SVP033")).toEqual({ sku: "SVP033", qty: 17, packedBy: ["Asha"] });
    expect(both.rows.find((r) => r.sku === "NEW1")?.qty).toBe(5);
  });

  it("ignores a file already merged, so a second drop cannot double the day", () => {
    const once = mergeManifest(null, parseManifest(pdf), "manifest.pdf");
    const twice = mergeManifest(once, parseManifest(pdf), "manifest.pdf");
    expect(twice).toBe(once);
    expect(twice.rows.find((r) => r.sku === "SVP033")?.qty).toBe(14);
  });
});

describe("the pictures on a SKU", () => {
  /** A ready folder with one finished listing in it, the way `finish` leaves them. */
  function ready() {
    const dir = mkdtempSync(path.join(tmpdir(), "ww-ready-"));
    mkdirSync(path.join(dir, "ANP"));
    for (const n of [1, 2]) {
      writeFileSync(path.join(dir, "ANP", `ANP-9-annaprashan-decoration-kit-red-gold-${n}.jpg`), "x");
    }
    return dir;
  }

  it("finds a finished listing by its code, and tells the two slots apart", async () => {
    const dir = ready();
    expect(await imageForSku(dir, "ANP-9", 2)).toMatch(/-2\.jpg$/);
    expect(await imageForSku(dir, "ANP-9", 1)).toMatch(/-1\.jpg$/);
    expect(await imageForSku(dir, "SVP025", 2)).toBeNull();
  });

  it("files an added picture under the SKU's own code, and that one then wins", async () => {
    const dir = ready();
    const src = path.join(dir, "from-whatsapp.jpg");
    writeFileSync(src, "y");

    // A code in the SKU means a subfolder, so the shared drive stays readable to a person.
    const to = await addSkuImage(dir, "SVP025", 2, src);
    expect(path.relative(dir, to)).toBe(path.join("SVP", "SVP025-2.jpg"));
    expect(await imageForSku(dir, "SVP025", 2)).toBe(to);

    // The exact name beats the finished listing's long one — otherwise the packer is shown
    // whichever file the directory walk happened to reach first.
    const exact = await addSkuImage(dir, "ANP-9", 2, src);
    expect(await imageForSku(dir, "ANP-9", 2)).toBe(exact);

    // No code in the SKU is not a group called nothing — it stays in the root, where tidyReady
    // leaves that case too.
    const loose = await addSkuImage(dir, "007 annaprashan ct", 2, src);
    expect(path.relative(dir, loose)).toBe("007-annaprashan-ct-2.jpg");
    expect(await imageForSku(dir, "007 annaprashan ct", 2)).toBe(loose);
  });
});

describe("workerCredit", () => {
  it("splits a shared SKU evenly and leaves unpacked rows out", () => {
    const credit = workerCredit([
      { date: "2026-08-19", sources: [], rows: [
        { sku: "A", qty: 10, packedBy: ["Asha", "Ravi"] },
        { sku: "B", qty: 4, packedBy: ["Ravi"] },
        { sku: "C", qty: 9, packedBy: [] },
      ] },
      { date: "2026-08-20", sources: [], rows: [{ sku: "A", qty: 3, packedBy: ["Asha"] }] },
    ]);
    expect(credit).toEqual({ Asha: 8, Ravi: 9 });
  });
});

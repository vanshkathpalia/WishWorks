/**
 * kit-csv.test.ts — the spreadsheet is what a non-technical person reads, so the things pinned
 * here are the ones that would mislead someone who cannot check the JSON behind it:
 *
 *   1. A line that could not be costed is NAMED, and the block says the total is too low.
 *   2. Money is rupees with two decimals, so a column adds up in Excel.
 *   3. Commas inside a material name do not shift every column right.
 *   4. It is costed from today's price list, never from anything stored.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { kitToCsv, kitsToCsv } from "../src/kit-csv.js";
import { loadMaterials } from "../src/inventory-core.js";
import { loadPackaging } from "../src/packaging.js";

const CATS = path.join(import.meta.dirname, "..", "categories");
const opts = { materials: loadMaterials(CATS), packaging: loadPackaging(CATS) };

const kit = (over = {}) => ({
  sku: "HBD-Kitty01",
  image: null,
  lines: [
    { item: "DARK PINK BALLOONS", qty: 20 },
    { item: "ARCH TAPE", qty: 1 },
  ],
  overrides: {},
  marginPercent: 50,
  flatPaise: 6000,
  savedAt: "2026-08-08T06:45:35.165Z",
  ...over,
});

describe("a kit as a spreadsheet", () => {
  it("puts the totals on top and the materials under them", () => {
    const csv = kitToCsv(kit(), opts);
    expect(csv).toContain("HBD-Kitty01,21,19.50,39.00,79.50");
    expect(csv).toContain("Balloon,DARK PINK BALLOONS,20,20,0.80,16.00,Dark Pink Balloon,");
    expect(csv).toContain(",,21,,,19.50,TOTAL,");
  });

  it("names an uncosted line and says the total is short", () => {
    // The one thing a reader of this file cannot check for themselves.
    const csv = kitToCsv(kit({ lines: [{ item: "Fog Machine", qty: 1 }, { item: "ARCH TAPE", qty: 1 }] }), opts);
    expect(csv).toContain("NOT ON THE PRICE LIST");
    expect(csv).toMatch(/WARNING,"1 line\(s\) are not counted/);
  });

  it("writes money as a plain two-decimal number, so a column sums", () => {
    // Not "₹19.50" — Excel would read that as text and every total below it would be blank.
    expect(kitToCsv(kit(), opts)).not.toContain("₹");
    expect(kitToCsv(kit(), opts)).toMatch(/,19\.50,/);
  });

  it("quotes a name containing a comma instead of shifting the columns", () => {
    const csv = kitToCsv(kit({ lines: [{ item: "Animal Set, 5 pcs", qty: 1 }] }), opts);
    expect(csv).toContain('"Animal Set, 5 pcs"');
  });

  it("carries the delivery figures when they have been filled in, and omits the block when not", () => {
    expect(kitToCsv(kit(), opts)).not.toContain("Left after materials");
    const withPrices = kitToCsv(
      kit({ marketplaces: { meesho: { pricePaise: 29900, shippingPaise: 7700 } } }),
      opts,
    );
    expect(withPrices).toContain("Left after materials + delivery");
    // 299.00 listed - 19.50 materials - 77.00 delivery = 202.50
    expect(withPrices).toContain("meesho,299.00,77.00,26%,202.50");
  });

  it("leads with a BOM, so Excel on Windows does not mangle the names", () => {
    expect(kitsToCsv([kit()], opts).charCodeAt(0)).toBe(0xfeff);
  });

  it("puts a blank gap between kits rather than running them together", () => {
    const csv = kitsToCsv([kit(), kit({ sku: "SECOND" })], opts);
    expect(csv).toContain("\n\n\n");
    expect(csv).toContain("SECOND");
  });

  it("survives a kit with no lines at all", () => {
    expect(() => kitToCsv(kit({ lines: [] }), opts)).not.toThrow();
  });
});

describe("a parcel chosen by hand", () => {
  it("goes into the spreadsheet, so it declares the box that is actually posted", () => {
    // The whole risk: the panel shows one parcel and the CSV a different one, and the courier
    // weighs a third. The chosen size has to win in both places or none.
    const csv = kitToCsv(
      kit({ parcel: { lengthCm: 25, breadthCm: 18, heightCm: 6, grams: 420 } }),
      opts,
    );
    expect(csv).toContain("chosen by hand,25,18,6,420,540,540 g");
  });

  it("says standard box when nothing was chosen", () => {
    // The 8 x 10 inch bag, in cm — the CSV declares centimetres whatever the panel shows.
    expect(kitToCsv(kit(), opts)).toContain("standard box,20.32,17.78,3.81,250,275,275 g");
  });
});

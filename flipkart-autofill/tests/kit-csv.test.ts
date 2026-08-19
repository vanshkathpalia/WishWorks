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
    expect(withPrices).toContain("Left after materials");
    // No settlement typed, so the old estimate applies: 299.00 listed, less 77.00 delivery, less
    // the 5% GST inside the remaining 222.00 (10.57), less 19.50 materials.
    expect(withPrices).toContain("meesho,299.00,typed in,not filled in,10.57,77.00,26%,191.93");
  });

  it("prints the settlement and its rate, and never the estimate, once the settlement is typed", () => {
    // The sheet the partner reads must agree with the panel: 240.00 in the bank less 19.50 of
    // materials is 220.50 left, whatever the shop-window price says — and 240 + 12% + 77 = 345.80
    // is the price those three figures make. The GST column prints the AMOUNT that rate works out
    // to (28.80), not the rate: a rate is what we assumed, an amount is what was charged.
    const csv = kitToCsv(
      kit({ marketplaces: { meesho: { settlementPaise: 24000, shippingPaise: 7700, gstPercent: 12 } } }),
      opts,
    );
    expect(csv).toContain("meesho,345.80,settlement + GST + delivery,240.00,28.80,77.00,22%,220.50");
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

// "GTB Foil" prices correctly and is invisible in search. The sheet's words, the row that set the
// price, and the name a shopper types are three different strings — only the third goes in a
// listing, and PROMPT-product.md rule 8 uses this exact material as its example.
describe("the name to put in the listing", () => {
  it("prints the buyer's name beside the priced row, not instead of it", () => {
    const csv = kitToCsv(kit({ lines: [{ item: "GTB FOIL", qty: 1 }] }), opts);
    expect(csv).toContain("GTB Foil,Groom To Be Foil Banner");
  });

  it("repeats the material when the stock name is already the buyer's name", () => {
    const csv = kitToCsv(kit(), opts);
    expect(csv).toContain("Arch Tape,Arch Tape");
  });

  it("still carries the header, so the column is readable in Excel", () => {
    expect(kitToCsv(kit(), opts)).toContain("Priced as,Call it,Note");
  });
});

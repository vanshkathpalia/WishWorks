/**
 * flipkart-live.test.ts — the account as the truth: SKU matching, the latch-list sync and the three
 * photo roots. Cases are the real ones measured on 2026-09-18.
 */

import { describe, expect, it } from "vitest";
import { place, planMoves, skuKey, syncBook, toLive, type LiveListing } from "../src/flipkart-live.js";
import type { LatchBook } from "../src/latch-core.js";

const live = (sku: string, fsn: string, state = "ACTIVE"): LiveListing =>
  toLive({ sku_id: sku, product_id: fsn, internal_state: state, ssp: 220, mrp: 999, title: sku, fk_release_date: "2026-09-17 10:00:00" });

describe("skuKey", () => {
  it("joins the spellings one SKU has had", () => {
    expect(skuKey("ANP015")).toBe(skuKey("ANP15"));
    expect(skuKey("WKU001-ANP001")).toBe(skuKey("ANP001"));
    expect(skuKey("HBD-sonic01 - 8yr")).toBe(skuKey("HBD-sonic01 - 8 yr"));
    expect(skuKey("GTb11")).toBe(skuKey("GTB11"));
  });

  it("keeps different listings apart", () => {
    expect(skuKey("HBD005 - 1 year")).not.toBe(skuKey("HBD005"));
    expect(skuKey("HBD-sonic01 - 5yr")).not.toBe(skuKey("HBD-sonic01 - 8yr"));
  });
});

describe("toLive", () => {
  it("keeps prices in paise and builds the shopper URL", () => {
    const l = toLive({ sku_id: "WB008", product_id: "DECHZG28JBNERJQG", internal_state: "ACTIVE", ssp: 260, mrp: 929, url: "/x/p/itm1?pid=DEC" });
    expect(l).toMatchObject({ sku: "WB008", sellingPaise: 260_00, mrpPaise: 929_00, url: "https://www.flipkart.com/x/p/itm1?pid=DEC" });
  });
});

describe("syncBook", () => {
  const book: LatchBook = {
    packs: [],
    rows: [
      { sku: "FKUL414", description: "", seen: 1, fsn: "BCBHDDTJWYCZG7TS", title: "DECOR SPARKS", state: "form", checkedOn: null, latchedOn: "2026-09-17", ourSku: "HBD102" },
      { sku: "FKUP041", description: "", seen: 1, fsn: "BCBHP76SF3BZFGXB", title: "Partyfox", state: "form", checkedOn: null, latchedOn: "2026-09-17", ourSku: "HBD102" },
      { sku: "FKUP023", description: "", seen: 1, fsn: "DECHZEDRFNCCM7QE", title: "backdrop", state: "form", checkedOn: null, latchedOn: "2026-09-17" },
    ],
  };
  const { book: out, fixed, added } = syncBook(book, [live("HBD009", "BCBHDDTJWYCZG7TS"), live("HBD008", "BCBHP76SF3BZFGXB"), live("HBD002", "NEW1")], "2026-09-18");

  it("corrects the SKU the app suggested to the one Flipkart saved", () => {
    expect(fixed).toEqual([
      { fsn: "BCBHDDTJWYCZG7TS", was: "HBD102", now: "HBD009" },
      { fsn: "BCBHP76SF3BZFGXB", was: "HBD102", now: "HBD008" },
    ]);
    expect(out.rows[0]).toMatchObject({ ourSku: "HBD009", state: "selling" });
  });

  it("leaves a form that was never saved alone", () => {
    expect(out.rows[2]).toEqual(book.rows[2]);
  });

  it("adds a live listing the list never knew, under its own pack", () => {
    expect(added).toBe(1);
    expect(out.rows[3]).toMatchObject({ fsn: "NEW1", ourSku: "HBD002", latchedOn: "2026-09-17", state: "selling" });
    expect(out.packs).toEqual([{ file: "live on Flipkart", addedOn: "2026-09-18", skus: ["NEW1"] }]);
  });
});

describe("place and planMoves", () => {
  const placed = place(
    [
      { sku: "ANP004", meesho: true }, // live + Meesho → both
      { sku: "WKU001-ANP001", meesho: false }, // the kit of live ANP001
      { sku: "GTB003", meesho: true }, // not live → Meesho only
      { sku: "HBD100", meesho: false }, // priced nowhere
    ],
    [live("ANP004", "A"), live("ANP001", "B"), live("HBD008", "C"), live("GTB12", "D", "ARCHIVED")],
  );
  const where = Object.fromEntries(placed.map((p) => [p.sku, p.where]));

  it("sorts every SKU by where it sells", () => {
    expect(where).toEqual({ ANP001: "flipkart", ANP004: "both", GTB003: "meesho", HBD008: "flipkart", HBD100: "none" });
    expect(placed.find((p) => p.sku === "ANP001")).toMatchObject({ kitSku: "WKU001-ANP001", hasKit: true });
    expect(placed.filter((p) => p.live && !p.hasKit).map((p) => p.sku)).toEqual(["HBD008"]);
  });

  it("moves only folders that exist and sit in the wrong root", () => {
    const folders: Record<string, string> = {
      ANP004: "Whatsapp DW/ANP/ANP 4", // right already
      "WKU001-ANP001": "Whatsapp DW/ANP/ANP 1", // found by the kit's name
      GTB003: "Whatsapp DW/GTB/GTB 3 done",
      HBD100: "Whatsapp DW/HBD/HBD100", // priced nowhere: stays
    };
    expect(planMoves(placed, (s) => folders[s] ?? null)).toEqual([
      { sku: "ANP001", from: "Whatsapp DW/ANP/ANP 1", to: "Flipkart only/ANP/ANP 1" },
      { sku: "GTB003", from: "Whatsapp DW/GTB/GTB 3 done", to: "Meesho only/GTB/GTB 3 done" },
    ]);
  });
});

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
import {
  addSkuImage, creditSku, daySummary, imageForSku, mergeManifest, mergeShipments, outstanding,
  clearBack, type KitMoney, kitForSku, leftToPack, markBack, money, packSku, packerPay, parcelCredit,
  parseManifest, unpackSku, workerCredit,
} from "../src/orders-core.js";

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

  /**
   * The per-parcel pages, which are what makes re-downloading a manifest safe: the same parcel
   * carries the same sub-order number every time, so counting ids can never double a day.
   *
   * **The two halves of the file check each other.** The picklist is Meesho's own total per SKU
   * and the shipment pages are the subOrders behind it; if either parser drifts they stop agreeing,
   * and that is a far better alarm than any number this repo could hard-code.
   */
  it("reads every parcel, with an id of its own, and agrees with the picklist", () => {
    expect(parsed.shipments).toHaveLength(41);
    expect(new Set(parsed.shipments.map((s) => s.subOrder)).size).toBe(41);

    const bySku: Record<string, number> = {};
    for (const s of parsed.shipments) bySku[s.sku] = (bySku[s.sku] ?? 0) + s.qty;
    expect(bySku).toEqual(Object.fromEntries(parsed.rows.map((r) => [r.sku, r.qty])));

    // The id spans two baselines in the PDF — both halves, or two items of one order collide.
    expect(parsed.shipments[0]).toEqual({
      subOrder: "321165013526408960_1",
      awb: "1490839976524846",
      sku: "007 annaprashan ct",
      qty: 1,
      courier: "Delhivery",
    });
    // Handover is per courier, so which one is carrying it is worth keeping.
    expect(new Set(parsed.shipments.map((s) => s.courier)))
      .toEqual(new Set(["Delhivery", "Shadowfax", "Valmo", "Xpress Bees"]));
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

/**
 * The arithmetic the whole rewrite exists for. Two situations that are IDENTICAL at SKU level and
 * need opposite answers:
 *
 *   the 12pm manifest says 6, the 2pm one says 10  → ten subOrders, not sixteen
 *   two couriers, one says 6 and one says 4        → ten subOrders, not six
 *
 * Counting sub-order ids answers both without a rule, which is the point.
 */
describe("the parcel ledger", () => {
  const parcel = (id: string, sku: string, courier = "Delhivery") =>
    ({ subOrder: id, awb: `A${id}`, sku, qty: 1, courier });

  it("re-reading a bigger manifest does not double the day", () => {
    const noon = mergeShipments(null, [parcel("1", "ANP006"), parcel("2", "ANP006")], "2026-08-20", "12pm.pdf");
    expect(outstanding(noon.subOrders)[0]).toMatchObject({ sku: "ANP006", qty: 2 });

    // The afternoon download is a snapshot of everything still to ship: the same two, plus one.
    const two = mergeShipments(noon, [parcel("1", "ANP006"), parcel("2", "ANP006"), parcel("3", "ANP006")], "2026-08-20", "2pm.pdf");
    expect(outstanding(two.subOrders)[0]).toMatchObject({ sku: "ANP006", qty: 3 });
  });

  it("a second courier's manifest adds, because those are different subOrders", () => {
    const first = mergeShipments(null, [parcel("1", "ANP006")], "2026-08-20", "delhivery.pdf");
    const both = mergeShipments(first, [parcel("9", "ANP006", "Valmo")], "2026-08-20", "valmo.pdf");
    expect(outstanding(both.subOrders)[0]).toMatchObject({ sku: "ANP006", qty: 2 });
  });

  it("packing takes a SKU to zero, and later orders come back as a new, smaller number", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"]);
    expect(outstanding(l.subOrders)).toEqual([]);

    // Six more arrive the next day. The two already packed stay packed and are not re-counted.
    l = mergeShipments(l, [parcel("1", "ANP003"), parcel("2", "ANP003"), parcel("3", "ANP003")], "2026-08-21", "b.pdf");
    expect(outstanding(l.subOrders)).toEqual([{ sku: "ANP003", qty: 1, subOrders: [expect.objectContaining({ subOrder: "3" })] }]);
  });

  it("pays by the day it was PACKED, not the day it was ordered", () => {
    // Seen 31 Aug, packed 1 Sep — filed under August, paid in September.
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "ANP003")], "2026-08-31", "a.pdf");
    l = packSku(l, "ANP003", "2026-09-01", ["Asha", "Ravi"]);
    expect(l.month).toBe("2026-08");
    expect(parcelCredit([l], "2026-08")).toEqual({});
    expect(parcelCredit([l], "2026-09")).toEqual({ Asha: 1, Ravi: 1 });
  });

  it("counts a ticked parcel with nobody named, and pays nobody for it yet", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "GTB001")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20");
    const day = daySummary([l], "2026-08-20");
    expect(day).toMatchObject({ packets: 1, unnamed: 1, left: 1 });
    expect(parcelCredit([l], "2026-08")).toEqual({});

    // The names arrive later and the day is right without anything being packed again.
    l = creditSku(l, "ANP003", "2026-08-20", ["Asha"]);
    expect(daySummary([l], "2026-08-20").unnamed).toBe(0);
    expect(parcelCredit([l], "2026-08")).toEqual({ Asha: 1 });
  });

  it("packs part of a SKU and leaves the rest in the queue", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "ANP003"), parcel("3", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"], 2);
    expect(leftToPack(l, "ANP003")).toBe(1);
    expect(outstanding(l.subOrders)[0].qty).toBe(1);
    expect(parcelCredit([l], "2026-08")).toEqual({ Asha: 2 });

    // The rest, after lunch, by somebody else — and the morning stays Asha's.
    l = packSku(l, "ANP003", "2026-08-20", ["Ravi"]);
    expect(outstanding(l.subOrders)).toEqual([]);
    expect(parcelCredit([l], "2026-08")).toEqual({ Asha: 2, Ravi: 1 });
  });

  it("naming one batch does not move another batch's work onto it", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20", [], 1);   // ticked, nobody named
    l = creditSku(l, "ANP003", "2026-08-20", ["Asha"], []);
    l = packSku(l, "ANP003", "2026-08-20", [], 1);   // the afternoon's, also unnamed
    l = creditSku(l, "ANP003", "2026-08-20", ["Ravi"], []);
    expect(parcelCredit([l], "2026-08")).toEqual({ Asha: 1, Ravi: 1 });

    // And a name can still be changed within its own batch.
    l = creditSku(l, "ANP003", "2026-08-20", ["Asha", "Ravi"], ["Ravi"]);
    expect(parcelCredit([l], "2026-08")).toEqual({ Asha: 1.5, Ravi: 0.5 });
  });

  it("offers back the SKUs packed today that nobody is named on", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "GTB001")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20");
    l = packSku(l, "GTB001", "2026-08-20", ["Asha"]);
    expect(daySummary([l], "2026-08-20").unnamedBySku).toEqual([{ name: "ANP003", qty: 1 }]);
  });

  it("un-ticking gives back only what that tick took", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-19", ["Ravi"]);   // yesterday's tick, on one of them
    l = { ...l, subOrders: [l.subOrders[0], { ...l.subOrders[1], packedOn: undefined, packedBy: undefined }] };
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"]);
    l = unpackSku(l, "ANP003", "2026-08-20");
    expect(outstanding(l.subOrders)[0].qty).toBe(1);
    expect(l.subOrders[0].packedOn).toBe("2026-08-19"); // yesterday's is untouched
  });

  it("reads a real manifest straight into a ledger", () => {
    const m = parseManifest(pdf);
    const l = mergeShipments(null, m.shipments, m.date!, "manifest.pdf");
    expect(l.month).toBe("2026-08");
    expect(l.subOrders).toHaveLength(41);
    // Same totals the picklist gives, arrived at by counting subOrders.
    expect(Object.fromEntries(outstanding(l.subOrders).map((o) => [o.sku, o.qty])))
      .toEqual(Object.fromEntries(m.rows.map((r) => [r.sku, r.qty])));
    // And dropping it again changes nothing at all.
    expect(mergeShipments(l, m.shipments, m.date!, "again.pdf").subOrders).toHaveLength(41);
  });
});

/**
 * The money. Three separate facts and never one number: what was packed, what it cost, and what
 * came back. A SKU nobody has costed contributes an UNKNOWN, not a zero — folding those into the
 * profit would be confidently wrong on exactly the days the partner's SKUs sell well.
 */
describe("what a day was worth", () => {
  const kits: KitMoney[] = [
    // A combo kit: the code that matters is the last one, so this is the ANP001 listing.
    { sku: "WKU001-ANP001", costPaise: 9000, pays: { meesho: 18000, flipkart: 19000 } },
    { sku: "SVP033 - ANP002", costPaise: 7000, pays: { meesho: 15000 } },
  ];
  const parcel = (id: string, sku: string, market = "meesho") =>
    ({ subOrder: id, awb: `A${id}`, sku, qty: 1, courier: "Valmo", market });

  function packed() {
    let l = mergeShipments(null, [parcel("1", "ANP001"), parcel("2", "SVP033"), parcel("3", "007 annaprashan ct")], "2026-08-20", "a.pdf");
    return packSku(packSku(packSku(l, "ANP001", "2026-08-20", ["Asha"]), "SVP033", "2026-08-20", ["Asha", "Ravi"]), "007 annaprashan ct", "2026-08-20", ["Ravi"]);
  }

  it("matches a manifest SKU to its kit, including a combo's second code", () => {
    expect(kitForSku("ANP001", kits)?.sku).toBe("WKU001-ANP001");
    expect(kitForSku("SVP033", kits)?.sku).toBe("SVP033 - ANP002");
    // No code in the name at all, so nothing to match on — and no kit is not a free product.
    expect(kitForSku("007 annaprashan ct", kits)).toBeNull();
  });

  it("counts what is costed and NAMES what is not, rather than treating it as free", () => {
    const m = money([packed()], kits, "2026-08-20", "2026-08-20");
    expect(m.packets).toBe(3);
    expect(m.revenuePaise).toBe(18000 + 15000);
    expect(m.materialsPaise).toBe(9000 + 7000);
    expect(m.profitPaise).toBe(33000 - 16000);
    expect(m.uncosted).toEqual([{ name: "007 annaprashan ct", qty: 1 }]);
  });

  it("dates a return to the day it came back, and never rewrites the packing day", () => {
    let l = packed();
    l = markBack(l, "1", "rto", "2026-09-03");

    // The day it was packed still reads exactly as it did before anything came back.
    const day = money([l], kits, "2026-08-20", "2026-08-20");
    expect(day.revenuePaise).toBe(33000);
    expect(day.reversals.packets).toBe(0);

    // September carries the reversal, on the day it happened.
    const later = money([l], kits, "2026-09-01", "2026-09-30");
    expect(later.packets).toBe(0);
    expect(later.reversals).toMatchObject({ packets: 1, revenuePaise: 18000, rto: 1, returned: 0 });
    expect(later.profitPaise).toBe(-18000);

    // And a wrongly marked one can be taken back off.
    expect(money([clearBack(l, "1")], kits, "2026-09-01", "2026-09-30").reversals.packets).toBe(0);
  });

  it("splits a shared packet for pay, and prices it at each person's rate", () => {
    const pay = packerPay([packed()], "2026-08-20", "2026-08-20", { Asha: 500, Ravi: 400 });
    expect(pay).toEqual([
      { name: "Asha", packets: 1.5, paise: 750 },
      { name: "Ravi", packets: 1.5, paise: 600 },
    ]);
    // A week that saw no packing is not an error, it is zero rows.
    expect(packerPay([packed()], "2026-09-01", "2026-09-07")).toEqual([]);
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

  /**
   * The one that was live-wrong: the manifest says `ANP001`, the file on the shared drive is
   * `ANP-1-annaprasan-decoration-kit-red-gold-balloons-banner-heart-2.jpg`, and the packing screen
   * said *no picture* for a listing that has had four images for weeks.
   */
  it("matches a padded SKU to the readable filename it belongs to, and not to its neighbour", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ww-ready-"));
    mkdirSync(path.join(dir, "ANP"));
    const one = path.join(dir, "ANP", "ANP-1-annaprasan-decoration-kit-red-gold-balloons-banner-heart-2.jpg");
    const ten = path.join(dir, "ANP", "ANP-10-annaprashan-decoration-kit-blue-silver-2.jpg");
    writeFileSync(one, "x");
    writeFileSync(ten, "x");

    expect(await imageForSku(dir, "ANP001", 2)).toBe(one);
    expect(await imageForSku(dir, "ANP010", 2)).toBe(ten);
    // Containment would have handed ANP001 whichever of the two came first off the disk.
    expect(await imageForSku(dir, "ANP002", 2)).toBeNull();
    // And a code the folder has never heard of is not quietly matched to a neighbour.
    expect(await imageForSku(dir, "SVP001", 2)).toBeNull();
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

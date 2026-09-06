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
  addSkuImage, adSpend, creditSku, daySummary, imageForSku, mergeManifest, mergeShipments, outstanding,
  clearBack, dropParcel, type Ledger, howItSells, idsInFile, type KitMaterials, type KitMoney, kitForSku, leftToPack, markBack, mergeOrdersCsv, money,
  packSku, packerPay, parcelCredit, parseManifest, readOrdersCsv, unpackSku, workerCredit,
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

  it("splits a SKU by marketplace, because the two are not interchangeable", () => {
    let l = mergeShipments(null, [parcel("1", "ANP006"), parcel("2", "ANP006")], "2026-08-20", "m.pdf");
    l = mergeShipments(l, [parcel("7", "ANP006")], "2026-08-20", "f.csv", "flipkart");
    expect(outstanding(l.subOrders)[0]).toMatchObject({
      sku: "ANP006",
      qty: 3,
      byMarket: [{ name: "meesho", qty: 2 }, { name: "flipkart", qty: 1 }],
    });
  });

  /**
   * The question it looks like this raises — *how do you reconcile a Meesho settlement against a
   * Flipkart one?* — has no answer because it has no conflict: a kit stores what EACH marketplace
   * pays, and every parcel records which one sold it.
   */
  it("prices each parcel by the marketplace that sold it", () => {
    const kits: KitMoney[] = [
      { sku: "ANP006", costPaise: 8000, pays: { meesho: 15000, flipkart: 17000 } },
    ];
    let l = mergeShipments(null, [parcel("1", "ANP006")], "2026-08-20", "m.pdf");
    l = mergeShipments(l, [parcel("7", "ANP006")], "2026-08-20", "f.csv", "flipkart");
    l = packSku(l, "ANP006", "2026-08-20", ["Asha"]);

    expect(money([l], kits, "2026-08-20", "2026-08-20").revenuePaise).toBe(32000);
    expect(money([l], kits, "2026-08-20", "2026-08-20", "meesho").revenuePaise).toBe(15000);
    expect(money([l], kits, "2026-08-20", "2026-08-20", "flipkart").revenuePaise).toBe(17000);
    // The working names the kit that priced each line, so a total can always be taken apart.
    expect(money([l], kits, "2026-08-20", "2026-08-20").costed[0]).toMatchObject({ name: "ANP006", kit: "ANP006", qty: 2 });
    // Pay follows the same filter, so one marketplace's packing can be paid on its own.
    expect(packerPay([l], "2026-08-20", "2026-08-20", {}, "flipkart")[0].packets).toBe(1);
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
    expect(outstanding(l.subOrders)).toEqual([
      {
        sku: "ANP003",
        qty: 1,
        byMarket: [{ name: "meesho", qty: 1 }],
        // The day it arrived on rides along, so the queue can say which parcels are the old ones.
        byDay: [{ date: "2026-08-21", qty: 1 }],
        oldest: "2026-08-21",
        subOrders: [expect.objectContaining({ subOrder: "3" })],
      },
    ]);
  });

  /**
   * The cancelled order. Vansh, 2026-08-31: *"it had nineteen orders, but later on one of those
   * orders got cancelled… I would like to erase that so that it does not change my inventory
   * subtraction."* Deleting has to reach the packed ones too — a cancellation can arrive after
   * somebody has already made the packet — and when it does, that day's money must move with it.
   */
  it("deletes one parcel and nothing else, packed or not", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003"), parcel("2", "ANP003")], "2026-08-20", "a.pdf");
    l = dropParcel(l, "1");
    expect(outstanding(l.subOrders)).toMatchObject([{ sku: "ANP003", qty: 1 }]);

    // A parcel already packed and counted: deleting it takes the packet out of the day as well.
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"]);
    expect(daySummary([l], "2026-08-20").packets).toBe(1);
    l = dropParcel(l, "2");
    expect(daySummary([l], "2026-08-20").packets).toBe(0);
    expect(l.subOrders).toEqual([]);

    // An id that is not here changes nothing — the caller sweeps every month's ledger with it.
    expect(dropParcel(l, "nope").subOrders).toEqual([]);
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

  /**
   * One code, two shops. Vansh: *"this data should show both Meesho and Flipkart at the same place
   * because we are using the same SKU numbers at both."* The marketplace switch answers by hiding
   * one of them, which is the wrong shape for a line about one product.
   */
  it("splits one SKU's row across the marketplaces it sold on, at each one's own price", () => {
    const kits: KitMoney[] = [{ sku: "ANP006", costPaise: 8000, pays: { meesho: 15000, flipkart: 17000 } }];
    let l = mergeShipments(null, [parcel("1", "ANP006"), parcel("2", "ANP006")], "2026-08-20", "m.pdf");
    l = mergeShipments(l, [parcel("7", "ANP006")], "2026-08-20", "f.csv", "flipkart");
    l = packSku(l, "ANP006", "2026-08-20", ["Asha"]);

    const [row] = money([l], kits, "2026-08-20", "2026-08-20").costed;
    expect(row.qty).toBe(3);
    expect(row.markets).toEqual([
      { name: "meesho", qty: 2, revenuePaise: 30000 },
      { name: "flipkart", qty: 1, revenuePaise: 17000 },
    ]);
    // The split adds up to the row, and the row to the total — three numbers, one fact.
    expect(row.markets.reduce((n, m) => n + m.revenuePaise, 0)).toBe(row.revenuePaise);
  });

  /**
   * The two accounts. Vansh, 2026-09-03: *"we will maintain two accounts — the stuff we have sent,
   * and the money we actually got. The later is the one that will have deducted for RTO and
   * return… this later will change after 20 days of the parcel being sent."*
   *
   * The trap this pins: **age is measured against TODAY, not against the end of the window.** If
   * it were measured against `to`, every window that is already in the past would read as fully
   * settled the moment it aged — which is the one answer nobody can ever check.
   */
  it("keeps what was sent apart from what is old enough to believe", () => {
    const kits: KitMoney[] = [{ sku: "ANP003", costPaise: 8000, pays: { meesho: 15000 } }];
    let l = mergeShipments(
      null,
      [parcel("1", "ANP003"), parcel("2", "ANP003"), parcel("3", "ANP003")],
      "2026-08-01",
      "a.pdf",
    );
    l = packSku(l, "ANP003", "2026-08-01", ["Asha"]);
    l = markBack(l, "3", "rto", "2026-08-14");

    // Asked on 25 August: 24 days after packing, so the two live ones are past the window.
    const late = money([l], kits, "2026-08-01", "2026-08-31", undefined, {}, "2026-08-25");
    expect(late.packets).toBe(3);
    expect(late.landed).toEqual({ packets: 2, revenuePaise: 30000 });
    expect(late.inFlight).toEqual({ packets: 0, revenuePaise: 0 });
    expect(late.cameBack).toEqual({ packets: 1, revenuePaise: 15000 });

    // The same window asked on the 10th — nine days in, nothing has cleared yet and the first
    // account has not changed at all. That gap between them is the whole point.
    const early = money([l], kits, "2026-08-01", "2026-08-31", undefined, {}, "2026-08-10");
    expect(early.revenuePaise).toBe(late.revenuePaise);
    expect(early.landed.packets).toBe(0);
    expect(early.inFlight).toEqual({ packets: 2, revenuePaise: 30000 });

    // Whatever the day, the three account for every packet exactly once.
    for (const m of [early, late]) {
      expect(m.landed.packets + m.inFlight.packets + m.cameBack.packets).toBe(m.packets);
    }
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

  /**
   * The state the Undo button could otherwise reach: packed, marked RTO, then un-ticked. The
   * parcel would sit in the queue to be made again while its reversal still came off the month —
   * never packed and returned at the same time.
   */
  it("refuses to un-tick a parcel that has already come back", () => {
    let l = mergeShipments(null, [parcel("1", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"]);
    l = markBack(l, "1", "rto", "2026-08-25");
    expect(unpackSku(l, "ANP003", "2026-08-20").subOrders[0].packedOn).toBe("2026-08-20");

    // Take the mark off and it un-ticks like anything else — two corrections, in order.
    l = clearBack(l, "1");
    expect(unpackSku(l, "ANP003", "2026-08-20").subOrders[0].packedOn).toBeUndefined();
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
 * How it sells. The three questions neither seller panel answers: what comes back cut by COURIER,
 * what has stopped selling, and what the packing is using up.
 *
 * The one that could quietly be wrong is the denominator. A return arrives weeks after the parcel
 * left, so "returns received this month / packed this month" mixes two populations and is not a
 * fact about any SKU or any courier. The rate here belongs to the parcels packed in the window.
 */
describe("how it sells", () => {
  const kits = [
    // Two packs of gold balloon, which is 100 PIECES — the distinction the shelf is netted in.
    { sku: "ANP003", costPaise: 8000, pays: { meesho: 15000 }, materials: [{ key: "Balloons|Gold balloon", name: "Gold balloon", packs: 2, pieces: 100 }] },
    // Costed but never packed — the slow-mover case, and it must not be confused with uncosted.
    { sku: "ZZZ001", costPaise: 5000, pays: { meesho: 9000 }, materials: [{ key: "Ribbon|Ribbon", name: "Ribbon", packs: 1, pieces: 1 }] },
  ];
  const parcel = (id: string, courier: string) =>
    ({ subOrder: id, awb: `A${id}`, sku: "ANP003", qty: 1, courier, market: "meesho" });

  /** Four packed on 20 Aug: two by Valmo (one comes back in September), two by Delhivery. */
  function shipped() {
    let l = mergeShipments(
      null,
      [parcel("1", "Valmo"), parcel("2", "Valmo"), parcel("3", "Delhivery"), parcel("4", "Delhivery")],
      "2026-08-20",
      "a.pdf",
    );
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"], Infinity, () => ({ paidPaise: 15000, materialsPaise: 8000 }));
    return markBack(l, "1", "rto", "2026-09-05");
  }

  it("blames the courier that shipped it, not the month the parcel came back in", () => {
    // September, when the RTO actually arrived: nothing was PACKED then, so no rate is claimed.
    expect(howItSells([shipped()], kits, "2026-09-01", "2026-09-30").byCourier).toEqual([]);

    // August, when it shipped, is where the rate belongs — and only Valmo carries it.
    const aug = howItSells([shipped()], kits, "2026-08-01", "2026-08-31").byCourier;
    expect(aug).toMatchObject([
      { name: "Valmo", packets: 2, rto: 1, backRate: 0.5, lostPaise: 15000 },
      { name: "Delhivery", packets: 2, rto: 0, backRate: 0 },
    ]);
  });

  it("names a costed kit nothing has sold, and knows when it last did", () => {
    const { slow } = howItSells([shipped()], kits, "2026-08-01", "2026-08-31");
    expect(slow).toEqual([{ sku: "ZZZ001", lastPacked: null }]);

    // ANP003 sold in August, so it is not slow there — but it is in September.
    expect(howItSells([shipped()], kits, "2026-09-01", "2026-09-30").slow.map((k) => k.sku))
      .toEqual(["ZZZ001", "ANP003"]);
    expect(howItSells([shipped()], kits, "2026-09-01", "2026-09-30").slow[1].lastPacked).toBe("2026-08-20");
  });

  /**
   * The bug this screen shipped with. Vansh: *"I think it is broken, blank screen when I clicked
   * on it."* His `orders/` held `rates.json` and no ledger, every cut came back empty, and the
   * panel had been gated on `bySku` — so the whole screen collapsed to one grey line and read as
   * broken. **"Nothing has sold" and "no manifest has ever been read" are different states** and
   * they need different sentences: with no ledger, all 26 costed kits are trivially slow movers,
   * which would have printed a page of nonsense instead.
   */
  it("tells an empty ledger from a quiet window, because they need different sentences", () => {
    const empty = howItSells([], kits, "2026-08-01", "2026-08-31");
    expect(empty.packedEver).toBe(0);
    expect(empty.bySku).toEqual([]);

    // Something HAS been packed — just not in this window. Same empty cuts, different state.
    const quiet = howItSells([shipped()], kits, "2026-01-01", "2026-01-31");
    expect(quiet.packedEver).toBe(4);
    expect(quiet.bySku).toEqual([]);
  });

  it("multiplies each kit's own lines by what was packed, so a reorder has a number", () => {
    // Four packets x two packs of gold balloon, over a 30-day window = 8 packs, ~1.9 a week.
    // The same packing in pieces is 400, which is the figure the shelf comes down by — a pack is
    // what gets BOUGHT and a piece is what gets USED, and they are not each other.
    const { burn } = howItSells([shipped()], kits, "2026-08-01", "2026-08-31");
    expect(burn).toEqual([
      { key: "Balloons|Gold balloon", name: "Gold balloon", packs: 8, perWeek: 1.9, pieces: 400, piecesPerWeek: 93.3 },
    ]);
  });
});

/**
 * The money. Three separate facts and never one number: what was packed, what it cost, and what
 * came back. A SKU nobody has costed contributes an UNKNOWN, not a zero — folding those into the
 * profit would be confidently wrong on exactly the days the partner's SKUs sell well.
 */
/**
 * The marketplace's own orders export — the way back when a manifest was never downloaded.
 *
 * Built against Vansh's three real files (111 parcels against 9 in the ledger). The fixture keeps
 * the two shapes that break a naive reader: a Product Name with COMMAS in it, and a CANCELLED row,
 * which is the one kind of row that takes something away instead of adding it.
 */
describe("an orders export", () => {
  /** A manifest parcel, for the cases where an export meets one the manifest already brought in. */
  const parcel = (id: string, sku: string) =>
    ({ subOrder: id, awb: `A${id}`, sku, qty: 1, courier: "Valmo" });

  const CSV = [
    '"Reason for Credit Entry","Sub Order No","Order Date","Product Name","SKU","Quantity","Supplier Discounted Price (Incl GST and Commision)"',
    '"DELIVERED","3133043013172_1","2026-07-27","Balloon Kit, Red and Gold, 54 pcs","SVP033","1","150.0"',
    '"SHIPPED","3144610877642_1","2026-07-30","Welcome Baby Kit","WB001","1","132.0"',
    '"RTO_COMPLETE","3144655368632_1","2026-07-30","Anniversary Kit","HAL001","1","150.0"',
    '"CANCELLED","3144655368633_1","2026-07-31","Groom Kit","GTB005","1","0"',
    '"READY_TO_SHIP","3144655368634_1","2026-07-31","Doraemon Kit","HBD-dore01","1","200.0"',
  ].join("\n");

  it("reads the columns that matter and ignores the rest", () => {
    const rows = readOrdersCsv(CSV);
    expect(rows).toHaveLength(5);
    // The comma inside "Balloon Kit, Red and Gold, 54 pcs" must not shift every field after it.
    expect(rows[0]).toMatchObject({ subOrder: "3133043013172_1", sku: "SVP033", qty: 1, paidPaise: 15000 });
    expect(rows.map((r) => r.state)).toEqual(["delivered", "shipped", "back", "cancelled", "waiting"]);
  });

  it("refuses a file that is not an orders export, rather than reading half of it", () => {
    expect(() => readOrdersCsv('"Order Date","SKU"\n"2026-07-27","ANP001"')).toThrow(/sub|order/i);
  });

  it("brings the shipped ones in packed, marks the RTO, and takes the cancelled one OUT", () => {
    const rows = readOrdersCsv(CSV);
    const r = mergeOrdersCsv(null, rows, "export.csv");
    expect(r.added).toBe(4);            // the cancelled row never arrives
    expect(r.packed).toBe(3);           // delivered + shipped + rto all demonstrably went out
    expect(r.back).toBe(1);
    // Waiting is in the ledger but NOT packed — it belongs in the queue, not in the money.
    const waiting = r.ledger.subOrders.find((p) => p.sku === "HBD-dore01")!;
    expect(waiting.packedOn).toBeUndefined();
    // Only what the marketplace confirmed carries `delivered`; a SHIPPED one does not.
    expect(r.ledger.subOrders.find((p) => p.sku === "SVP033")!.delivered).toBe(true);
    expect(r.ledger.subOrders.find((p) => p.sku === "WB001")!.delivered).toBeUndefined();
  });

  /**
   * The cancelled-order problem, arriving as data instead of a button: a manifest counted it, the
   * marketplace then cancelled it, and the export is what says so.
   */
  it("removes a parcel a manifest already brought in, once the export says CANCELLED", () => {
    let l = mergeShipments(null, [parcel("3144655368633_1", "GTB005")], "2026-07-31", "m.pdf");
    expect(l.subOrders).toHaveLength(1);
    l = mergeOrdersCsv(l, readOrdersCsv(CSV), "export.csv").ledger;
    expect(l.subOrders.some((p) => p.subOrder === "3144655368633_1")).toBe(false);
  });

  it("never overwrites a tick somebody already made — that record is their pay", () => {
    let l = mergeShipments(null, [parcel("3133043013172_1", "SVP033")], "2026-07-27", "m.pdf");
    l = packSku(l, "SVP033", "2026-07-28", ["Asha"]);
    const r = mergeOrdersCsv(l, readOrdersCsv(CSV), "export.csv");
    const p = r.ledger.subOrders.find((x) => x.subOrder === "3133043013172_1")!;
    expect(p.packedOn).toBe("2026-07-28");
    expect(p.packedBy).toEqual(["Asha"]);
    expect(r.packed).toBe(2); // it was already packed, so it is not counted as newly packed
  });

  /** A delivered parcel is landed on day one — the marketplace has said so, so nothing is guessed. */
  it("counts a confirmed delivery as landed without waiting out the return window", () => {
    const kits: KitMoney[] = [{ sku: "SVP033", costPaise: 5000, pays: { meesho: 15000 } }];
    const l = mergeOrdersCsv(null, readOrdersCsv(CSV), "export.csv").ledger;
    const m = money([l], kits, "2026-07-01", "2026-07-31", undefined, {}, "2026-07-28");
    expect(m.landed.packets).toBe(1);   // delivered, one day old
    expect(m.inFlight.packets).toBe(1); // shipped, and nobody has confirmed it
  });
});

/**
 * **Importing the same thing twice must change nothing** — the property is called IDEMPOTENCE, and
 * the sub-order number is what provides it: it is the parcel's natural key, so re-importing a file
 * re-states facts about parcels already known instead of creating new ones.
 *
 * Vansh, 2026-09-04: *"I don't want repetitive subtraction when any two PDFs had some same date and
 * orders — duplicated subtraction I don't want."* It is the one arithmetic error nobody would ever
 * spot: the shelf would just drain faster than the shop does, and every figure would look plausible.
 *
 * This is asserted on the MATERIALS, not on the parcel count, because that is what he is protecting.
 * Counting parcels twice is visible; consuming materials twice is not.
 */
describe("no double subtraction", () => {
  const kits: (KitMoney & KitMaterials)[] = [{
    sku: "SVP033", costPaise: 5000, pays: { meesho: 15000 },
    materials: [{ key: "Balloon|Red Balloon", name: "Red Balloon", packs: 1, pieces: 20 }],
  }];
  const p = (id: string) => ({ subOrder: id, awb: "A", sku: "SVP033", qty: 1, courier: "Valmo" });
  const used = (l: Ledger) => howItSells([l], kits, "2026-01-01", "2026-12-31").burn[0]?.pieces ?? 0;

  it("counts a parcel once however many manifests mention it", () => {
    // Meesho's manifest is a snapshot of everything ready to ship, so the 2pm download repeats the
    // 12pm one. Two files, three parcels, sixty pieces — never a hundred.
    let l = mergeShipments(null, [p("1"), p("2")], "2026-08-20", "12pm.pdf");
    l = packSku(l, "SVP033", "2026-08-20", ["Asha"]);
    expect(used(l)).toBe(40);

    l = mergeShipments(l, [p("1"), p("2"), p("3")], "2026-08-20", "2pm.pdf");
    l = packSku(l, "SVP033", "2026-08-20", ["Asha"]);
    expect(used(l)).toBe(60);

    // The same file again, by mistake. Nothing moves.
    l = mergeShipments(l, [p("1"), p("2"), p("3")], "2026-08-20", "2pm.pdf");
    expect(used(l)).toBe(60);
    expect(l.subOrders).toHaveLength(3);
  });

  it("does not subtract again when an orders export covers parcels a manifest already brought in", () => {
    let l = mergeShipments(null, [p("1"), p("2")], "2026-08-20", "m.pdf");
    l = packSku(l, "SVP033", "2026-08-20", ["Asha"]);
    const before = used(l);

    const csv = [
      '"Reason for Credit Entry","Sub Order No","Order Date","SKU","Quantity"',
      '"DELIVERED","1","2026-08-20","SVP033","1"',
      '"DELIVERED","2","2026-08-20","SVP033","1"',
    ].join("\n");
    l = mergeOrdersCsv(l, readOrdersCsv(csv), "export.csv").ledger;
    expect(used(l)).toBe(before);
    // Twice more, for good measure: the file is the same facts, not more of them.
    l = mergeOrdersCsv(l, readOrdersCsv(csv), "export.csv").ledger;
    expect(used(l)).toBe(before);
  });
});

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

  /**
   * Ads and boost. Everything else on the money screen is derived from the kit and the ledger;
   * this is the one cost that is typed in, because no parcel and no report carries it. It is
   * dated per day and split per marketplace so it survives the same two filters as everything
   * else — a month figure lumped onto one day would make "today" and "this week" both lie.
   */
  it("takes ads and boost off the profit, per day and per marketplace", () => {
    const ads = { "2026-08-20": { meesho: 5000, flipkart: 3000 }, "2026-08-21": { meesho: 100000 } };
    const m = money([packed()], kits, "2026-08-20", "2026-08-20", undefined, ads);
    expect(m.adsPaise).toBe(8000);
    expect(m.profitPaise).toBe(33000 - 16000 - 8000);

    // The marketplace switch filters it too, or the Meesho-only view would carry Flipkart's spend.
    expect(money([packed()], kits, "2026-08-20", "2026-08-20", "meesho", ads).adsPaise).toBe(5000);

    // And a day outside the window is another day's money — never folded into this one.
    expect(adSpend(ads, "2026-08-20", "2026-08-21")).toBe(108000);
    expect(adSpend(ads, "2026-08-22", "2026-08-31")).toBe(0);

    // No file yet is not zero spend, but it is the only thing arithmetic can do with it.
    expect(money([packed()], kits, "2026-08-20", "2026-08-20").adsPaise).toBe(0);
  });

  /**
   * The hole Vansh found: *"deduction will happen on the latest cost in the JSON only."* A kit's
   * price changes — a ticket raised with the marketplace, a promotion, a corrected material — and
   * without freezing it, correcting one today silently rewrites what last month earned.
   */
  it("freezes what a parcel was worth at the tick, so a later price change cannot rewrite it", () => {
    const kits: KitMoney[] = [{ sku: "ANP003", costPaise: 8000, pays: { meesho: 15000 } }];
    let l = mergeShipments(null, [parcel("1", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"], Infinity, (p) => {
      const k = kitForSku(p.sku, kits);
      return k?.costPaise === undefined ? null : { paidPaise: k.pays!.meesho, materialsPaise: k.costPaise };
    });
    expect(l.subOrders[0]).toMatchObject({ paidPaise: 15000, materialsPaise: 8000 });

    // The kit is re-priced a fortnight later. August must not move.
    const dearer: KitMoney[] = [{ sku: "ANP003", costPaise: 9500, pays: { meesho: 19000 } }];
    const day = money([l], dearer, "2026-08-20", "2026-08-20");
    expect(day.revenuePaise).toBe(15000);
    expect(day.materialsPaise).toBe(8000);

    // And a return takes off exactly what was booked, not what the kit says now.
    const back = money([markBack(l, "1", "rto", "2026-09-05")], dearer, "2026-09-01", "2026-09-30");
    expect(back.reversals.revenuePaise).toBe(15000);
  });

  it("falls back to today's kit for a parcel packed before the money was known", () => {
    const kits: KitMoney[] = [{ sku: "ANP003", costPaise: 8000, pays: { meesho: 15000 } }];
    let l = mergeShipments(null, [parcel("1", "ANP003")], "2026-08-20", "a.pdf");
    l = packSku(l, "ANP003", "2026-08-20", ["Asha"]); // no resolver — nothing costed it then
    expect(l.subOrders[0].paidPaise).toBeUndefined();
    expect(money([l], kits, "2026-08-20", "2026-08-20").revenuePaise).toBe(15000);
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

/**
 * Reading a marketplace's own RTO or returns report. Nothing parses their columns — the text comes
 * out of whatever kind of file it is and is searched for ids WE already hold, so a layout change
 * cannot break it and somebody else's parcels cannot match.
 */
describe("reading a returns report", () => {
  const packed = [
    { subOrder: "321165013526408960_1", awb: "1490839976524846", sku: "ANP001", qty: 1, courier: "Delhivery", market: "meesho", firstSeen: "2026-08-20", packedOn: "2026-08-20" },
    { subOrder: "321215756111343040_1", awb: "SF3836652979FPL", sku: "SVP033", qty: 1, courier: "Shadowfax", market: "meesho", firstSeen: "2026-08-20", packedOn: "2026-08-20" },
    { subOrder: "999999999999999999_1", awb: "XX1", sku: "GTB001", qty: 1, courier: "Valmo", market: "meesho", firstSeen: "2026-08-20", packedOn: "2026-08-20" },
  ];

  it("finds our parcels in a CSV whatever its columns are called", () => {
    const csv = Buffer.from(
      "some heading,another,whatever\n" +
      "2026-09-03,321165013526408960_1,RTO delivered to seller\n" +
      "2026-09-03,SF3836652979FPL,customer return\n",  // this row names the AWB, not the order
    );
    expect(idsInFile(csv, packed).map((p) => p.sku)).toEqual(["ANP001", "SVP033"]);
  });

  it("matches exactly, so one order's other line items are not dragged in", () => {
    // The same order number without its line suffix must NOT match — that is a different parcel.
    const csv = Buffer.from("id\n32116501352\n");
    expect(idsInFile(csv, packed)).toEqual([]);
  });

  it("finds nothing in a file about somebody else's parcels", () => {
    expect(idsInFile(Buffer.from("id\n123456789_9\nAWB999\n"), packed)).toEqual([]);
  });

  it("reads the ids out of a real PDF too", () => {
    // The manifest itself is the handiest PDF to prove it on: it names all 41 of its parcels.
    const m = parseManifest(pdf);
    const asPacked = m.shipments.map((sh) => ({ ...sh, market: "meesho", firstSeen: "2026-08-19" }));
    expect(idsInFile(pdf, asPacked)).toHaveLength(41);
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

  /**
   * The ready folder is written two ways and both are ours — the finish step's long name, and the
   * older short one where the slot follows a DOT. Only the first ever matched, so half the folder
   * read as *no picture* (WW-189).
   */
  it("reads both spellings of a finished image's name", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ww-ready-"));
    const files = [
      "ANP-4-annaprashan-decoration-kit-red-gold-balloons-cutouts-1.jpg",
      "ANP-4-annaprashan-decoration-kit-red-gold-balloons-cutouts-2.jpg",
      "HBD-01.1.jpg",
      "HBD-01.2.jpg",
      // A title carrying a number of its own — the slot is the LAST number, never the second.
      "WB-4-welcome-baby-16-photo-booth-props-2.jpg",
      // Not a picture. It parses as "listing SVP033, slot 2" and must never be offered as one.
      "SVP033-ANP002.csv",
    ];
    for (const f of files) writeFileSync(path.join(dir, f), "x");

    expect(await imageForSku(dir, "ANP004", 2)).toMatch(/ANP-4-annaprashan.*-2\.jpg$/);
    expect(await imageForSku(dir, "ANP004", 1)).toMatch(/ANP-4-annaprashan.*-1\.jpg$/);
    // `HBD-01`, `HBD001` and `HBD1` are one listing, and its slot follows a dot.
    expect(await imageForSku(dir, "HBD-01", 2)).toMatch(/HBD-01\.2\.jpg$/);
    expect(await imageForSku(dir, "HBD001", 2)).toMatch(/HBD-01\.2\.jpg$/);
    expect(await imageForSku(dir, "WB004", 2)).toMatch(/WB-4-welcome-baby.*-2\.jpg$/);
    expect(await imageForSku(dir, "SVP033", 2)).toBeNull();
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

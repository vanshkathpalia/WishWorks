/**
 * stock.test.ts — the raw material on the shelf.
 *
 * The fixture is Vansh's real delivery note of 19 Aug 2026, pasted exactly as his supplier writes
 * it: 61 lines, three different places the quantity can sit, four units, and spellings that are
 * nobody's idea of a product name (`annprashan`, `Rosegold`, `gletar`, `brtb`).
 *
 * What must not fail quietly:
 *   1. Every line is read. A line the parser cannot understand has to SHOW, not vanish — an
 *      uncounted carton is the exact failure this feature exists to prevent.
 *   2. The quantity is the one with a unit against it. `Blue no foil. 0 to9 450 pcs` is 450, not 0.
 *   3. Two spellings of one material tally onto ONE row; two things nobody can identify stay apart.
 *   4. A disagreement between the two lists sorts to the top, because a tally is a worklist.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { readNote, tally, onHand, firstDelivery, type Delivery } from "../src/stock-core.js";
import type { Material } from "../src/inventory-core.js";

/** Vansh's supplier, 19 Aug 2026 — verbatim, misspellings and all. */
const NOTE = `Vansh 19.8.26
Groom to be foil 5 pkt ok
1 pkt silver chrome ok
1 pkt golden chrome ok
1 pkt Rosegold chrome ok
Blue no foil. 0 to9 450 pcs ok
10 pkt blue star ok
2 pkt silver Moon big ok
1 petti pump ok
5 pkt kitty five pcs set ok
3,pkt ha banner red ok
200 pcs led 10 mtr ok
500 pcs 8×10 meesho barcode ok
5pkt welcome baby blue banner ok
1 pkt strow 2 kg. Ok
1 bandal maniplant ok
2,pkt annprashan gold foil ok`;

describe("reading a delivery note", () => {
  const lines = readNote(NOTE);

  it("drops the date header and keeps every material line", () => {
    // 17 lines of text, one of which is `Vansh 19.8.26`.
    expect(lines).toHaveLength(16);
    expect(lines.some((l) => /vansh/i.test(l.name))).toBe(false);
  });

  it("finds the quantity by its UNIT, wherever it sits on the line", () => {
    const by = (frag: string) => lines.find((l) => l.raw.includes(frag))!;
    // Quantity first, last, and buried after a name that has digits of its own.
    expect(by("Groom to be foil")).toMatchObject({ qty: 5, unit: "pkt", name: "Groom to be foil" });
    expect(by("silver chrome")).toMatchObject({ qty: 1, unit: "pkt", name: "silver chrome" });
    expect(by("Blue no foil")).toMatchObject({ qty: 450, unit: "pcs" });
    // `0 to9` is part of the NAME. Reading it as the quantity would count 0 of them.
    expect(by("Blue no foil").name).toContain("0 to9");
  });

  it("reads the units these two actually write in, and the commas and missing spaces", () => {
    const by = (frag: string) => lines.find((l) => l.raw.includes(frag))!;
    expect(by("petti pump")).toMatchObject({ qty: 1, unit: "petti", name: "pump" });
    expect(by("bandal maniplant")).toMatchObject({ qty: 1, unit: "bandal", name: "maniplant" });
    expect(by("ha banner red")).toMatchObject({ qty: 3, unit: "pkt" }); // "3,pkt"
    expect(by("welcome baby blue")).toMatchObject({ qty: 5, unit: "pkt" }); // "5pkt", no space
    expect(by("meesho barcode")).toMatchObject({ qty: 500, unit: "pcs" });
  });

  it("strips the writer's own tick, which is not part of any material's name", () => {
    expect(lines.every((l) => !/\bok$/i.test(l.name))).toBe(true);
    expect(lines.find((l) => l.raw.includes("strow"))!.name).toBe("strow 2 kg");
  });
});

describe("tallying his count against the supplier's claim", () => {
  const materials: Material[] = [
    { category: "Foil", material: "Groom To Be Foil Balloon", paise: 4000, aka: ["GTB Foil"] },
    { category: "Chrome", material: "Silver Chrome Balloon", paise: 3000 },
    { category: "Foil", material: "Annaprashan Gold Foil", paise: 5000 },
  ];

  it("puts two spellings of one material on ONE row, and shows the disagreement first", () => {
    // He counted four of the groom-to-be, the supplier claims five. Different words, one material.
    const rows = tally(
      readNote("Groom to be foil 5 pkt ok\n1 pkt silver chrome ok"),
      readNote("4 pkt GTB Foil\n1 pkt silver chrome"),
      materials,
    );
    expect(rows).toHaveLength(2);
    // A mismatch sorts to the top: a tally is a worklist, not a report.
    expect(rows[0]).toMatchObject({ claimed: 5, counted: 4, mismatch: true });
    expect(rows[0].key).toBe("Foil|Groom To Be Foil Balloon");
    expect(rows[1]).toMatchObject({ claimed: 1, counted: 1, mismatch: false });
  });

  it("counts a line only one side listed as missing, never as zero-on-both", () => {
    const rows = tally(readNote("2,pkt annprashan gold foil ok"), readNote(""), materials);
    // Claimed but not counted. `counted: null` is "we have not counted it", which is not "none came".
    expect(rows[0]).toMatchObject({ claimed: 2, counted: null, mismatch: false });
    expect(rows[0].key).toBe("Foil|Annaprashan Gold Foil");
  });

  it("keeps two unidentifiable lines apart rather than merging them on spelling", () => {
    const rows = tally(readNote("1 pkt zzz widget\n1 pkt qqq gadget"), readNote(""), materials);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.key === null)).toBe(true);
  });

  it("takes the human's pick over the matcher, and never re-scores it", () => {
    const rows = tally(readNote("1 pkt zzz widget"), readNote(""), materials, {
      "zzz widget": "Chrome|Silver Chrome Balloon",
    });
    expect(rows[0]).toMatchObject({ key: "Chrome|Silver Chrome Balloon", score: 1, overridden: true });
  });
});

describe("what is left on the shelf", () => {
  const FOIL = "Foil|Groom To Be Foil Balloon";
  const delivery = (date: string, qty: number, unit = "pkt"): Delivery => ({
    date,
    claimedNote: "",
    countedNote: "",
    picks: {},
    lines: [{ key: FOIL, name: "Groom To Be Foil Balloon", qty, unit }],
  });
  /** Sold in packets of 50 — the number the price list already carries, for costing. */
  const perPack = new Map([[FOIL, 50]]);

  it("takes the packing off the deliveries, and puts what runs out first at the top", () => {
    const rows = onHand(
      [delivery("2026-08-19", 5), delivery("2026-08-26", 3)],
      new Map([[FOIL, { pieces: 300, perWeek: 100 }]]),
      new Map(),
      perPack,
    );
    // 8 packets of 50 = 400 pieces in, 300 used.
    expect(rows[0]).toMatchObject({ received: 400, used: 300, left: 100, weeksLeft: 1 });
  });

  /**
   * The bug the piece count exists for. Vansh, 2026-08-31: *"ten packets does not mean ten
   * units"* — one kit takes 4 heart foils out of a packet of 50, and the old arithmetic netted
   * packs against packs, so the first order retired the whole packet and the shelf read empty
   * with 46 pieces sitting on it.
   */
  it("counts pieces, not packets, so one order does not retire a whole packet", () => {
    const [row] = onHand([delivery("2026-08-19", 1)], new Map([[FOIL, { pieces: 4, perWeek: 4 }]]), new Map(), perPack);
    expect(row).toMatchObject({ received: 50, used: 4, left: 46 });
  });

  /** A note written in pieces is already in pieces. Multiplying it would invent 22,500 balloons. */
  it("leaves a line written in pieces alone", () => {
    const [row] = onHand([delivery("2026-08-19", 450, "pcs")], new Map(), new Map(), perPack);
    expect(row.received).toBe(450);
  });

  /**
   * The whole point of the panel: say it BEFORE it runs out. The supplier takes a week, so a week
   * of cover is already too late — see `REORDER_WEEKS`.
   */
  it("flags what runs out before the supplier could deliver, and not what does not", () => {
    const used = (pieces: number, perWeek: number) => new Map([[FOIL, { pieces, perWeek }]]);
    // 50 pieces in, 30 used, 10 a week: two weeks left, which is the edge — flagged.
    expect(onHand([delivery("2026-08-19", 1)], used(30, 10), new Map(), perPack)[0].order).toBe(true);
    // Same shelf, a quarter of the rate: eight weeks, no flag.
    expect(onHand([delivery("2026-08-19", 1)], used(30, 2.5), new Map(), perPack)[0].order).toBe(false);
    // Nothing used at all: no rate, so no weeks and no flag — a blank is not a promise.
    const idle = onHand([delivery("2026-08-19", 1)], new Map(), new Map(), perPack)[0];
    expect(idle).toMatchObject({ weeksLeft: null, order: false });
  });

  it("puts the soonest to run out first, which is not the smallest pile", () => {
    const two = (key: string, qty: number): Delivery => ({
      ...delivery("2026-08-19", qty), lines: [{ key, name: key, qty, unit: "pcs" }],
    });
    const rows = onHand(
      [two("Led|Led", 200), two("Pump|Pump", 5)],
      new Map([["Led|Led", { pieces: 0, perWeek: 100 }], ["Pump|Pump", { pieces: 0, perWeek: 1 }]]),
    );
    // 200 LEDs at 100 a week go before 5 pumps at one a week, though 200 is the bigger number.
    expect(rows.map((r) => r.key)).toEqual(["Led|Led", "Pump|Pump"]);
  });

  /**
   * The silent half of counting in pieces. Only 23 of 172 materials carry a `piecesPerPack` and the
   * supplier writes almost everything in `pkt`, so without this most of the shelf would net 5
   * PACKETS against 300 PIECES of packing, land far below zero and flag everything to reorder at
   * once. Vansh, 2026-09-03: *"pkt and pcs can create a problem."*
   */
  it("asks for the pack size instead of subtracting packets from pieces", () => {
    const [row] = onHand(
      [delivery("2026-08-19", 5)],
      new Map([[FOIL, { pieces: 300, perWeek: 100 }]]),
      new Map(),
      new Map(), // nobody has said how many are in a packet
    );
    expect(row).toMatchObject({ needsPackSize: true, weeksLeft: null, order: false });
    // What came in is still shown — it is the units that do not match, not the count.
    expect(row.received).toBe(5);
  });

  it("puts the rows nobody can work out above the ones that can", () => {
    const unknown: Delivery = {
      ...delivery("2026-08-19", 5),
      lines: [{ key: "Foil|Mystery", name: "Mystery", qty: 5, unit: "pkt" }],
    };
    const rows = onHand(
      [delivery("2026-08-19", 1), unknown],
      new Map([[FOIL, { pieces: 30, perWeek: 10 }]]),
      new Map(),
      perPack,
    );
    // The known one is two weeks from running out and would otherwise sort first.
    expect(rows.map((r) => r.key)).toEqual(["Foil|Mystery", FOIL]);
  });

  /** A note written in pieces needs no pack size, even for a material nobody has measured. */
  it("does not ask when the note already counted pieces", () => {
    const [row] = onHand([delivery("2026-08-19", 450, "pcs")], new Map(), new Map(), new Map());
    expect(row.needsPackSize).toBe(false);
  });

  it("ignores a line nothing on the price list matched — there is nothing to net it against", () => {
    const d = { ...delivery("2026-08-19", 5), lines: [{ key: null, name: "zzz", qty: 5, unit: "pkt" }] };
    expect(onHand([d], new Map())).toEqual([]);
  });

  it("knows the day usage starts counting from, so day one is not deeply negative", () => {
    expect(firstDelivery([delivery("2026-08-26", 1), delivery("2026-08-19", 1)])).toBe("2026-08-19");
    expect(firstDelivery([])).toBeNull();
  });
});

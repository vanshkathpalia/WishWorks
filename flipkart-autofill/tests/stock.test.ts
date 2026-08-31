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
  const delivery = (date: string, qty: number): Delivery => ({
    date,
    claimedNote: "",
    countedNote: "",
    picks: {},
    lines: [{ key: "Foil|Groom To Be Foil Balloon", name: "Groom To Be Foil Balloon", qty, unit: "pkt" }],
  });

  it("takes the packing off the deliveries, and puts what runs out first at the top", () => {
    const rows = onHand(
      [delivery("2026-08-19", 5), delivery("2026-08-26", 3)],
      new Map([["Foil|Groom To Be Foil Balloon", 6]]),
    );
    expect(rows[0]).toMatchObject({ received: 8, used: 6, left: 2 });
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

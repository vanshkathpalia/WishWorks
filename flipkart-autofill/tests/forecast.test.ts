/**
 * forecast.test.ts — how much to order for the next fortnight, from what is actually selling.
 *
 * The numbers below are Vansh's own worked example, 2026-09-13:
 *
 *   *"if each pkt of anp1 takes 2 pcs of golden fringes and 4 pcs of heart… and I get on an avg
 *   10 order of anp 1 then 4 × 10 × 15 should be the heart pcs req, nearly 12 pkt… and 2 × 10 × 15
 *   nearly 30 pkt of golden fringes."*
 *
 * They are the test because they are the specification: if this file ever disagrees with the sum he
 * does in his head, one of the two is wrong and it needs to be obvious which.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadMaterials } from "../src/inventory-core.js";
import { forecast } from "../src/stock-core.js";

const HEART = "balloon|Heart Foil";
const FRINGE = "curtain|Golden Fringes";

/** ANP1 as he described it: 4 hearts and 2 golden fringes in one packed kit. */
const anp1 = {
  sku: "ANP1",
  materials: [
    { key: HEART, name: "Heart Foil", pieces: 4 },
    { key: FRINGE, name: "Golden Fringes", pieces: 2 },
  ],
};

describe("ordering for the next two weeks", () => {
  // 10 parcels a day: 70 over a 7-day window.
  const sold = new Map([["ANP1", 70]]);
  const packSizes = new Map([[HEART, 50], [FRINGE, 10]]);
  const run = () => forecast({ sold, windowDays: 7, horizonDays: 15, kits: [anp1], packSizes });

  it("does the sum he does in his head", () => {
    const hearts = run().find((n) => n.key === HEART)!;
    const fringes = run().find((n) => n.key === FRINGE)!;
    expect(hearts.pieces).toBe(600); // 4 x 10 x 15
    expect(fringes.pieces).toBe(300); // 2 x 10 x 15
  });

  it("turns pieces into the packets he actually orders", () => {
    expect(run().find((n) => n.key === HEART)!.packs).toBe(12); // 600 / 50
    expect(run().find((n) => n.key === FRINGE)!.packs).toBe(30); // 300 / 10
  });

  it("rounds a packet UP, because half a packet cannot be ordered", () => {
    // 601 pieces is 13 packets, not 12.02. Rounding down is how a kit runs one piece short.
    const odd = forecast({
      sold: new Map([["ANP1", 70.2]]),
      windowDays: 7,
      horizonDays: 15,
      kits: [anp1],
      packSizes,
    });
    expect(odd.find((n) => n.key === HEART)!.packs).toBe(13);
  });

  it("shows the working, biggest contributor first", () => {
    // A number with no arithmetic behind it is a number nobody can check — and the breakdown is
    // the only way to see that ONE kit caused a jump rather than everything drifting.
    const other = {
      sku: "ANP2",
      materials: [{ key: HEART, name: "Heart Foil", pieces: 1 }],
    };
    const both = forecast({
      sold: new Map([["ANP1", 70], ["ANP2", 7]]),
      windowDays: 7,
      horizonDays: 15,
      kits: [anp1, other],
      packSizes,
    });
    const hearts = both.find((n) => n.key === HEART)!;
    expect(hearts.pieces).toBe(615); // 600 + 15
    expect(hearts.from.map((f) => [f.sku, f.perKit, f.pieces])).toEqual([
      ["ANP1", 4, 600],
      ["ANP2", 1, 15],
    ]);
  });

  it("says nothing for a kit that has not sold", () => {
    // No sales is not a small number, it is no answer. Ordering for a kit nobody bought is cash on
    // a shelf, and the supplier call has its own reasons to stock something (see nextCall).
    expect(forecast({ sold: new Map(), windowDays: 7, horizonDays: 15, kits: [anp1] })).toEqual([]);
  });

  it("leaves the packet count blank when nobody knows the pack size", () => {
    // The same rule as `onHand`: a figure nobody can defend is worse than a blank, because a blank
    // asks and a figure asserts.
    const noSizes = forecast({ sold, windowDays: 7, horizonDays: 15, kits: [anp1] });
    expect(noSizes.find((n) => n.key === HEART)!.packs).toBeNull();
    expect(noSizes.find((n) => n.key === HEART)!.pieces).toBe(600);
  });

  it("refuses a nonsense window rather than dividing by zero", () => {
    expect(forecast({ sold, windowDays: 0, horizonDays: 15, kits: [anp1] })).toEqual([]);
  });
});

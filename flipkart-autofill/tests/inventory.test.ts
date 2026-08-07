/**
 * inventory.test.ts — the cost sheet is a money path, so the things pinned here are the ones that
 * would be wrong in a way nobody notices:
 *
 *   1. A name that is in no price row is left UNPRICED and counted, never mapped to something
 *      close. A silently substituted row is invisible in a total.
 *   2. The total is in paise and stays exact. 3.5 rupees times twenty is where a sheet starts
 *      disagreeing with itself.
 *   3. `priceAt` is margin, not markup — cost / (1 - m). Getting that backwards under-prices
 *      every kit, and the number still looks plausible.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  costKit,
  loadMaterials,
  normalize,
  priceAt,
  readKitFile,
  rupees,
  type Material,
} from "../src/inventory-core.js";

const PRICES: Material[] = [
  { category: "Balloon", material: "BLUE Balloon", paise: 80 },
  { category: "Balloon", material: "BLUE Dark Balloon", paise: 80 },
  { category: "Balloon", material: "CONFETI SILVER BALLOONS", paise: 200 },
  { category: "Tape", material: "ARCH TAPE", paise: 350 },
];

describe("reading the AI's reply", () => {
  it("takes lines, items or materials, and qty, quantity or count", () => {
    expect(readKitFile({ lines: [{ material: "ARCH TAPE", qty: 1 }] })).toEqual([
      { material: "ARCH TAPE", qty: 1 },
    ]);
    expect(readKitFile({ items: [{ name: "ARCH TAPE", count: 2 }] })).toEqual([
      { material: "ARCH TAPE", qty: 2 },
    ]);
  });

  it("drops any line without a name and a positive whole count", () => {
    // A quantity-less line priced as one unit is a wrong total nobody would question.
    const lines = readKitFile({
      lines: [
        { material: "ARCH TAPE" },
        { material: "", qty: 3 },
        { material: "BLUE Balloon", qty: 0 },
        { material: "BLUE Balloon", qty: 2.5 },
        { material: "BLUE Balloon", qty: "twenty" },
        { material: "BLUE Balloon", qty: 20 },
      ],
    });
    expect(lines).toEqual([{ material: "BLUE Balloon", qty: 20 }]);
  });

  it("accepts a quantity the model quoted, because that is not an error", () => {
    // The prompt asks for a bare number and mostly gets one. `"20"` is still unambiguously
    // twenty; rejecting it would drop a real line and shrink the total silently, which is
    // strictly worse than coercing. `"twenty"` is NaN and is dropped, above.
    expect(readKitFile({ lines: [{ material: "ARCH TAPE", qty: "20" }] })).toEqual([
      { material: "ARCH TAPE", qty: 20 },
    ]);
  });

  it("survives a reply with no list at all rather than throwing", () => {
    expect(readKitFile({})).toEqual([]);
    expect(readKitFile(null)).toEqual([]);
    expect(readKitFile({ lines: "nope" })).toEqual([]);
  });
});

describe("costing a kit", () => {
  it("matches through case and punctuation, and multiplies by the count", () => {
    const kit = costKit([{ material: "blue  balloon", qty: 20 }], PRICES);
    expect(kit.lines[0].match?.material).toBe("BLUE Balloon");
    expect(kit.lines[0].paise).toBe(1600);
    expect(kit.totalPaise).toBe(1600);
    expect(kit.unpriced).toBe(0);
  });

  it("never substitutes a near name — an unknown item stays unpriced and is counted", () => {
    // "BLUE Balloons" (plural) is not "BLUE Balloon", and "BLUE Dark Balloon" is a real, cheaper-
    // to-confuse row sitting right next to it. Guessing here is how a kit gets costed off the
    // wrong line and nobody ever finds out.
    const kit = costKit(
      [
        { material: "BLUE Balloonz", qty: 20 },
        { material: "ARCH TAPE", qty: 1 },
      ],
      PRICES,
    );
    expect(kit.lines[0].match).toBeNull();
    expect(kit.lines[0].paise).toBeNull();
    expect(kit.unpriced).toBe(1);
    // The total counts only what it could price, so it is an underestimate — which is why the
    // screen has to show `unpriced` next to it.
    expect(kit.totalPaise).toBe(350);
  });

  it("lets a human override any line, including one that matched", () => {
    const kit = costKit(
      [
        { material: "BLUE Balloonz", qty: 10 },
        { material: "BLUE Balloon", qty: 10 },
      ],
      PRICES,
      { 0: "Balloon|BLUE Balloon", 1: "Balloon|BLUE Dark Balloon" },
    );
    expect(kit.lines[0].paise).toBe(800);
    expect(kit.lines[1].match?.material).toBe("BLUE Dark Balloon");
    expect(kit.unpriced).toBe(0);
    expect(kit.totalPaise).toBe(1600);
  });

  it("stays exact where rupees would drift", () => {
    // 3.5 rupees x 7 is 24.5 — fine once, and the kind of thing that accumulates a paise of
    // error per line as floats. In paise it is just integers.
    const kit = costKit([{ material: "ARCH TAPE", qty: 7 }], PRICES);
    expect(kit.totalPaise).toBe(2450);
    expect(rupees(kit.totalPaise)).toBe("₹24.50");
    expect(rupees(1600)).toBe("₹16");
  });
});

describe("the selling price", () => {
  it("is margin on the price, not markup on the cost", () => {
    // 50% margin on a 100 rupee kit is 200, not 150. Markup under-prices every kit and the
    // number still looks reasonable, which is what makes it worth a test.
    expect(priceAt(10000, 50)).toBe(20000);
    expect(priceAt(10000, 0)).toBe(10000);
    expect(priceAt(10000, 60)).toBe(25000);
  });

  it("cannot be asked for an impossible margin", () => {
    expect(priceAt(10000, 100)).toBe(200000); // clamped to 95%, not Infinity
    expect(priceAt(10000, -20)).toBe(10000);
  });
});

describe("the shipped price list", () => {
  it("reads materials.json, and an absent one is empty rather than a crash", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ww-mat-"));
    expect(loadMaterials(dir)).toEqual([]);

    writeFileSync(
      path.join(dir, "materials.json"),
      JSON.stringify({
        _: "comments are ignored",
        materials: [
          { category: "Balloon", material: "BLUE Balloon", paise: 80 },
          { category: "Balloon", material: "No price yet" },
        ],
      }),
    );
    // A row with no number is skipped, so it reads as "not in the list" — which is honest —
    // rather than costing zero, which would quietly shrink the total.
    expect(loadMaterials(dir)).toEqual([{ category: "Balloon", material: "BLUE Balloon", paise: 80 }]);
  });

  it("ships with the repo's own list, and every row has a whole-paise price", () => {
    const real = loadMaterials(path.join(import.meta.dirname, "..", "categories"));
    expect(real.length).toBeGreaterThan(0);
    for (const m of real) {
      expect(Number.isInteger(m.paise), `${m.material} is not integer paise`).toBe(true);
      expect(m.category).toBeTruthy();
    }
    // Names must be unique after normalising, or two rows compete for one lookup key and which
    // one wins is an accident of file order.
    const keys = real.map((m) => normalize(m.material));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

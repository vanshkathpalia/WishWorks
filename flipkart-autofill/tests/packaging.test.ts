/**
 * packaging.test.ts — the parcel is declared to two marketplaces and weighed by a courier at
 * pickup, so the things pinned here are the ones that cost money when wrong:
 *
 *   1. A rule fires on the MATERIAL, not on the word. "net" as a keyword would catch a future
 *      "Netted Curtain" and add 40 g to kits containing no net.
 *   2. Two rules that both grow the box take the larger of each dimension, never the last to
 *      fire — otherwise the answer depends on the order of a JSON array.
 *   3. Volumetric weight is reported and compared, because couriers bill on the greater one.
 *   4. Over Vansh's 490 g ceiling warns, and never silently shrinks anything.
 *   5. The two Flipkart forms are derived from ONE parcel, in their own units.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  flipkartFields,
  loadPackaging,
  parcelFor,
  toInches,
  type PackagingSpec,
} from "../src/packaging.js";
import { loadMaterials, type Material } from "../src/inventory-core.js";

const CATS = path.join(import.meta.dirname, "..", "categories");
const spec = () => loadPackaging(CATS)!;
const mats = () => loadMaterials(CATS);

/** A normal kit: pink balloons, a banner, a curtain, tape. No net, no pump. */
const PLAIN = [
  { item: "DARK PINK BALLOONS", qty: 20 },
  { item: "HBD BANNER", qty: 1 },
  { item: "PINK METALLIC CURTAIN", qty: 2 },
  { item: "ARCH TAPE", qty: 1 },
];

describe("the shipped packaging rules", () => {
  it("loads, and an absent file is null rather than a crash", () => {
    expect(loadPackaging(path.join(CATS, "nope"))).toBeNull();
    const s = spec();
    // 7 x 8 x 1.5 INCHES — the packed parcel Vansh measured and typed into Flipkart on
    // 2026-08-12, in cm because cm is the stored unit. It replaced the 8 x 10 inch BAG's flat
    // size: a polybag is not filled to its edges, so declaring the bag over-declares every
    // listing. Ask what state a number describes (C-052) before storing it.
    expect(s.base).toEqual({ lengthCm: 20.32, breadthCm: 17.78, heightCm: 3.81, grams: 250 });
    expect(s.maxGrams).toBe(490);
  });

  it("every rule names materials that actually exist in the price list", () => {
    // A rule naming a row that was renamed away would silently never fire, and the parcel would
    // quietly go out at the base size. This is the only check that catches that.
    const names = new Set(mats().map((m: Material) => m.material.toLowerCase()));
    for (const rule of spec().rules) {
      for (const n of rule.whenAnyOf) {
        expect(names.has(n.toLowerCase()), `rule "${rule.name}" names "${n}", which is not a material`).toBe(true);
      }
    }
  });
});

describe("working out the parcel", () => {
  it("uses the base bag for a kit with none of the awkward items, and it bills on volume", () => {
    const p = parcelFor(PLAIN, mats(), spec());
    expect([p.lengthCm, p.breadthCm, p.heightCm, p.grams]).toEqual([20.32, 17.78, 3.81, 250]);
    expect(p.applied).toEqual([]);
    // 20.32 x 17.78 x 3.81 / 5000 kg = 275 g against a real 250 g. Volume still wins, but only
    // just — it was 412 g while this file stored the BAG rather than the parcel. Pinned
    // deliberately: this is the number Flipkart charges, and a silent change means somebody
    // shrank the box in the file rather than in the packing.
    expect(p.volumetricGrams).toBe(275);
    expect(p.billedGrams).toBe(275);
    expect(p.warnings.join(" ")).toContain("275");
  });

  it("a net makes the bag fuller and heavier, and says why", () => {
    const p = parcelFor([...PLAIN, { item: "GREEN NET", qty: 1 }], mats(), spec());
    expect(p.heightCm).toBe(5.08);
    expect(p.grams).toBe(280);
    expect(p.applied).toEqual(["net"]);
    // 8 x 9 x 2 in = 22.86 x 20.32 x 5.08 = 2360 / 5 = 472 g against 280 g real — bills 472.
    expect(p.volumetricGrams).toBe(472);
    expect(p.billedGrams).toBe(472);
    // Named as a FLIPKART cost. Meesho quotes before a weight is entered and its fee tracks the
    // main image (SHIPPING-COST.md), so a generic warning would send someone shrinking a box to
    // fix a fee that ignores boxes.
    expect(p.warnings.join(" ")).toContain("Flipkart");
    expect(p.warnings.join(" ")).toContain("Meesho is unaffected");
  });

  it("a pump moves the kit into the bigger bag, and that is what it bills on", () => {
    const p = parcelFor([...PLAIN, { item: "PUMP", qty: 1 }], mats(), spec());
    // 8 x 9 x 2 INCHES, MEASURED by Vansh 2026-08-12, and identical to the net rule because he
    // measured the same parcel for both: "both and even in the ones that have only each one of
    // these and both of these". This replaced a guess of 30.5 x 25.4 x 9 that billed at 1394 g
    // against a real ~300 g — the panel had been warning about a parcel three times the real
    // one, which is worse than no warning because it argues for repacking a fine kit. The test
    // exists so the next correction shows up here rather than as a settlement charge.
    expect([p.lengthCm, p.breadthCm, p.heightCm, p.grams]).toEqual([22.86, 20.32, 5.08, 280]);
    expect(p.applied).toEqual(["pump"]);
    expect(p.volumetricGrams).toBe(472);
    expect(p.billedGrams).toBe(472);
  });

  it("both at once takes the larger of each dimension and adds both weights", () => {
    // The ordering guard: neither rule may undo the other's growth.
    const p = parcelFor(
      [...PLAIN, { item: "WHITE NET", qty: 1 }, { item: "BALLOON PUMP", qty: 1 }],
      mats(),
      spec(),
    );
    // The two rules now ask for the SAME box, because that is what was measured — so this no
    // longer proves "the larger wins" on dimensions and only the weights still add. Kept anyway:
    // it is the guard that catches a future split of the two rules undoing each other.
    expect([p.lengthCm, p.breadthCm, p.heightCm]).toEqual([22.86, 20.32, 5.08]);
    expect(p.grams).toBe(310);
    expect(p.applied.sort()).toEqual(["net", "pump"]);
  });

  it("does not fire a rule on a word that merely looks like one", () => {
    // "net" as a substring would catch this; matching the MATERIAL does not.
    const p = parcelFor([{ item: "Pink Metallic Curtain", qty: 2 }], mats(), spec());
    expect(p.applied).toEqual([]);
    expect(p.heightCm).toBe(3.81);
  });

  it("warns over the ceiling instead of shrinking anything", () => {
    const heavy: PackagingSpec = {
      base: { lengthCm: 20, breadthCm: 15, heightCm: 4, grams: 600 },
      maxGrams: 490,
      rules: [],
      boxes: [],
    };
    const p = parcelFor(PLAIN, mats(), heavy);
    expect(p.grams).toBe(600); // untouched
    expect(p.warnings.join(" ")).toContain("490");
  });

  it("says when a human chose the box, so the screen cannot claim it was derived", () => {
    expect(parcelFor(PLAIN, mats(), spec()).overridden).toBe(false);
    const chosen = parcelFor(PLAIN, mats(), spec(), { lengthCm: 25, breadthCm: 18, heightCm: 6 });
    expect(chosen.overridden).toBe(true);
    expect([chosen.lengthCm, chosen.breadthCm, chosen.heightCm]).toEqual([25, 18, 6]);
    expect(chosen.volumetricGrams).toBe(540); // and it re-bills on the bigger box
  });

  it("offers the boxes it ships with, and every one is a real size", () => {
    const boxes = spec().boxes;
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.label).toBeTruthy();
      for (const n of [b.lengthCm, b.breadthCm, b.heightCm]) expect(n).toBeGreaterThan(0);
    }
  });

  it("lets a measured figure override the rules", () => {
    // Somebody who has put the parcel on a scale knows more than a rule table.
    const p = parcelFor([...PLAIN, { item: "GREEN NET", qty: 1 }], mats(), spec(), { grams: 275 });
    expect(p.grams).toBe(275);
    expect(p.heightCm).toBe(5.08); // the rule still shaped the box
  });
});

describe("the two forms Flipkart asks for", () => {
  it("derives both from one parcel, each in its own unit", () => {
    const f = flipkartFields(parcelFor(PLAIN, mats(), spec()));
    // Price/Stock → Package Details: centimetres and kilograms, fixed-label units. The panel now
    // SHOWS inches, because that is how the bags are bought — this is the check that showing them
    // changed nothing about what is declared. Flipkart still gets cm here.
    expect(f.packageDetails).toEqual({
      Length: "20.32",
      Breadth: "17.78",
      Height: "3.81",
      Weight: "0.250",
    });
    // Additional Description → Dimensions: inches, and a real unit picker for weight. The round
    // trip lands back on the parcel Vansh measured — 7 x 8 x 1.5 in — which is also what the
    // universal Dimensions defaults now store, so the two agree by arithmetic rather than by
    // somebody keeping them in step.
    expect(f.dimensions).toEqual({
      Width: "7",
      Height: "1.5",
      Depth: "8",
      Weight: "0.250",
      "Weight (unit)": "kg",
    });
  });

  it("converts to inches the way the form's boxes accept", () => {
    expect(toInches(20)).toBe(7.9);
    expect(toInches(15)).toBe(5.9);
    expect(toInches(4)).toBe(1.6);
    expect(toInches(6)).toBe(2.4);
  });
});

describe("the pricing defaults no longer collide with the other tab", () => {
  it("carries no dimension key at all", async () => {
    // `loadProduct()` merges every defaults file into ONE flat map keyed by label, and Height and
    // Weight exist on BOTH tabs in different units. While these keys lived here, this file's
    // `Height: 8` was typed as 8 cm on Price/Stock and 8 INCHES on Additional Description, and
    // `Weight: 0.16` overwrote a parcel measured at 0.250 kg. Package Details is hand-typed now.
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(
      await readFile(path.join(CATS, "balloon-decoration.pricing.defaults.json"), "utf8"),
    );
    const keys = Object.keys(raw).filter((k) => !k.startsWith("_"));
    for (const banned of ["Length", "Breadth", "Height", "Weight"]) {
      expect(keys.some((k) => k === banned || k.startsWith(`${banned} (`)), `${banned} is back`).toBe(false);
    }
  });
});

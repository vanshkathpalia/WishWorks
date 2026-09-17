/**
 * sku.test.ts — naming one of OUR products from somebody else's catalog title.
 *
 * This fills the one field the latch form used to leave blank, so the failure that matters is a
 * CONFIDENT wrong answer: a listing filed under another product's costing, photos and price, which
 * nothing downstream would ever question. Refusing is always allowed; guessing is not.
 *
 * Titles below are real ones off Flipkart search during the 2026-09-13 sweeps.
 */

import { describe, it, expect } from "vitest";
import { nextSku, themeFor } from "../src/sku-core.js";

describe("reading which line a listing belongs to", () => {
  it("knows an annaprashan kit however it is spelt", () => {
    expect(themeFor("Partyfox Annaprashan Decoration Kit - Pastel Balloons, Cutouts & Unicorn")).toBe("ANP");
    expect(themeFor("ZYOZIQUE Multicolor Annaprasanam Decorations Items- Banner")).toBe("ANP");
    expect(themeFor("Balloon and you Rice Ceremony Decorations Items- Banner")).toBe("ANP");
  });

  it("puts a themed birthday under its theme, not under plain birthday", () => {
    // The whole reason the character rules are tested first: every one of these says "birthday".
    expect(themeFor("monga veer ji Blue, Golden, Pink Peppa pig theme Balloon decoration kit")).toBe("HBD-peppa");
    expect(themeFor("Partyfox Birthday Decoration Items For Boys - Jungle Safari With Green")).toBe("HBD-jungle");
    expect(themeFor("Partyfox Sonic Theme Foil Balloons Set of 5 for Kids Birthday Boys")).toBe("HBD-sonic");
    expect(themeFor("Fundots Printed Doremon Theme Birthday Decoration For Boys")).toBe("HBD-dore");
  });

  it("falls through to plain birthday when no theme claims it", () => {
    expect(themeFor("ZYRIC Solid Happy birthday black and gold decoration kit Balloon")).toBe("HBD");
  });

  it("says nothing rather than guess", () => {
    // A wrong SKU is silent for ever. An empty field is a person filling it in, once.
    expect(themeFor("KOSY Premium Gift Wrapping Paper Sheet | Size 75x50cm")).toBeNull();
    expect(themeFor("carphoenix Car Cover For Tata Tigor")).toBeNull();
  });
});

describe("choosing the next SKU", () => {
  // What is actually on disk: four spellings of the same idea.
  const onDisk = ["ANP001", "ANP002", "ANP003", "GTB-1", "GTB002", "HAL03", "HBD-dore01", "WB001"];

  it("uses ONE format, whatever the old ones look like", () => {
    expect(nextSku("Some Annaprashan Decoration Kit", onDisk)).toBe("ANP004");
    expect(nextSku("Haldi Ceremony Decoration Set", onDisk)).toBe("HAL004");
    expect(nextSku("ZYRIC Happy Birthday Black and Gold Decoration Kit", ["HBD001", "HBD101"])).toBe("HBD102");
  });

  it("gives a character birthday kit two digits, like the listings already live", () => {
    // HBD-dore01 and HBD-dore02 are on Flipkart; he saved the third as HBD-dore03, not HBD-dore003.
    expect(nextSku("Doremon Theme Birthday Kit", ["HBD-dore01", "HBD-dore02"])).toBe("HBD-dore03");
    expect(nextSku("Doremon Theme Birthday Kit", onDisk)).toBe("HBD-dore02");
    // A three-digit sibling from before the rule still counts as taken.
    expect(nextSku("Doremon Theme Birthday Kit", ["HBD-dore01", "HBD-dore003"])).toBe("HBD-dore04");
  });

  it("counts an old spelling as taken, so a new one cannot collide with it", () => {
    // `GTB-1` and `GTB001` are one product. The next GTB must be past both, not equal to either.
    expect(nextSku("Groom To Be Decoration Kit", onDisk)).toBe("GTB003");
  });

  it("hands out a different SKU for every product in one batch", () => {
    // Ten annaprashan kits latched together must not all be ANP004.
    const taken = [...onDisk];
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = nextSku("Annaprashan Decoration Kit", taken)!;
      got.push(s);
      taken.push(s);
    }
    expect(got).toEqual(["ANP004", "ANP005", "ANP006"]);
  });

  it("returns null when it cannot name the line", () => {
    expect(nextSku("KOSY Gift Wrapping Paper Sheet", onDisk)).toBeNull();
  });

  it("starts at 001 for a line we have never sold", () => {
    expect(nextSku("Welcome Home Decoration Kit", onDisk)).toBe("WH001");
  });
});

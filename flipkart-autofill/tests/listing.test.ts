// listing.test.ts — WW-113: a value whose label is on no tab of the scanned form can never be
// filled, and a "not found" count alone cannot tell that apart from "it is on the other tab".
//
// This is the silent half of the Price/Stock bug: four keys in the pricing defaults matched no
// row on the live form, so they sent nothing and reported nothing. The check only speaks when a
// scan exists — an unscanned category must never have its fields accused.

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkValues, fillableValues, loadProduct, mergeScan, padBlanks, PAD_VALUE, productName, ScanTooSmall } from "../src/listing.js";

async function fixture(): Promise<{ file: string; cat: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "ww-unmapped-"));
  const cat = path.join(dir, "cats");
  await mkdir(cat, { recursive: true });
  await writeFile(path.join(cat, "c.defaults.json"), JSON.stringify({ Length: "10", Breadth: "9" }));
  const file = path.join(dir, "p.json");
  await writeFile(file, JSON.stringify({ category: "c", values: { Stock: "100" } }));
  return { file, cat };
}

describe("unmapped labels", () => {
  it("says nothing at all until the category has been scanned", async () => {
    const { file, cat } = await fixture();
    expect(loadProduct(file, cat).unmapped).toEqual([]);
  });

  it("names the values the form has nowhere, and ignores the trailing *", async () => {
    const { file, cat } = await fixture();
    // The scan knows "Length *" and "Stock" — so "Breadth" is the one that can never land.
    await writeFile(
      path.join(cat, "c.json"),
      JSON.stringify({ fields: [{ label: "Length *" }, { label: "Stock" }] }),
    );
    expect(loadProduct(file, cat).unmapped).toEqual(["Breadth"]);
  });

  it("does not double-report a TODO_ placeholder — checkValues already blocks those", async () => {
    const { cat } = await fixture();
    const file = path.join(path.dirname(cat), "todo.json");
    await writeFile(file, JSON.stringify({ category: "c", values: { MRP: "TODO_MRP" } }));
    await writeFile(path.join(cat, "c.json"), JSON.stringify({ fields: [{ label: "Stock" }] }));
    expect(loadProduct(file, cat).unmapped).not.toContain("MRP");
  });

  it("survives a damaged scan file rather than stopping a fill", async () => {
    const { file, cat } = await fixture();
    await writeFile(path.join(cat, "c.json"), "{ not json");
    expect(loadProduct(file, cat).unmapped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WW-110: the Product Description tab. "Items Included" is the long one — nine lines a human
// was retyping — and it is already written, in the Description's WHAT YOU GET block.
describe("Product Description tab, derived", () => {
  const load = async (values: Record<string, unknown>) => {
    const dir = await mkdtemp(path.join(tmpdir(), "ww-derive-"));
    const cat = path.join(dir, "cats");
    await mkdir(cat, { recursive: true });
    const file = path.join(dir, "p.json");
    await writeFile(file, JSON.stringify({ category: "c", values }));
    return loadProduct(file, cat).values;
  };

  const DESC = `Some Kit (3 Pieces) - Birthday Set

An opening paragraph.

WHAT YOU GET (3 Pieces)

1 Happy Birthday Banner

20 Metallic Balloons Red

2 Star Shape Gold Foil Balloons

KEY FEATURES

3 Pieces - covers a full wall`;

  it("takes Items Included from WHAT YOU GET and stops at the next heading", async () => {
    expect((await load({ Description: DESC }))["Items Included"]).toEqual([
      "1 Happy Birthday Banner",
      "20 Metallic Balloons Red",
      "2 Star Shape Gold Foil Balloons",
    ]);
  });

  it("stops on a lower-case heading too — the older files write 'Key Features'", async () => {
    const desc = DESC.replace("KEY FEATURES", "Key Features");
    expect((await load({ Description: desc }))["Items Included"]).toHaveLength(3);
  });

  it("stops on an explanatory paragraph, which two live files put right after the list", async () => {
    const desc = DESC.replace("KEY FEATURES", "The 20 metallic balloons form the arch.");
    expect((await load({ Description: desc }))["Items Included"]).toHaveLength(3);
  });

  it("leaves the field out when the description predates the template", async () => {
    expect((await load({ Description: "A short old description." }))["Items Included"]).toBeUndefined();
  });

  it("never overrides what the product states itself", async () => {
    const v = await load({ Description: DESC, "Items Included": ["1 Thing"], "Model Number": "X" });
    expect(v["Items Included"]).toEqual(["1 Thing"]);
    expect(v["Model Number"]).toBe("X");
  });

  it("Model Number is the SKU — one fact, one source", async () => {
    expect((await load({ "Seller SKU ID": "ANP004" }))["Model Number"]).toBe("ANP004");
  });

  // Vansh, asked which weight the form's "Quantity (g)" means: "the packed parcel, 280 gm".
  // So it is the measured parcel weight the app already has, in the other unit.
  it("Quantity is the measured parcel weight in grams", async () => {
    expect((await load({ Weight: "0.25" }))["Quantity"]).toBe("250");
  });

  it("rounds, because 0.245 * 1000 is 245.00000000000003 and that would be typed in", async () => {
    expect((await load({ Weight: "0.245" }))["Quantity"]).toBe("245");
  });

  it("leaves Quantity blank when the parcel has never been weighed", async () => {
    expect((await load({ "Seller SKU ID": "X" }))["Quantity"]).toBeUndefined();
  });

  it("never overrides a Quantity the product states itself", async () => {
    expect((await load({ Weight: "0.25", Quantity: "280" }))["Quantity"]).toBe("280");
  });
});

// WW-123, properly this time. "Height" is centimetres on the Price/Stock tab and INCHES on
// Additional Description; merging every defaults file into one map typed one number into both.
describe("defaults are per-tab", () => {
  const fixture = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ww-tabs-"));
    const cat = path.join(dir, "cats");
    await mkdir(cat, { recursive: true });
    // The inches tab (the bare file) and the centimetres tab, both claiming "Height".
    await writeFile(path.join(cat, "c.defaults.json"), JSON.stringify({ Height: "1.5", Width: "7" }));
    await writeFile(path.join(cat, "c.pricing.defaults.json"), JSON.stringify({ Height: "4", Stock: "100" }));
    const file = path.join(dir, "p.json");
    await writeFile(file, JSON.stringify({ category: "c", values: {} }));
    return { file, cat };
  };

  it("gives the inches tab its inches and nothing from the centimetres tab", async () => {
    const { file, cat } = await fixture();
    const { values } = loadProduct(file, cat, "");
    expect(values["Height"]).toBe("1.5");
    expect(values["Stock"]).toBeUndefined();
  });

  it("gives the centimetres tab its centimetres — the collision that cost a measured parcel", async () => {
    const { file, cat } = await fixture();
    const { values } = loadProduct(file, cat, "pricing");
    expect(values["Height"]).toBe("4");
    expect(values["Width"]).toBeUndefined();
  });

  it("still merges everything when no tab is named, which is what the CLI does", async () => {
    const { file, cat } = await fixture();
    expect(loadProduct(file, cat).usedDefaults).toHaveLength(2);
  });

  it("a tab with no defaults file of its own gets none, rather than everyone else's", async () => {
    const { file, cat } = await fixture();
    expect(loadProduct(file, cat, "description").usedDefaults).toEqual([]);
  });
});

// WW-110: scanning moved into the app, so the merge is now shared by the CLI and a button.
describe("mergeScan", () => {
  const dir = async () => mkdtemp(path.join(tmpdir(), "ww-scan-"));
  const F = (label: string) => ({ label, kind: "text" as const, multi: false });
  const FIVE = ["a", "b", "c", "d", "e"].map(F);

  it("creates the category file on the first tab", async () => {
    const cat = await dir();
    const r = mergeScan("c", FIVE, cat);
    expect(r.added).toHaveLength(5);
    expect(r.total).toBe(5);
    expect(JSON.parse(await readFile(r.file, "utf8")).fields).toHaveLength(5);
  });

  it("MERGES the next tab rather than replacing it — the reason scanning is per-tab", async () => {
    const cat = await dir();
    mergeScan("c", FIVE, cat);
    const r = mergeScan("c", [...FIVE, F("f"), F("g")], cat);
    expect(r.added.map((f) => f.label)).toEqual(["f", "g"]);
    expect(r.total).toBe(7);
  });

  it("re-scanning a tab changes nothing, so pressing the button twice is safe", async () => {
    const cat = await dir();
    mergeScan("c", FIVE, cat);
    expect(mergeScan("c", FIVE, cat).added).toEqual([]);
  });

  it("refuses a page that is not a form, rather than poisoning the template", async () => {
    const cat = await dir();
    expect(() => mergeScan("c", [F("Search")], cat)).toThrow(ScanTooSmall);
  });

  it("--force is still there for a genuinely tiny tab", async () => {
    const cat = await dir();
    expect(mergeScan("c", [F("Search")], cat, true).total).toBe(1);
  });

  it("a damaged category file is not silently replaced", async () => {
    const cat = await dir();
    await mkdir(cat, { recursive: true });
    await writeFile(path.join(cat, "c.json"), "{ not json");
    expect(() => mergeScan("c", FIVE, cat)).toThrow();
  });
});

// The product name is composed by Flipkart from Color + Type, so it is the most-read text on the
// listing and nothing displayed it before Save. Shown, not spell-checked — see productName().
describe("the name buyers see", () => {
  it("joins the Color values in order and ends on Type", () => {
    const n = productName({ Color: ["First", "Second", "Third"], Type: "Kit" });
    expect(n?.name).toBe("First, Second, Third Kit");
  });

  it("is null when the tab in front does not carry those two fields", () => {
    expect(productName({ Type: "Kit" })).toBeNull();
    expect(productName({ Color: ["First"] })).toBeNull();
  });

  it("flags an ampersand, which arrives in the name as a literal &", () => {
    expect(productName({ Color: ["Sash & Foils"], Type: "Kit" })?.warnings.join()).toMatch(/&/);
  });

  it("flags a word spent twice — both faults were in the same live title", () => {
    const n = productName({ Color: ["Metallic Balloons", "Foil Balloons"], Type: "Kit" });
    expect(n?.warnings.join()).toMatch(/balloons/i);
  });

  it("does not flag short joining words, which repeat harmlessly", () => {
    const n = productName({ Color: ["Red and Gold", "Sash and Curtain"], Type: "Kit" });
    expect(n?.warnings).toEqual([]);
  });
});

// Vansh, 2026-08-12: "if any confusion take my permission, flag it somewhere". Rule 1 tells
// ChatGPT to omit rather than invent — but an omission made from doubt and one made from
// oversight are the same empty box, and only this tells them apart.
describe("_ask, the questions raised instead of guesses made", () => {
  const load = async (values: Record<string, unknown>, defaults?: Record<string, unknown>) => {
    const dir = await mkdtemp(path.join(tmpdir(), "ww-ask-"));
    const cat = path.join(dir, "cats");
    await mkdir(cat, { recursive: true });
    if (defaults) await writeFile(path.join(cat, "c.defaults.json"), JSON.stringify(defaults));
    const file = path.join(dir, "p.json");
    await writeFile(file, JSON.stringify({ category: "c", values }));
    return loadProduct(file, cat);
  };

  it("carries the questions out, and never types them into the form", async () => {
    const r = await load({ _ask: ["Which occasion is this?"], Stock: "100" });
    expect(r.asks).toEqual(["Which occasion is this?"]);
    expect(r.values["_ask"]).toBeUndefined();
  });

  it("takes a bare string as readily as a list", async () => {
    expect((await load({ _ask: "One question" })).asks).toEqual(["One question"]);
  });

  it("ignores every OTHER underscore key — the defaults files are full of prose", async () => {
    const r = await load({ Stock: "1" }, { _comment: ["a paragraph", "and another"], Height: "4" });
    expect(r.asks).toEqual([]);
    expect(r.values["_comment"]).toBeUndefined();
  });

  it("says nothing when there was nothing to ask", async () => {
    expect((await load({ Stock: "100" })).asks).toEqual([]);
  });
});

// The failure mode that does not stay in its own field: Flipkart posts the whole listing on every
// edit, so one character its backend cannot store makes "Could not save your changes" appear on
// every field afterwards, on every tab. Proven once by deleting a Description on a live listing.
describe("characters Flipkart's server cannot store", () => {
  it("catches an emoji, and says which character", () => {
    const p = checkValues({ Description: "Key Features\n\n🎈 52 Pieces" });
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe("nonascii");
    expect(p[0].value).toContain("U+1F388");
  });

  it("catches an en-dash, which is the easy one to miss", () => {
    expect(checkValues({ Design: "Red – Gold" })[0]?.value).toContain("U+2013");
  });

  it("leaves the field blank rather than filling it — a save that always fails is worse", () => {
    const values = { Description: "🎈", Stock: "100" };
    expect(Object.keys(fillableValues(values, checkValues(values)))).toEqual(["Stock"]);
  });

  it("allows the newlines a Description is supposed to have", () => {
    expect(checkValues({ Description: "One line\n\nAnother line" })).toEqual([]);
  });

  it("reports one character per field, not one per occurrence", () => {
    expect(checkValues({ Description: "🎈🎁✨" })).toHaveLength(1);
  });
});

// Weight is kilograms, but grams is the unit everything else here uses — so writing 250 where
// 0.250 belongs is a slip anyone makes once, and multiplying it declares 250 kg on a balloon kit.
describe("Quantity refuses a Weight that cannot be kilograms", () => {
  const load = async (values: Record<string, unknown>) => {
    const dir = await mkdtemp(path.join(tmpdir(), "ww-kg-"));
    const cat = path.join(dir, "cats");
    await mkdir(cat, { recursive: true });
    const file = path.join(dir, "p.json");
    await writeFile(file, JSON.stringify({ category: "c", values }));
    return loadProduct(file, cat).values;
  };

  it("converts a real parcel weight", async () => {
    expect((await load({ Weight: "0.25" }))["Quantity"]).toBe("250");
  });

  it("leaves the box EMPTY when the figure is grams wearing a kilogram label", async () => {
    // 250 kg on a balloon kit. Blank is visible; 250000 looks filled and is wrong.
    expect((await load({ Weight: "250" }))["Quantity"]).toBeUndefined();
  });

  it("still allows a genuinely heavy parcel, so the guard refuses nothing real", async () => {
    expect((await load({ Weight: "1.4" }))["Quantity"]).toBe("1400");
  });
});

// A hand-typed row is a placeholder: someone read the label off the live form and guessed the
// widget. When a real scan finally reaches that tab, the guess must give way — otherwise the
// placeholder blocks the measurement forever and "nothing new" reads as confirmation.
describe("a real scan replaces a typed-in guess", () => {
  const dir = async () => mkdtemp(path.join(tmpdir(), "ww-corr-"));
  const F = (label: string, kind = "text") => ({ label, kind, multi: false } as never);
  const FIVE = ["a", "b", "c", "d", "e"].map((l) => F(l));

  it("overwrites a row carrying `source`, and says so", async () => {
    const cat = await dir();
    const typed = { label: "Type *", kind: "text", multi: false, source: "typed by hand" };
    mergeScan("c", [...FIVE, typed as never], cat);
    const r = mergeScan("c", [...FIVE, { label: "Type *", kind: "combobox", multi: false } as never], cat);
    expect(r.added).toEqual([]);
    expect(r.corrected).toHaveLength(1);
    const saved = JSON.parse(await readFile(r.file, "utf8"));
    const row = saved.fields.find((f: { label: string }) => f.label === "Type *");
    expect(row.kind).toBe("combobox");
    expect(row.source).toBeUndefined(); // the marker goes with the guess
    expect(r.total).toBe(6); // replaced, never duplicated
  });

  it("leaves a genuinely scanned row alone — a re-scan must not churn the file", async () => {
    const cat = await dir();
    mergeScan("c", [...FIVE, F("Type *", "combobox")], cat);
    const r = mergeScan("c", [...FIVE, F("Type *", "text")], cat);
    expect(r.corrected).toEqual([]);
    const saved = JSON.parse(await readFile(r.file, "utf8"));
    expect(saved.fields.find((f: { label: string }) => f.label === "Type *").kind).toBe("combobox");
  });
});

// Flipkart's length limits, which nothing shows until it refuses to save: Color counts the SUM
// of its values (80), Key Spec counts EACH one (22). Both errors were seen on a real listing.
describe("Flipkart's character limits", () => {
  it("catches Color over 80 characters across all its phrases", () => {
    const p = checkValues({ Color: ["Annaprasan Ceremony", "Gold Metallic and White Latex Balloon Decoration", "Heart Shape Red Foil with Fringe Backdrop"] });
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe("toolong");
    expect(p[0].value).toContain("108");
  });

  it("counts Color values only — not the separators Flipkart adds between them", () => {
    expect(checkValues({ Color: ["12345678901234567890", "12345678901234567890", "1234567890123456789012345678901234567890"] })).toEqual([]);
  });

  it("catches a single Key Spec entry over 22, and names that entry", () => {
    const p = checkValues({ "Key Spec": ["50 Balloons", "15 Gold Metallic Balloons"] });
    expect(p).toHaveLength(1);
    expect(p[0].value).toContain("15 Gold Metallic Balloons");
  });

  it("leaves an over-length field blank when NOTHING in it fits", () => {
    const values = { "Key Spec": ["4 Heart Shape Red Foil Balloons"], Stock: "100" };
    expect(Object.keys(fillableValues(values, checkValues(values)))).toEqual(["Stock"]);
  });

  /**
   * Vansh, on a live listing: *"why are we not filling this??"* One entry over 22 characters was
   * costing the whole field — and eight of the product files in this repo have exactly that, most
   * with only one entry over. Key Spec shows under the title, so those eight listings were missing
   * a buyer-visible line because of one word too many.
   */
  it("keeps the Key Spec entries that fit and drops only the ones that do not", () => {
    const values = {
      // 21, 25 and 18 characters.
      "Key Spec": ["16 Photo Booth Props", "15 Gold Metallic Balloons", "1 Foil Curtain"],
      Stock: "100",
    };
    expect(fillableValues(values, checkValues(values))["Key Spec"]).toEqual([
      "16 Photo Booth Props",
      "1 Foil Curtain",
    ]);
  });

  it("never shortens an entry to make it fit — two true specs beat three with a lie", () => {
    const values = { "Key Spec": ["20 Red and 20 Gold Balloons", "4 Star Foils"] };
    const kept = fillableValues(values, checkValues(values))["Key Spec"] as string[];
    expect(kept).toEqual(["4 Star Foils"]);
    expect(kept.some((s) => s.startsWith("20 Red"))).toBe(false);
  });

  /**
   * `Color` counts the SUM of its entries, not each one, so dropping entries there would change
   * what colour the product is. The per-entry rule must not reach it.
   */
  it("does not thin out a field whose limit is the total, only one whose limit is per entry", () => {
    const values = { Color: ["Red", "Gold", "x".repeat(90)] };
    expect(Object.keys(fillableValues(values, checkValues(values)))).toEqual([]);
  });
});

// padBlanks fills the 31 attributes a balloon kit shares with hand fans and
// crackers. What it must NOT touch is the whole point — a pad in a numeric box makes Flipkart
// reject the entire save, and a pad in MRP is a live listing carrying a fake price.
describe("padBlanks", () => {
  const cat = path.join(tmpdir(), "ww-pad-cats");
  const fields = [
    { label: "Mouthpiece Material", kind: "pills" },
    { label: "Tube Shape", kind: "text" },
    { label: "Theme", kind: "pills" },
    { label: "MRP *", kind: "text" },
    { label: "Local handling fee", kind: "text" },
    { label: "EAN/UPC", kind: "pills" },
    { label: "Video URL", kind: "text" },
    { label: "Diameter", kind: "text" },
    { label: "Handle", kind: "combobox" },
    { label: "Weight (unit)", kind: "combobox", companion: true },
    { label: "FSN", kind: "text", furniture: true },
  ];

  it("pads only the blank, optional, free-text attributes", async () => {
    await mkdir(cat, { recursive: true });
    await writeFile(path.join(cat, "c.json"), JSON.stringify({ category: "c", fields }));
    const pads = padBlanks({ Theme: ["Birthday"] }, "c", cat);
    expect(Object.keys(pads)).toEqual(["Mouthpiece Material", "Tube Shape"]);
    expect(pads["Mouthpiece Material"]).toBe(PAD_VALUE);
    expect(pads.Theme).toBeUndefined(); // a stated value is never overwritten
    // Never: required, money, identifiers, numbers, fixed option lists, page furniture.
    for (const k of ["MRP *", "MRP", "Local handling fee", "EAN/UPC", "Video URL", "Diameter", "Handle", "Weight (unit)", "FSN"]) {
      expect(pads[k]).toBeUndefined();
    }
  });

  // The bug this catches: a value dropped by checkValues (Key Spec over 22 chars, a Devanagari
  // Character) is STATED and WRONG. Padding it writes "Not Applicable" onto a live listing and
  // makes the warning the operator is meant to act on look answered.
  it("leaves a stated-but-rejected field alone rather than padding over the warning", async () => {
    await mkdir(cat, { recursive: true });
    await writeFile(
      path.join(cat, "c.json"),
      JSON.stringify({ category: "c", fields: [...fields, { label: "Key Spec", kind: "pills" }] }),
    );
    const stated = { "Key Spec": ["a value far longer than twenty-two characters"] };
    const problems = checkValues(stated);
    expect(problems).toHaveLength(1);
    expect(padBlanks(stated, "c", cat)["Key Spec"]).toBeUndefined();
    // …and fillableValues, which is the only path all three front doors take, keeps it out.
    expect(Object.keys(fillableValues(stated, problems, "c", cat))).not.toContain("Key Spec");
  });

  // Padding is the DEFAULT now, so the guard that matters is that it happens in the one place
  // every front door shares (npm start, the app's Fill button, npm run fill) rather than three.
  it("pads through fillableValues when given a category, and not when it is not", async () => {
    await mkdir(cat, { recursive: true });
    await writeFile(path.join(cat, "c.json"), JSON.stringify({ category: "c", fields }));
    const stated = { Theme: ["Birthday"] };
    expect(Object.keys(fillableValues(stated, [], null, cat))).toEqual(["Theme"]);
    const padded = fillableValues(stated, [], "c", cat);
    expect(padded.Theme).toEqual(["Birthday"]);
    expect(padded["Mouthpiece Material"]).toBe(PAD_VALUE);
  });

  it("pads nothing when the category has never been scanned", () => {
    expect(padBlanks({}, "never-scanned", cat)).toEqual({});
  });

  // The regression padding introduced, and the reason padBlanks reads the defaults files itself.
  // `loadProduct(file, _, tab)` loads ONE defaults file, so filling the Price/Stock tab leaves
  // Precautions out of `values` entirely — it is answered, just not on that tab. Padding on that
  // basis types "N/A" over it the moment somebody presses the wrong tab's Fill button, which
  // Flipkart.tsx promises cannot happen.
  it("never pads a label answered by another tab's defaults file", async () => {
    await mkdir(cat, { recursive: true });
    await writeFile(
      path.join(cat, "c.json"),
      JSON.stringify({ category: "c", fields: [...fields, { label: "Precautions", kind: "pills" }] }),
    );
    await writeFile(path.join(cat, "c.defaults.json"), JSON.stringify({ Precautions: ["Keep away from fire"] }));
    // The Price/Stock load: Precautions is nowhere in `stated`, and must still not be padded.
    expect(padBlanks({ Stock: "100" }, "c", cat)["Precautions"]).toBeUndefined();
    await rm(path.join(cat, "c.defaults.json"));
  });
});

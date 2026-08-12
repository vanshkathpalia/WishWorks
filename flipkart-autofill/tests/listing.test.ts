// listing.test.ts — WW-113: a value whose label is on no tab of the scanned form can never be
// filled, and a "not found" count alone cannot tell that apart from "it is on the other tab".
//
// This is the silent half of the Price/Stock bug: four keys in the pricing defaults matched no
// row on the live form, so they sent nothing and reported nothing. The check only speaks when a
// scan exists — an unscanned category must never have its fields accused.

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadProduct, mergeScan, productName, ScanTooSmall } from "../src/listing.js";

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

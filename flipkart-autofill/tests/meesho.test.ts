/**
 * meesho.test.ts — the Meesho bulk sheet: reading ChatGPT's two replies, the price, and writing
 * Meesho's REAL template without disturbing anything but the data rows.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  LISTS, checkCopy, fillSheet, meeshoPrice, missing, numberOfItems, packText, parseCopy, parsePicks, sheetRow, withPack,
} from "../src/meesho-core.js";

const HERE = import.meta.dirname;
const TEMPLATE = readFileSync(path.join(HERE, "..", "categories", "meesho-party-items.xlsx"));
const FIXED = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(path.join(HERE, "..", "categories", "meesho-sheet.json"), "utf8"))).filter(([k]) => !k.startsWith("_")),
) as Record<string, string | number>;
// Newlines normalised: Windows checks these files out with CRLF, and every slot in them is matched
// on "\n" — that alone failed v1.7.7's CI on Windows while every Mac run passed.
const guide = (n: string) =>
  readFileSync(path.join(HERE, "..", "..", "docs", "guides", n), "utf8").replace(/\r\n/g, "\n");

const REPLY = `=== PRODUCT NAME ===
Annaprashan Decoration Kit | Red Gold Metallic Balloons | Heart Foil Banner (Set of 3 Pcs)

=== DESCRIPTION ===
Annaprashan decoration kit with 3 pieces for a home ceremony.

What you get:
1 Banner
2 Red Metallic Latex Balloons


Perfect for:
Room Decoration

=== PACK CONTENTS ===
1 Annaprashan Banner,   2 Red Metallic Balloons`;

describe("reading the replies", () => {
  it("splits the three blocks, keeping the description's lines", () => {
    const c = parseCopy(REPLY)!;
    expect(c.name).toBe("Annaprashan Decoration Kit | Red Gold Metallic Balloons | Heart Foil Banner (Set of 3 Pcs)");
    expect(c.description).toContain("What you get:\n1 Banner\n2 Red");
    expect(c.description).not.toContain("\n\n\n");
    expect(c.contents).toBe("1 Annaprashan Banner, 2 Red Metallic Balloons");
  });

  it("is null when a block is missing", () => {
    expect(parseCopy("=== PRODUCT NAME ===\nx")).toBeNull();
  });

  it("keeps only picks that are on the dropdown", () => {
    const p = parsePicks("**Color:** red\nOccasion: Baby Shower\nType: Decorations\n- Material: Plastic");
    expect(p).toEqual({ Color: "Red", Type: "Decorations", Material: "Plastic" });
  });

  it("flags a name whose piece count disagrees with the kit", () => {
    expect(checkCopy(parseCopy(REPLY)!, 3)).toEqual([]);
    expect(checkCopy(parseCopy(REPLY)!, 54)).toEqual(["name says 3 pieces, the kit has 54"]);
  });
});

describe("the prompts", () => {
  it("PROMPT-meesho-only still has the pack slot", () => {
    expect(withPack(guide("PROMPT-meesho-only.md"), packText([{ item: "Red Balloons", qty: 20 }]))).toContain("\n20 Red Balloons\n");
  });

  it("PROMPT-meesho-sheet offers exactly the dropdowns the code accepts", () => {
    const text = guide("PROMPT-meesho-sheet.md");
    for (const [field, values] of Object.entries(LISTS)) {
      expect(new RegExp(`^${field}: (.+)$`, "m").exec(text)?.[1].split(", ")).toEqual([...values]);
    }
  });
});

describe("the numbers", () => {
  it("prices at materials + markup + 5% GST, rounded up", () => {
    expect(meeshoPrice(100_00, 60_00)).toBe(168);
    expect(meeshoPrice(100_01, 60_00)).toBe(169);
  });

  it("maps a piece count onto the Number of Items dropdown", () => {
    expect(numberOfItems(49)).toBe("49");
    expect(numberOfItems(54)).toBe("50 & Above");
  });
});

describe("the sheet", () => {
  const row = sheetRow({
    fixed: FIXED, sku: "ANP004", copy: parseCopy(REPLY), pricePaise: 168_00, pieces: 3, grams: 250,
    picks: { Color: "Red", "Generic Name": "Party Decoration Kit", Occasion: "Baby & Expecting", Type: "Decorations", Material: "Plastic", "Recommended Age": "10+ Years" },
  });

  it("a full row is missing nothing a person has to type", () => {
    expect(missing(row)).toEqual([]);
    expect(row["Wrong/Defective Returns Price"]).toBe(154);
    expect(row["Importer Name"]).toBe("Not Required");
  });

  it("writes rows under the right headers and leaves the rest of the workbook alone", () => {
    const before = unzipSync(TEMPLATE);
    const after = unzipSync(fillSheet(TEMPLATE, [row, { ...row, "SKU ID": "ANP005", "Product Name": "A & <B>" }]));
    const xml = strFromU8(after["xl/worksheets/sheet5.xml"]);
    const cell = (ref: string) => new RegExp(`<c r="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(xml)?.[1];

    expect(cell("D5")).toContain("Annaprashan Decoration Kit");
    expect(cell("F5")).toBe("<v>168</v>");
    expect(cell("G5")).toBe("<v>154</v>");
    expect(cell("J5")).toContain("950300");
    expect(cell("AI5")).toContain("ANP004");
    expect(cell("AI6")).toContain("ANP005");
    expect(cell("D6")).toContain("A &amp; &lt;B&gt;");
    expect(xml).toContain('<dataValidations count="672">');
    for (const f of Object.keys(before)) if (f !== "xl/worksheets/sheet5.xml") expect(after[f]).toEqual(before[f]);
  });

  it("refuses a column the template does not have", () => {
    expect(() => fillSheet(TEMPLATE, [{ "Not A Column": "x" }])).toThrow('no "Not A Column" column');
  });
});

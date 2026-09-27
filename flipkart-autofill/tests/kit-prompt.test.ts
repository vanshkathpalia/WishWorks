/** kit-prompt.test.ts — the counted inventory the image prompts quote, and the READY check on the reply. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkReady, countKit, kitBlock, readyLine, withKit } from "../src/kit-prompt.js";

const guide = (n: string) => readFileSync(path.join(__dirname, "../../docs/guides", n), "utf8");

const lines = [
  { item: "White Balloons", qty: 15 },
  { item: "Blue Star Foil", qty: 3 },
  { item: "Arch Tape", qty: 1 },
  { item: "Flipkart Polybag", qty: 1 },
  { item: "Glue Dots", qty: 1 }, // unmatched: falls back to the word list
];
const resolved = { 0: "Balloon|White Balloon", 1: "Foil Balloon|Blue Star Foil", 2: "Adhesive|Arch Tape", 3: "Packaging|Flipkart Polybag 9x12" };

describe("countKit", () => {
  const c = countKit(lines, resolved, (m) => (m === "Blue Star Foil" ? "18 inch" : undefined));

  it("splits shown from assembly aids and leaves packaging out of the box", () => {
    expect(c.displayed).toEqual([{ qty: 15, name: "White Balloons" }, { qty: 3, name: "Blue Star Foil (18 inch)" }]);
    expect(c.aids.map((a) => a.name)).toEqual(["Arch Tape", "Glue Dots"]);
    expect([c.displayedPieces, c.totalPieces]).toEqual([18, 20]);
  });

  it("writes both totals into the block, numbered once across both lists", () => {
    const b = kitBlock("HBD001", c);
    expect(b).toContain("1. 15 x White Balloons");
    expect(b).toContain("4. 1 x Glue Dots");
    expect(b).toContain("TOTAL PIECES IN THE BOX: 20 (displayed 18 + assembly aids 2)");
  });
});

describe("withKit", () => {
  it("fills every image prompt that asks for the inventory, and no slot survives", () => {
    for (const f of ["PROMPT-kit-list.md", "PROMPT-infographic.md", "PROMPT-infographic-sizes.md"]) {
      const out = withKit(guide(f), "THE KIT");
      expect(out, f).toContain("THE KIT");
      expect(out, f).not.toMatch(/PASTE INVENTORY|paste your typed inventory|<KIT INVENTORY>/);
    }
  });
});

describe("checkReady", () => {
  const c = countKit(lines, resolved);
  it("passes the exact line, even with a different dash", () => {
    expect(checkReady(readyLine(c), c)).toBeNull();
    expect(checkReady("READY - 4 lines, 18 displayed pieces, 20 total pieces", c)).toBeNull();
  });
  it("stops on a wrong count or no READY line", () => {
    expect(checkReady("READY — 4 lines, 17 displayed pieces, 20 total pieces", c)).toMatch(/17 displayed/);
    expect(checkReady("Sure! Here is the image.", c)).toMatch(/did not confirm/);
  });
});

describe("the prompt ends where the check reads", () => {
  it("asks for the READY line checkReady parses", () => {
    expect(guide("PROMPT-kit-list.md")).toMatch(/^READY — <number of lines> lines, <displayed pieces> displayed pieces, <total pieces> total pieces$/m);
  });
});

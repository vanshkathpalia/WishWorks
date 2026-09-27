/** new-listing-flow.test.ts — the job book, who can start, and which button lights up next. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockedBy, candidates, fail, listingImages, nextPress, update, type JobBook } from "../src/new-listing-flow.js";
import { countCheck, countKit, isHeroPrompt, redoPrompt } from "../src/kit-prompt.js";

const t = new Date("2026-09-27T10:00:00Z");

describe("the job book", () => {
  it("adds a row, logs each stage, and remembers where a failure happened", () => {
    let b: JobBook = { jobs: [] };
    b = update(b, "ANP004", { stage: "images" }, "making images", t);
    b = update(b, "ANP004", { images: { "1": "1.png" } }, "image 1", t);
    b = fail(b, "ANP004", "ChatGPT did not take the message", );
    const j = b.jobs[0];
    expect(j).toMatchObject({ stage: "failed", failedAt: "images", images: { "1": "1.png" } });
    expect(j.log).toHaveLength(3);
    expect(j.log[0]).toBe("2026-09-27 10:00 making images");
  });

  it("lists kits not yet on Flipkart first, and says why one cannot start", () => {
    const c = candidates(["HBD101", "ANP004", "WB009"], (s) => s === "HBD101", (s) => (s === "WB009" ? null : `${s}/2.png`), { jobs: [] });
    expect(c.map((x) => x.sku)).toEqual(["ANP004", "WB009", "HBD101"]);
    expect(c.map(blockedBy)).toEqual([null, "no inventory photo (2.png or contents.jpg) in its folder", "already live on Flipkart"]);
  });

  it("lights up the right button at each stage", () => {
    const job = (stage: never, images = {}) => ({ sku: "A", stage, images, log: [], updatedAt: "" });
    expect(nextPress(null)).toBe("start");
    expect(nextPress(job("images" as never))).toBeNull();
    expect(nextPress(job("review" as never, { "1": "a" }))).toBe("review");
    expect(nextPress(job("review" as never, { "1": "a", "2": "b" }))).toBe("continue");
    expect(nextPress(job("done" as never))).toBe("open-draft");
    expect(nextPress(job("failed" as never))).toBe("retry");
    expect(listingImages(job("review" as never, { "2": "b", "1": "a", "3": "c" }))).toEqual(["a", "b", "c"]);
  });
});

describe("the hero's count check and the redo prompt", () => {
  const guide = (n: string) => readFileSync(path.join(__dirname, "../../docs/guides", n), "utf8");
  it("puts every displayed line under the hero, and only the hero", () => {
    const c = countKit([{ item: "Red Balloons", qty: 20 }, { item: "Arch Tape", qty: 1 }, { item: "Red Heart Foil", qty: 8 }]);
    const check = countCheck(c);
    expect(check).toContain("- 20 x Red Balloons");
    expect(check).toContain("- 8 x Red Heart Foil");
    expect(check).not.toContain("Arch Tape");
    expect(check).toContain("That is 28 pieces.");
    expect(isHeroPrompt("PROMPT-main-image.md")).toBe(true);
    expect(isHeroPrompt("PROMPT-infographic.md")).toBe(false);
  });
  it("fills the redo prompt's two slots and refuses one that lost them", () => {
    const out = redoPrompt(guide("PROMPT-redo-image.md"), 1, "6 hearts, the kit has 8");
    expect(out).toContain("Make image 1 again");
    expect(out).toContain("6 hearts, the kit has 8");
    expect(out).not.toMatch(/<IMAGE NUMBER>|<WHAT IS WRONG>/);
    expect(() => redoPrompt("no slots", 1, "x")).toThrow(/lost/);
  });
});

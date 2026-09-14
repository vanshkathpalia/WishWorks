/**
 * supplier-words.test.ts — asking an AI once what the supplier's words mean.
 *
 * The reply is a conversation turn, not an API response, so the parsing is deliberately tolerant of
 * how it is wrapped and deliberately intolerant of what is in it: a malformed rule APPLIED is worse
 * than a rule missed, because a word rule rewrites every future note silently.
 */

import { describe, it, expect } from "vitest";
import { applyProposal, buildPrompt, readProposal, reviewProposal } from "../src/supplier-words.js";
import type { Material } from "../src/inventory-core.js";

const materials: Material[] = [
  { category: "Fringes", material: "Red Fringes", paise: 100 },
  { category: "Sash", material: "GTB Sash", paise: 100 },
] as Material[];

describe("building the ask", () => {
  it("sends our list and his note, with the instructions on top", () => {
    const p = buildPrompt("INSTRUCTIONS", materials, "  10 pkt red kt ok  ");
    expect(p).toContain("INSTRUCTIONS");
    expect(p).toContain("Fringes | Red Fringes");
    expect(p).toContain("10 pkt red kt ok");
  });
});

describe("reading the reply", () => {
  const good = '```json\n{"words":{"KT":"Fringe"},"aliases":[{"material":"GTB Sash","says":"groom to be sesh"}],"new":["brown retro t"],"split":[],"unsure":[{"line":"x","why":"y"}]}\n```';

  it("takes the JSON out of a fenced block and lowercases the word rules", () => {
    const p = readProposal(good);
    expect(p.words).toEqual({ kt: "fringe" });
    expect(p.aliases).toEqual([{ material: "GTB Sash", says: "groom to be sesh" }]);
    expect(p.new).toEqual(["brown retro t"]);
    expect(p.unsure).toEqual([{ line: "x", why: "y" }]);
  });

  it("copes with prose around a bare object", () => {
    expect(readProposal('Sure! {"words":{"hb":"hbd"}} Hope that helps.').words).toEqual({ hb: "hbd" });
  });

  it("returns nothing rather than half a proposal when the reply is not JSON", () => {
    expect(readProposal("I could not work that out.").words).toEqual({});
  });

  it("drops a rule that maps a word to itself, which is not a rule", () => {
    expect(readProposal('{"words":{"red":"red","kt":"fringe"}}').words).toEqual({ kt: "fringe" });
  });

  it("drops a split that names only one thing, which is not a split", () => {
    expect(readProposal('{"split":[{"line":"a","means":["one"]}]}').split).toEqual([]);
  });
});

describe("checking it against the real list", () => {
  it("refuses an alias for a row that does not exist", () => {
    // The model is told not to invent materials and mostly does not. "Mostly" is not a property you
    // can build a price list on, so it is checked rather than trusted.
    const r = reviewProposal(
      { words: {}, aliases: [{ material: "Purple Sash", says: "purple sesh" }], new: [], split: [], unsure: [] },
      materials,
    );
    expect(r[0].blockedBy).toBe("no such row on the price list");
  });

  it("passes an alias that names a real row, and corrects its casing", () => {
    const r = reviewProposal(
      { words: {}, aliases: [{ material: "gtb sash", says: "groom to be sesh" }], new: [], split: [], unsure: [] },
      materials,
    );
    expect(r[0]).toMatchObject({ to: "GTB Sash", blockedBy: "" });
  });

  it("says when a word rule would overwrite one already taught", () => {
    // Changing a rule is not the same as adding one: everything matched under the old rule silently
    // re-reads. Worth seeing before it is ticked.
    const r = reviewProposal(
      { words: { kt: "bunting" }, aliases: [], new: [], split: [], unsure: [] },
      materials,
      { kt: "fringe" },
    );
    expect(r[0].replaces).toBe("fringe");
  });
});

describe("applying what was ticked", () => {
  const taught = { kt: "fringe" };

  it("puts a word rule in the words file and an alias on its row", () => {
    // Two kinds of fact, two homes. A word is about how the supplier talks; an alias is about one
    // row of the price list and belongs beside its price.
    const r = applyProposal(
      [
        { kind: "word", from: "jhalar", to: "fringe", blockedBy: "" },
        { kind: "alias", from: "groom to be sesh", to: "GTB Sash", blockedBy: "" },
      ],
      materials,
      taught,
    );
    expect(r.words).toEqual({ kt: "fringe", jhalar: "fringe" });
    expect(r.materials.find((m) => m.material === "GTB Sash")!.aka).toEqual(["groom to be sesh"]);
    expect(r.added).toBe(2);
  });

  it("applies nothing that was blocked", () => {
    const r = applyProposal(
      [{ kind: "alias", from: "x", to: "Purple Sash", blockedBy: "no such row on the price list" }],
      materials,
      taught,
    );
    expect(r.added).toBe(0);
    expect(r.words).toEqual(taught);
  });

  it("does not add an alias the row already has, in any casing", () => {
    // The price list refuses two rows claiming one name, so a duplicate alias would fail its own
    // uniqueness check on the next load.
    const withAka = materials.map((m) =>
      m.material === "GTB Sash" ? { ...m, aka: ["Groom To Be Sesh"] } : m,
    );
    const r = applyProposal(
      [{ kind: "alias", from: "groom to be sesh", to: "GTB Sash", blockedBy: "" }],
      withAka,
      taught,
    );
    expect(r.materials.find((m) => m.material === "GTB Sash")!.aka).toEqual(["Groom To Be Sesh"]);
    expect(r.added).toBe(0);
  });

  it("leaves the original list untouched", () => {
    // The caller writes the file; a function that mutated its input would corrupt the in-memory
    // list of anything that had already loaded it.
    applyProposal([{ kind: "alias", from: "x", to: "GTB Sash", blockedBy: "" }], materials, taught);
    expect(materials.find((m) => m.material === "GTB Sash")!.aka).toBeUndefined();
  });
});

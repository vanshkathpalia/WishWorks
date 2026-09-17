/**
 * share.test.ts — moving inventory knowledge between two computers without losing either side's.
 *
 * The rules under test: import only ADDS; a different price, a name used elsewhere, or a word that
 * means something else is reported and left alone; importing twice changes nothing; and on a
 * packaged app, where the price list is read-only, a new row lands in the overlay file.
 */

import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadMaterials, type Material } from "../src/inventory-core.js";
import { applyImport, buildExport, describeClashes, planImport, readInventoryFile } from "../src/share-core.js";

const row = (category: string, material: string, paise: number | null, extra: Partial<Material> = {}): Material => ({
  category, material, paise, ...extra,
});

function machine(materials: Material[], words: Record<string, string> = {}, aliases: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ww-share-"));
  writeFileSync(path.join(dir, "materials.json"), JSON.stringify({ materials }));
  const where = {
    categoriesDir: dir,
    editsFile: path.join(dir, "price-edits.json"),
    wordsFile: path.join(dir, "words.json"),
    aliasesFile: path.join(dir, "aliases.json"),
  };
  writeFileSync(where.wordsFile, JSON.stringify(words));
  writeFileSync(where.aliasesFile, JSON.stringify(aliases));
  const read = () => ({
    materials: loadMaterials(dir, where.editsFile),
    words: JSON.parse(readFileSync(where.wordsFile, "utf8")),
    aliases: JSON.parse(readFileSync(where.aliasesFile, "utf8")),
  });
  return { dir, where, read };
}

describe("sharing inventory between two computers", () => {
  const partner = buildExport(
    "Partner",
    [
      row("Balloon", "Golden Balloon", 1400),
      row("Foil Balloon", "Unicorn Foil", 3500, { packOf: 5, aka: ["unicorn foil balloon"] }),
      row("Fringes", "Golden Balloon", 900), // same name as a Balloon row here
    ],
    { kt: "fringe", jhalar: "fringe", bada: "small" },
    { "unicorn wala": "Foil Balloon|Unicorn Foil", "nothing here": "Net|Pink Net" },
  );

  it("adds what is new, and reports — never applies — what differs", async () => {
    const me = machine([row("Balloon", "Golden Balloon", 1200)], { kt: "fringe", bada: "big" });
    const plan = planImport(me.read(), readInventoryFile(JSON.stringify(partner)));

    expect(plan.addMaterials.map((m) => m.material)).toEqual(["Unicorn Foil"]);
    expect(plan.priceClashes).toEqual([{ key: "Balloon|Golden Balloon", mine: 1200, theirs: 1400 }]);
    expect(plan.nameClashes).toEqual([{ theirs: "Fringes|Golden Balloon", mine: "Balloon|Golden Balloon" }]);
    expect(plan.addWords).toEqual({ jhalar: "fringe" });
    expect(plan.wordClashes).toEqual([{ word: "bada", mine: "big", theirs: "small" }]);
    // Points at a row that will exist after import -> added; at a row nobody has -> dropped.
    expect(plan.addAliases).toEqual({ "unicorn wala": "Foil Balloon|Unicorn Foil" });
    expect(describeClashes(plan, "Partner")).toContain("Golden Balloon: yours ₹12, Partner's ₹14 — not changed");

    const done = await applyImport(plan, me.where);
    expect(done).toEqual({ materials: 1, words: 1, aliases: 1, refused: [] });
    const after = me.read();
    expect(after.materials.find((m) => m.material === "Golden Balloon")?.paise).toBe(1200);
    expect(after.materials.find((m) => m.material === "Unicorn Foil")).toMatchObject({ paise: 3500, packOf: 5, aka: ["unicorn foil balloon"] });
    expect(after.words).toEqual({ kt: "fringe", bada: "big", jhalar: "fringe" });
  });

  it("changes nothing the second time the same file is imported", async () => {
    const me = machine([row("Balloon", "Golden Balloon", 1200)]);
    await applyImport(planImport(me.read(), partner), me.where);
    const once = JSON.stringify(me.read());
    const again = planImport(me.read(), partner);
    expect(again.addMaterials).toEqual([]);
    expect(await applyImport(again, me.where)).toEqual({ materials: 0, words: 0, aliases: 0, refused: [] });
    expect(JSON.stringify(me.read())).toBe(once);
  });

  it("on an installed app, where the price list is read-only, puts new rows in the overlay", async () => {
    const me = machine([row("Balloon", "Golden Balloon", 1200)]);
    chmodSync(path.join(me.dir, "materials.json"), 0o444);
    await applyImport(planImport(me.read(), partner), me.where);
    const overlay = JSON.parse(readFileSync(me.where.editsFile, "utf8"));
    expect(overlay.added.map((m: Material) => m.material)).toEqual(["Unicorn Foil"]);
    expect(me.read().materials.map((m) => m.material)).toContain("Unicorn Foil");
  });

  it("refuses a file that is not an export, in words", () => {
    expect(() => readInventoryFile("hello")).toThrow(/not even JSON/);
    expect(() => readInventoryFile(JSON.stringify({ materials: [] }))).toThrow(/not an inventory export/);
  });
});

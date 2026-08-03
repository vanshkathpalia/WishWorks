// listing.test.ts — WW-113: a value whose label is on no tab of the scanned form can never be
// filled, and a "not found" count alone cannot tell that apart from "it is on the other tab".
//
// This is the silent half of the Price/Stock bug: four keys in the pricing defaults matched no
// row on the live form, so they sent nothing and reported nothing. The check only speaks when a
// scan exists — an unscanned category must never have its fields accused.

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadProduct } from "../src/listing.js";

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

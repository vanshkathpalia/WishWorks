/**
 * delivery-e2e.test.ts — a note all the way to the shelf: read, tallied, saved, netted back out.
 *
 * **In its own file because the stock folder is chosen when `stock-core` is first imported.** The
 * first version lived beside the forecast tests, which import that module at the top — so setting
 * the override inside the test came too late, and it wrote a delivery into Vansh's REAL stock
 * folder. Caught because the saved count came back 2 instead of 1; the stray file was deleted.
 * Here the override is set before any import of it, which is the only order that works.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

process.env.WW_STOCK_DIR = mkdtempSync(path.join(tmpdir(), "ww-stock-"));

const { readNote, tally, writeDelivery, listDeliveries, onHand, firstDelivery } = await import(
  "../src/stock-core.js"
);
const { loadMaterials } = await import("../src/inventory-core.js");

describe("a delivery, end to end", () => {
  it("reads a note, saves it, and the shelf shows what arrived", async () => {
    const materials = loadMaterials();
    const note = "2 pkt white ok\n1 pkt black ok\n10 pkt red kt ok";
    const rows = tally(readNote(note), [], materials, {});
    const matched = rows.filter((r) => r.key);
    expect(matched).toHaveLength(3);

    // A delivery keeps the NOTES it was read from and any picks a human made, not just numbers, so
    // a figure can always be traced back to the words behind it.
    await writeDelivery({
      date: "2026-08-04",
      claimedNote: note,
      countedNote: "",
      picks: {},
      lines: matched.map((r) => ({ key: r.key!, name: r.name, qty: r.claimed ?? 0, unit: r.unit })),
    });

    const saved = await listDeliveries();
    expect(saved).toHaveLength(1);
    expect(firstDelivery(saved)).toBe("2026-08-04");

    const names = new Map(materials.map((m) => [`${m.category}|${m.material}`, m.material]));
    const packs = new Map(
      materials.filter((m) => m.packOf).map((m) => [`${m.category}|${m.material}`, m.packOf!]),
    );
    const shelf = onHand(saved, new Map(), names, packs);
    // Nothing has been packed out of it yet, so what arrived is what is left.
    expect(shelf).toHaveLength(3);
    expect(shelf.every((r) => r.received > 0)).toBe(true);
  });
});

/**
 * inventory.test.ts — the cost sheet is a money path, and matching now happens HERE rather than
 * being guaranteed by the prompt, so these are the things that would otherwise be wrong quietly:
 *
 *   1. The ordering between `BLUE Balloon` and `BLUE Dark Balloon`. They are the pair most likely
 *      to be confused and a wrong one is invisible in a total.
 *   2. A plural and a real misspelling still match — those are the two commonest differences
 *      between a sheet and the price list, and treating them as misses makes the tool useless.
 *   3. Anything below the floor is left UNPRICED and counted, never mapped to the nearest row.
 *   4. Saving stores the reading, not the total — a stored total freezes last month's prices.
 *   5. `priceAt` is margin, not markup. Backwards, it under-prices every kit and still looks fine.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FLOOR,
  SURE,
  costKit,
  extractJson,
  gaps,
  listKits,
  loadMaterials,
  normalize,
  priceAt,
  readKit,
  readKitFile,
  rupees,
  saveKit,
  score,
  tokens,
  type Material,
} from "../src/inventory-core.js";

const PRICES: Material[] = [
  { category: "Balloon", material: "BLUE Balloon", paise: 80 },
  { category: "Balloon", material: "BLUE Dark Balloon", paise: 120 },
  { category: "Balloon", material: "SILVER MATALIC BALLOONS", paise: 80 },
  { category: "Balloon", material: "CONFETI SILVER BALLOONS", paise: 200 },
  { category: "Tape", material: "ARCH TAPE", paise: 350 },
  { category: "KT", material: "BLUE MATTALIC Curtain", paise: 400 },
];

const find = (name: string) => PRICES.find((p) => p.material === name)!;
const tmp = () => mkdtempSync(path.join(tmpdir(), "ww-inv-"));

describe("reading the AI's reply", () => {
  it("takes item, material or name, and qty, quantity or count", () => {
    expect(readKitFile({ sku: "MKU003", lines: [{ item: "ARCH TAPE", qty: 1 }] })).toEqual({
      sku: "MKU003",
      lines: [{ item: "ARCH TAPE", qty: 1 }],
    });
    expect(readKitFile({ items: [{ name: "ARCH TAPE", count: 2 }] }).lines).toEqual([
      { item: "ARCH TAPE", qty: 2 },
    ]);
  });

  it("keeps a stated size and never invents an absent one", () => {
    const { lines } = readKitFile({
      lines: [
        { item: "Star Foil", qty: 2, size: "18 inch" },
        { item: "ARCH TAPE", qty: 1 },
      ],
    });
    expect(lines[0].size).toBe("18 inch");
    expect(lines[1].size).toBeUndefined();
  });

  it("drops any line without a name and a positive whole count", () => {
    const { lines } = readKitFile({
      lines: [
        { item: "ARCH TAPE" },
        { item: "", qty: 3 },
        { item: "BLUE Balloon", qty: 0 },
        { item: "BLUE Balloon", qty: 2.5 },
        { item: "BLUE Balloon", qty: "twenty" },
        { item: "BLUE Balloon", qty: 20 },
      ],
    });
    expect(lines).toEqual([{ item: "BLUE Balloon", qty: 20 }]);
  });

  it("accepts a quantity the model quoted — `\"20\"` is still twenty", () => {
    expect(readKitFile({ lines: [{ item: "ARCH TAPE", qty: "20" }] }).lines).toEqual([
      { item: "ARCH TAPE", qty: 20 },
    ]);
  });

  it("survives a reply with no list at all rather than throwing", () => {
    expect(readKitFile({}).lines).toEqual([]);
    expect(readKitFile(null).lines).toEqual([]);
    expect(readKitFile({ lines: "nope" }).lines).toEqual([]);
  });
});

describe("matching a name to a price row", () => {
  it("strips plurals and noise words so the commonest difference is not a miss", () => {
    expect(tokens("20 pcs of Blue Balloons")).toEqual(["20", "blue", "balloon"]);
    expect(score("Blue Balloons", find("BLUE Balloon"))).toBe(1);
  });

  it("prefers the shorter exact row over the longer one that contains it", () => {
    // The pair most likely to be confused, and here they are 80 vs 120 paise.
    expect(score("Blue Balloon", find("BLUE Balloon"))).toBe(1);
    expect(score("Blue Balloon", find("BLUE Dark Balloon"))).toBeLessThan(1);
    expect(score("Blue Dark Balloon", find("BLUE Dark Balloon"))).toBe(1);
  });

  it("sees through a misspelling, because the real price list is full of them", () => {
    // "MATALIC" and "MATTALIC" are in Vansh's actual sheet; a person reading the picture writes
    // "Metallic". All three have to land on the same row.
    expect(score("Silver Metallic Balloons", find("SILVER MATALIC BALLOONS"))).toBeGreaterThan(FLOOR);
    expect(score("Blue Metallic Curtain", find("BLUE MATTALIC Curtain"))).toBeGreaterThan(FLOOR);
  });

  it("does not treat two short different words as a typo", () => {
    // 3-4 letter words must match exactly, or `red`/`led` and `12`/`18` collapse together.
    expect(score("Red Balloon", find("BLUE Balloon"))).toBeLessThan(FLOOR);
  });

  it("scores an unrelated item at nothing", () => {
    expect(score("Happy Birthday Banner", find("ARCH TAPE"))).toBe(0);
  });
});

describe("costing a kit", () => {
  it("prices a confident match quietly and multiplies by the count", () => {
    const kit = costKit([{ item: "blue  balloons", qty: 20 }], PRICES);
    expect(kit.lines[0].match?.material).toBe("BLUE Balloon");
    expect(kit.lines[0].score).toBe(1);
    expect(kit.lines[0].flagged).toBe(false);
    expect(kit.totalPaise).toBe(1600);
    expect(kit.uncosted).toBe(0);
  });

  it("is confident about a plain misspelling — that is not ambiguity", () => {
    const kit = costKit([{ item: "Silver Metallic Balloons", qty: 10 }], PRICES);
    expect(kit.lines[0].match?.material).toBe("SILVER MATALIC BALLOONS");
    expect(kit.lines[0].score).toBeGreaterThanOrEqual(SURE);
    expect(kit.lines[0].flagged).toBe(false);
  });

  it("prices a genuinely ambiguous line but FLAGS it, so it is never silently right", () => {
    // "Silver Balloons" fits SILVER MATALIC and CONFETI SILVER equally — a word is missing, not
    // misspelt, and they are 80 vs 200 paise. Picking one and saying nothing is the failure.
    const kit = costKit([{ item: "Silver Balloons", qty: 10 }], PRICES);
    expect(kit.lines[0].score).toBeGreaterThanOrEqual(FLOOR);
    expect(kit.lines[0].score).toBeLessThan(SURE);
    expect(kit.lines[0].flagged).toBe(true);
    expect(kit.flagged).toBe(1);
  });

  it("matches an old name, so sheets written before a rename still cost", () => {
    // The 2026-08-07 clean-up renamed 76 rows. Every inventory picture the partner already has
    // says the old thing, and a rename that un-matched them would be a regression, not a tidy-up.
    const renamed: Material[] = [
      { category: "Balloon", material: "Silver Confetti Balloon", paise: 200, aka: ["CONFETI SILVER BALLOONS"] },
    ];
    expect(costKit([{ item: "Confeti Silver Balloons", qty: 2 }], renamed).totalPaise).toBe(400);
    expect(costKit([{ item: "Silver Confetti Balloon", qty: 2 }], renamed).totalPaise).toBe(400);
  });

  it("counts a blank price cell apart from an unknown item — different fixes", () => {
    // Both leave the line uncosted, but one means "fill in a cell" and the other "add a row".
    // Collapsing them sends somebody to add a material that is already there.
    const list: Material[] = [
      { category: "Sash", material: "BTB Sash", paise: null },
      { category: "Tape", material: "ARCH TAPE", paise: 350 },
    ];
    const kit = costKit(
      [
        { item: "BTB Sash", qty: 1 },
        { item: "Fog Machine", qty: 1 },
        { item: "ARCH TAPE", qty: 1 },
      ],
      list,
    );
    expect(kit.noPrice).toBe(1);
    expect(kit.unmatched).toBe(1);
    expect(kit.uncosted).toBe(2);
    // The matched-but-priceless line keeps its material, so the screen can name what is missing.
    expect(kit.lines[0].match?.material).toBe("BTB Sash");
    expect(kit.lines[0].paise).toBeNull();
    // Never folded in as free.
    expect(kit.totalPaise).toBe(350);
  });

  it("leaves anything below the floor unpriced and counted, never mapped to the nearest row", () => {
    const kit = costKit(
      [
        { item: "Happy Birthday Banner", qty: 1 },
        { item: "ARCH TAPE", qty: 1 },
      ],
      PRICES,
    );
    expect(kit.lines[0].match).toBeNull();
    expect(kit.lines[0].paise).toBeNull();
    expect(kit.uncosted).toBe(1);
    // The total counts only what it could price, so it is an underestimate — which is why the
    // screen shows `unpriced` right beside it.
    expect(kit.totalPaise).toBe(350);
  });

  it("still offers the near misses, so an unpriced line is one click from fixed", () => {
    const kit = costKit([{ item: "Blue Balloonzzz", qty: 1 }], PRICES);
    expect(kit.lines[0].choices[0].material.material).toBe("BLUE Balloon");
  });

  it("lets a human override any line, including one that matched confidently", () => {
    const kit = costKit(
      [
        { item: "Blue Balloon", qty: 10 },
        { item: "Happy Birthday Banner", qty: 1 },
      ],
      PRICES,
      { 0: "Balloon|BLUE Dark Balloon", 1: "Tape|ARCH TAPE" },
    );
    expect(kit.lines[0].match?.material).toBe("BLUE Dark Balloon");
    expect(kit.lines[0].overridden).toBe(true);
    expect(kit.lines[0].flagged).toBe(false);
    expect(kit.totalPaise).toBe(1200 + 350);
    expect(kit.uncosted).toBe(0);
  });

  it("lets a human say `none of these` about a line the matcher was happy with", () => {
    const kit = costKit([{ item: "Blue Balloon", qty: 10 }], PRICES, { 0: "" });
    expect(kit.lines[0].match).toBeNull();
    expect(kit.uncosted).toBe(1);
    expect(kit.totalPaise).toBe(0);
  });

  it("stays exact where rupees would drift", () => {
    const kit = costKit([{ item: "ARCH TAPE", qty: 7 }], PRICES);
    expect(kit.totalPaise).toBe(2450);
    expect(rupees(kit.totalPaise)).toBe("₹24.50");
    expect(rupees(1600)).toBe("₹16");
  });
});

describe("the selling price", () => {
  it("is margin on the price, not markup on the cost", () => {
    // 50% margin on a 100 rupee kit is 200, not 150.
    expect(priceAt(10000, 50)).toBe(20000);
    expect(priceAt(10000, 0)).toBe(10000);
    expect(priceAt(10000, 60)).toBe(25000);
  });

  it("cannot be asked for an impossible margin", () => {
    expect(priceAt(10000, 100)).toBe(200000); // clamped to 95%, not Infinity
    expect(priceAt(10000, -20)).toBe(10000);
  });
});

describe("keeping a costed kit", () => {
  it("stores the reading and the corrections, and no total", () => {
    const dir = tmp();
    const file = saveKit(
      {
        sku: "MKU003",
        image: "/somewhere/sheet.png",
        lines: [{ item: "Blue Balloons", qty: 20 }],
        overrides: { 0: "Balloon|BLUE Dark Balloon" },
        marginPercent: 50,
        savedAt: "",
      },
      dir,
    );
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toMatch(/totalPaise/);

    // Reopening re-costs from the reading, so a price change in materials.json reaches every kit
    // that was ever saved. A stored total would freeze one at last month's balloon price.
    const back = readKit(file);
    expect(back.savedAt).not.toBe("");
    const kit = costKit(back.lines, PRICES, back.overrides, back.sku);
    expect(kit.lines[0].match?.material).toBe("BLUE Dark Balloon");
    expect(kit.totalPaise).toBe(2400);
  });

  it("re-saving the same SKU overwrites instead of piling up copies", () => {
    const dir = tmp();
    const base = { image: null, lines: [], overrides: {}, marginPercent: 50, savedAt: "" };
    saveKit({ ...base, sku: "GTB-2" }, dir);
    saveKit({ ...base, sku: "GTB-2" }, dir);
    expect(listKits(dir)).toHaveLength(1);
  });

  it("survives a SKU that is not a filename, and a missing folder", () => {
    const dir = tmp();
    expect(listKits(path.join(dir, "nope"))).toEqual([]);
    const file = saveKit(
      { sku: "ANP/003 (1)", image: null, lines: [], overrides: {}, marginPercent: 50, savedAt: "" },
      dir,
    );
    expect(path.basename(file)).toBe("ANP-003-1.json");
    expect(readKit(file).sku).toBe("ANP/003 (1)");
  });

  it("ignores a half-written file rather than failing the whole list", () => {
    const dir = tmp();
    saveKit(
      { sku: "OK", image: null, lines: [], overrides: {}, marginPercent: 50, savedAt: "" },
      dir,
    );
    writeFileSync(path.join(dir, "broken.json"), "{ not json");
    expect(listKits(dir).map((k) => k.sku)).toEqual(["OK"]);
  });
});

describe("pasting the reply straight out of the chat", () => {
  // The reply comes back as a ```json code block, not a download, so this is the normal route.
  const BODY = '{ "sku": "K1", "lines": [ { "item": "ARCH TAPE", "qty": 2 } ] }';

  it("takes the fence, and any words either side of it", () => {
    for (const wrapped of [
      BODY,
      "```json\n" + BODY + "\n```",
      "Here you go:\n\n```json\n" + BODY + "\n```\n\nLet me know if you need anything else.",
      "```\n" + BODY + "\n```",
    ]) {
      expect(readKitFile(extractJson(wrapped)).lines, wrapped.slice(0, 20)).toEqual([
        { item: "ARCH TAPE", qty: 2 },
      ]);
    }
  });

  it("returns null rather than throwing when there is no JSON in it", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson("I could not read the image, sorry.")).toBeNull();
    expect(extractJson("```json\n{ oops, not json }\n```")).toBeNull();
  });
});

describe("a real ChatGPT reading, against the real shipped price list", () => {
  const real = () => loadMaterials(path.join(import.meta.dirname, "..", "categories"));

  it("costs the reply Vansh actually got, pasted with its fence", () => {
    // Verbatim from the chat, 2026-08-07 — all caps, no sku, and no `size` on any line.
    const pasted = `\`\`\`json
{
  "sku": "",
  "lines": [
    { "item": "DARK PINK BALLOONS", "qty": 20 },
    { "item": "PASTEL PINK BALLOONS", "qty": 20 },
    { "item": "HBD BANNER", "qty": 1 },
    { "item": "KITTY FOIL", "qty": 1 },
    { "item": "PINK METALLIC CURTAIN", "qty": 2 },
    { "item": "GLUE TAPE", "qty": 1 },
    { "item": "ARCH TAPE", "qty": 1 }
  ]
}
\`\`\``;
    const { sku, lines } = readKitFile(extractJson(pasted));
    const kit = costKit(lines, real(), {}, sku);
    expect(kit.unmatched).toBe(0);
    expect(kit.noPrice).toBe(0);
    expect(kit.flagged).toBe(0);
    expect(kit.totalPaise).toBe(5850);
  });

  it("costs the pink-kitty packet with nothing flagged and nothing missed", () => {
    // Vansh's own 2026-08-07 reading, item names exactly as they came back once the colour was
    // folded into the name. This is the end-to-end proof that the rename coordinates with what
    // the AI actually says — every one of these went through a renamed row or an `aka`.
    const kit = costKit(
      [
        { item: "Dark Pink Balloons", qty: 20 },
        { item: "Pastel Pink Balloons", qty: 20 },
        { item: "HBD Banner", qty: 1 },
        { item: "Kitty Foil Balloon", qty: 1 },
        { item: "Pink Metallic Fringe Curtain", qty: 2 },
        { item: "Glue Tape", qty: 1 },
        { item: "Arch Tape", qty: 1 },
      ],
      real(),
    );
    expect(kit.lines.map((l) => l.match?.material)).toEqual([
      "Dark Pink Balloon",
      "Pink Pastel Balloon",
      "HBD Banner",
      "Kitty Foil", // "Balloon" here is the CATEGORY spelled out, not a missing word
      "Pink Metallic Curtain",
      "Glue Tape",
      "Arch Tape",
    ]);
    expect(kit.unmatched).toBe(0);
    expect(kit.noPrice).toBe(0);
    expect(kit.flagged).toBe(0);
    expect(kit.totalPaise).toBe(5850);
  });

  it("still refuses to be confident about a name with its colour missing", () => {
    // The trap the category rule could have opened. `Balloons` fits all 34 balloon rows; the
    // matcher must stay unsure, or a sheet whose colour lives in a separate column gets priced
    // off whichever row happens to sort first.
    const kit = costKit([{ item: "Balloons", qty: 20 }], real());
    expect(kit.lines[0].score).toBeLessThan(SURE);
    expect(kit.flagged).toBe(1);
  });
});

describe("the shipped price list", () => {
  it("reads materials.json, and an absent one is empty rather than a crash", () => {
    const dir = tmp();
    expect(loadMaterials(dir)).toEqual([]);
    writeFileSync(
      path.join(dir, "materials.json"),
      JSON.stringify({
        _: "comments are ignored",
        materials: [
          { category: "Balloon", material: "BLUE Balloon", paise: 80 },
          { category: "Balloon", material: "No price yet" },
        ],
      }),
    );
    // A row with no number is KEPT, with a null price. Dropping it would make a material that is
    // plainly on the list report as "not on the list", sending someone to add a duplicate row.
    expect(loadMaterials(dir)).toEqual([
      { category: "Balloon", material: "BLUE Balloon", paise: 80 },
      { category: "Balloon", material: "No price yet", paise: null },
    ]);
    expect(gaps(loadMaterials(dir)).noPrice.map((m) => m.material)).toEqual(["No price yet"]);
  });

  it("ships with the repo's own list, priced in whole paise or explicitly not at all", () => {
    const real = loadMaterials(path.join(import.meta.dirname, "..", "categories"));
    expect(real.length).toBeGreaterThan(0);
    for (const m of real) {
      expect(m.paise === null || Number.isInteger(m.paise), `${m.material} is not integer paise`).toBe(true);
      expect(m.category).toBeTruthy();
    }
    // Names AND old names must be unique after normalising, or two rows compete for one lookup
    // key and which one wins is an accident of file order.
    const keys = real.flatMap((m) => [m.material, ...(m.aka ?? [])]).map(normalize);
    expect(new Set(keys).size, "two rows claim the same name").toBe(keys.length);
  });
});

describe("what a listing actually leaves", () => {
  it("keeps the per-marketplace price and delivery cost with the kit", () => {
    // Neither can be computed: Meesho sets its fee from the main image by a rule fourteen tests
    // failed to pin down, and the two marketplaces are rarely listed at the same price. They are
    // typed in, so the only thing to get right is that they survive a save and reopen.
    const dir = tmp();
    const file = saveKit(
      {
        sku: "K1",
        image: null,
        lines: [{ item: "ARCH TAPE", qty: 1 }],
        overrides: {},
        marginPercent: 50,
        flatPaise: 6000,
        marketplaces: {
          meesho: { pricePaise: 29900, shippingPaise: 7700 },
          flipkart: { pricePaise: 34900 }, // delivery not filled in yet — must stay absent
        },
        savedAt: "",
      },
      dir,
    );
    const back = readKit(file);
    expect(back.marketplaces?.meesho).toEqual({ pricePaise: 29900, shippingPaise: 7700 });
    // Absent must not come back as 0 — "not filled in" and "free delivery" are different claims.
    expect(back.marketplaces?.flipkart?.shippingPaise).toBeUndefined();
  });

  it("opens a kit saved before marketplaces existed", () => {
    const dir = tmp();
    const file = saveKit(
      { sku: "OLD", image: null, lines: [], overrides: {}, marginPercent: 50, savedAt: "" },
      dir,
    );
    expect(readKit(file).marketplaces).toBeUndefined();
  });
});

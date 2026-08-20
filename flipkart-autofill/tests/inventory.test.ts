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
import { chmodSync, existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FLOOR,
  SURE,
  addMaterial,
  costKit,
  extractJson,
  gaps,
  gstOn,
  leftAfterEverything,
  leftForMarket,
  marketPrice,
  listKits,
  loadMaterials,
  normalize,
  priceAt,
  readKit,
  readKitFile,
  resolvePicks,
  rupees,
  saveKit,
  score,
  editMaterial,
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
      picks: {}, // the AI never writes a pick; only the panel does
    });
    expect(readKitFile({ items: [{ name: "ARCH TAPE", count: 2 }] }).lines).toEqual([
      { item: "ARCH TAPE", qty: 2 },
    ]);
  });

  // A correction made in the table is written back into the box as `pick`, so the text and the
  // table are the same kit. It has to come back in as a correction — not as a new reading, which
  // would put the app's own answer in the column that is checked against the picture.
  it("carries a human's pick back in, and leaves the sheet's own words alone", () => {
    const { lines, picks } = readKitFile({
      lines: [
        { item: "Silver Balloons", qty: 10, pick: "CONFETI SILVER BALLOONS" },
        { item: "ARCH TAPE", qty: 1 },
        { item: "Fairy Lights", qty: 1, pick: "" },
      ],
    });
    expect(lines[0].item).toBe("Silver Balloons"); // NOT overwritten with the picked row's name
    expect(picks).toEqual({ 0: "CONFETI SILVER BALLOONS", 2: "" });

    const resolved = resolvePicks(picks, PRICES);
    expect(resolved).toEqual({ 0: "Balloon|CONFETI SILVER BALLOONS", 2: "" });

    const kit = costKit(lines, PRICES, resolved);
    expect(kit.lines[0].match?.material).toBe("CONFETI SILVER BALLOONS");
    expect(kit.lines[0].overridden).toBe(true);
    expect(kit.lines[0].flagged).toBe(false); // a human said so; it is not a guess any more
    // An empty pick is a decision, not a missing one: this line matches nothing and costs nothing.
    expect(kit.lines[2].match).toBe(null);
    expect(kit.lines[2].overridden).toBe(true);
  });

  it("drops a pick that names no row, rather than guessing at the nearest", () => {
    const { picks } = readKitFile({ lines: [{ item: "ARCH TAPE", qty: 1, pick: "Arch Tapes Deluxe" }] });
    expect(resolvePicks(picks, PRICES)).toEqual({});
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

  it("flags a tie even when it scores well, because the winner was just list order", () => {
    // `Glue Dot` fits `Glue Dot Strip` and `Glue Tape` (aka `Glue Dot Roll`) exactly as well, and
    // they are ₹1 and ₹3.50. Whichever came first in the file would have won, silently, at any
    // score band — so the tie itself has to raise the flag, not the score.
    const two: Material[] = [
      { category: "Adhesive", material: "Glue Dot Strip", paise: 100 },
      { category: "Adhesive", material: "Glue Tape", paise: 350, aka: ["Glue Dot Roll"] },
    ];
    const tie = costKit([{ item: "Glue Dot", qty: 1 }], two);
    expect(tie.lines[0].choices[0].score).toBe(tie.lines[0].choices[1].score);
    expect(tie.lines[0].flagged).toBe(true);

    // …and naming which one it is settles it, quietly and correctly, both ways round.
    expect(costKit([{ item: "Glue Dot Roll", qty: 1 }], two).lines[0].match?.material).toBe("Glue Tape");
    expect(costKit([{ item: "Glue Dot Roll", qty: 1 }], two).lines[0].flagged).toBe(false);
    expect(costKit([{ item: "Glue Dot Strip", qty: 1 }], two).lines[0].match?.material).toBe("Glue Dot Strip");
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

  // The name comes from the SKU, so saving a renamed kit does NOT move it — it writes a second
  // file and leaves the first one in the list under the old number. This is why the Inventory
  // panel remembers the file it opened and deletes it after a rename; if this ever starts
  // returning one kit, that step is dead code.
  it("saving under a new SKU leaves the old file behind", () => {
    const dir = tmp();
    const base = { image: null, lines: [], overrides: {}, marginPercent: 50, savedAt: "" };
    const first = saveKit({ ...base, sku: "GTB-2" }, dir);
    const second = saveKit({ ...base, sku: "GTB-3" }, dir);
    expect(second).not.toBe(first);
    expect(listKits(dir)).toHaveLength(2);
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

/**
 * These two run against the LIVE `materials.json`, which is the point — they prove the matching
 * still lands on the right rows after a rename or a new `aka`.
 *
 * **They deliberately do not pin the total to a figure.** They used to say ₹58.50, and that broke
 * the day Vansh corrected Kitty Foil from ₹1.50 to ₹15 in the app — a correct price fix failing a
 * test it has nothing to do with. The subject here is which row each line matched; the prices are
 * data, and data is allowed to change without a test rewrite.
 */
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
    expect(kit.totalPaise).toBeGreaterThan(0);
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
    expect(kit.totalPaise).toBeGreaterThan(0);
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

describe("a price for one kit versus a price for the list", () => {
  // They are different claims and must not share a control: "this batch cost me more" is a fact
  // about one purchase; "the list is wrong" has to reach every kit and the other machine.
  it("a kit's own price wins over the list, for that kit only", () => {
    const one = costKit([{ item: "ARCH TAPE", qty: 2 }], PRICES, {}, "", { "Tape|ARCH TAPE": 900 });
    expect(one.lines[0].each).toBe(900);
    expect(one.lines[0].ownPrice).toBe(true);
    expect(one.totalPaise).toBe(1800);
    // The list is untouched, so any other kit still costs the old price.
    expect(costKit([{ item: "ARCH TAPE", qty: 2 }], PRICES).totalPaise).toBe(700);
  });

  it("prices a material the list has no price for", () => {
    // The case that makes this more than a convenience: 13 real materials have a blank price cell,
    // and without this a kit containing one can never be costed at all.
    const list: Material[] = [{ category: "Sash", material: "BTB Sash", paise: null }];
    const kit = costKit([{ item: "BTB Sash", qty: 1 }], list, {}, "", { "Sash|BTB Sash": 850 });
    expect(kit.totalPaise).toBe(850);
    expect(kit.noPrice).toBe(0);
  });

  it("writes a permanent change into the price list, keeping the comments and the aka names", () => {
    const dir = tmp();
    writeFileSync(
      path.join(dir, "materials.json"),
      JSON.stringify({
        _: "a note that must survive",
        materials: [
          { category: "Foil Balloon", material: "Kitty Foil", paise: 150, aka: ["KITTY FOIL"] },
          { category: "Tape", material: "Arch Tape", paise: 350 },
        ],
      }, null, 2),
    );

    const after = editMaterial("Foil Balloon|Kitty Foil", { paise: 3500 }, dir, path.join(dir, "edits.json"));
    expect(after.find((m) => m.material === "Kitty Foil")?.paise).toBe(3500);

    const raw = JSON.parse(readFileSync(path.join(dir, "materials.json"), "utf8"));
    expect(raw._).toBe("a note that must survive");
    expect(raw.materials[0].aka).toEqual(["KITTY FOIL"]);
    expect(raw.materials[1].paise).toBe(350); // nothing else touched
  });

  /**
   * The size is data like any other and was the one column with no way to change it — Vansh:
   * *"light in our listing says 10 meter… it's actually 7 meter"*. The second half matters more:
   * **on the partner's machine the price list is inside the app bundle and cannot be written at
   * all**, which made every correction a message to Vansh instead of a keystroke.
   */
  it("corrects a size, and falls back to the overlay when the list itself is read-only", () => {
    const dir = tmp();
    const file = path.join(dir, "materials.json");
    const edits = path.join(dir, "edits.json");
    writeFileSync(
      file,
      JSON.stringify({
        materials: [
          { category: "Light", material: "Fairy Light", paise: 9000, size: "10 meter" },
          { category: "Tape", material: "Arch Tape", paise: 350 },
        ],
      }, null, 2),
    );

    // Writable: the correction goes into the list itself, which is the copy worth committing.
    const fixed = editMaterial("Light|Fairy Light", { size: "7 meter" }, dir, edits);
    expect(fixed.find((m) => m.material === "Fairy Light")?.size).toBe("7 meter");
    expect(existsSync(edits)).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).materials[0].size).toBe("7 meter");
    // And nothing else about the row moved.
    expect(fixed.find((m) => m.material === "Fairy Light")?.paise).toBe(9000);

    // Read-only, which is what a packaged app looks like: the correction lands in the overlay and
    // is applied on top of the shipped row.
    chmodSync(file, 0o444);
    const again = editMaterial("Light|Fairy Light", { paise: 8000, size: "5 meter" }, dir, edits);
    expect(again.find((m) => m.material === "Fairy Light")).toMatchObject({ paise: 8000, size: "5 meter" });
    expect(JSON.parse(readFileSync(file, "utf8")).materials[0].size).toBe("7 meter"); // untouched
    expect(loadMaterials(dir, edits).find((m) => m.material === "Fairy Light")?.size).toBe("5 meter");

    // Renaming keeps the old name as an `aka`, or every sheet that used it stops matching — and
    // an un-matched line does not fail loudly, it drops out of the total.
    const renamed = editMaterial("Light|Fairy Light", { material: "Fairy Light, 7 m" }, dir, edits);
    const row = renamed.find((m) => m.material === "Fairy Light, 7 m");
    expect(row?.aka).toContain("Fairy Light");
    expect(row?.paise).toBe(8000); // the rest of the row came with it
    // Taking a name another row already answers to is refused: a tie is settled by file order.
    expect(() => editMaterial("Tape|Arch Tape", { material: "fairy light" }, dir, edits))
      .toThrow(/already uses that name/);

    // A material added while the list is read-only is on the list, and cannot be added twice.
    addMaterial({ category: "Light", material: "Rice Light", paise: 4000 }, dir, edits);
    expect(loadMaterials(dir, edits).some((m) => m.material === "Rice Light")).toBe(true);
    expect(() => addMaterial({ category: "Light", material: "rice light", paise: 1 }, dir, edits))
      .toThrow(/already on the list/);
    chmodSync(file, 0o644);
  });

  it("can blank a price back out, rather than only ever setting one", () => {
    const dir = tmp();
    writeFileSync(
      path.join(dir, "materials.json"),
      JSON.stringify({ materials: [{ category: "Tape", material: "Arch Tape", paise: 350 }] }),
    );
    expect(editMaterial("Tape|Arch Tape", { paise: null }, dir)[0].paise).toBeNull();
  });

  it("refuses a material that is not on the list instead of adding one", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "materials.json"), JSON.stringify({ materials: [] }));
    expect(() => editMaterial("Nope|Nothing", { paise: 100 }, dir)).toThrow(/No material/);
  });
});

/** The other half: a line reading *not on the price list* used to need a text editor to fix. */
describe("adding a material the list has never had", () => {
  const list = () => {
    const dir = tmp();
    writeFileSync(
      path.join(dir, "materials.json"),
      JSON.stringify({
        _: "a note that must survive",
        materials: [
          { category: "Foil Balloon", material: "Kitty Foil", paise: 150, aka: ["KITTY FOIL"] },
          { category: "Foil Balloon", material: "Heart Foil", paise: 900 },
          { category: "Tape", material: "Arch Tape", paise: 350 },
        ],
      }, null, 2),
    );
    return dir;
  };
  const raw = (dir: string) =>
    JSON.parse(readFileSync(path.join(dir, "materials.json"), "utf8"));

  it("files the new row with its own category rather than at the end", () => {
    const dir = list();
    const after = addMaterial({ category: "Foil Balloon", material: "Gold Glass Foil", paise: 4500 }, dir);
    expect(after.map((m) => m.material)).toEqual([
      "Kitty Foil", "Heart Foil", "Gold Glass Foil", "Arch Tape",
    ]);
    expect(raw(dir)._).toBe("a note that must survive");
    // And it is immediately usable, which is the whole point of adding it mid-kit.
    expect(costKit([{ item: "Gold Glass Foil", qty: 2 }], after).totalPaise).toBe(9000);
  });

  it("takes a brand new category, and puts it at the end", () => {
    const after = addMaterial({ category: "Lighting", material: "Fairy Light", paise: 6000 }, list());
    expect(after[after.length - 1]).toEqual({
      category: "Lighting", material: "Fairy Light", paise: 6000,
    });
  });

  it("allows no price, which is a different state from free", () => {
    const after = addMaterial({ category: "Tape", material: "Glue Dot Roll", paise: null }, list());
    expect(after.find((m) => m.material === "Glue Dot Roll")!.paise).toBeNull();
    // Uncosted, not counted as zero — the panel's whole reason for telling the two apart.
    const kit = costKit([{ item: "Glue Dot Roll", qty: 3 }], after);
    expect(kit.totalPaise).toBe(0);
    expect(kit.noPrice).toBe(1);
  });

  it("refuses a name already on the list, under any spelling, rather than making a tie", () => {
    // A duplicate would tie for ever, and a tie is settled by file order — a coin toss (WW-162).
    expect(() => addMaterial({ category: "Foil Balloon", material: "kitty  foil", paise: 100 }, list()))
      .toThrow(/already on the list/);
    expect(() => addMaterial({ category: "Foil Balloon", material: "KITTY FOIL", paise: 100 }, list()))
      .toThrow(/already on the list/); // an aka is the same material too
  });

  it("refuses a nameless or category-less row", () => {
    expect(() => addMaterial({ category: "Tape", material: "  ", paise: 100 }, list())).toThrow();
    expect(() => addMaterial({ category: "", material: "Something", paise: 100 }, list())).toThrow();
  });
});

describe("a material bought as a pack, not one at a time", () => {
  // WW-137, and the worst kind of wrong the panel has produced: every figure on screen correct
  // and the total 5.6x too high, because the count and the price were in different units.
  const PACKS: Material[] = [
    { category: "Themed Set", material: "Annaprashan Kit With Props", paise: 2500, piecesPerPack: 16 },
    { category: "Balloon", material: "Golden Balloon", paise: 80 },
  ];

  it("charges for the pack, not for every piece in it", () => {
    const kit = costKit([{ item: "PHOTO PROPS", qty: 16 }], PACKS, { 0: "Themed Set|Annaprashan Kit With Props" });
    expect(kit.lines[0].packs).toBe(1);
    expect(kit.totalPaise).toBe(2500); // not 16 x 2500 = 40000
  });

  it("rounds up, because half a pack cannot be bought", () => {
    const two = costKit([{ item: "PHOTO PROPS", qty: 17 }], PACKS, { 0: "Themed Set|Annaprashan Kit With Props" });
    expect(two.lines[0].packs).toBe(2);
    expect(two.totalPaise).toBe(5000);
  });

  it("leaves anything sold singly alone", () => {
    const kit = costKit([{ item: "Golden Balloon", qty: 20 }], PACKS);
    expect(kit.lines[0].packs).toBe(20);
    expect(kit.totalPaise).toBe(1600);
  });

  it("lets a corrected count replace the one that was read", () => {
    // The general fix, for everything a pack size cannot cover.
    const kit = costKit([{ item: "Golden Balloon", qty: 20 }], PACKS, {}, "", {}, { 0: 5 });
    expect(kit.lines[0].qty).toBe(5);
    expect(kit.totalPaise).toBe(400);
  });

  it("keeps every pack size honest against the shipped list", () => {
    // A pack size on a material whose name says a different number is a silent divider.
    for (const m of loadMaterials(path.join(import.meta.dirname, "..", "categories"))) {
      if (m.piecesPerPack === undefined) continue;
      expect(Number.isInteger(m.piecesPerPack) && m.piecesPerPack > 0, m.material).toBe(true);
      const stated = m.material.match(/(\d+)\s*(?:pcs|pieces|foils)/i);
      if (stated) expect(m.piecesPerPack, `${m.material} says ${stated[1]}`).toBe(Number(stated[1]));
    }
  });
});

describe("a shorter word that is the start of a longer one", () => {
  const REAL = () => loadMaterials(path.join(import.meta.dirname, "..", "categories"));

  it("reads GOLD BALLOONS as Golden Balloon, not Rose Gold Balloon", () => {
    // Found while checking a real kit. `gold` to `golden` is two insertions on a six-letter word,
    // so edit distance rejected it — while `gold` matched `Rose Gold Balloon` exactly and won on
    // a shared word. Same price here, so no money was lost; but it flagged Vansh's commonest
    // item every single time, which trains a person to ignore the flag that matters.
    const kit = costKit([{ item: "GOLD BALLOONS", qty: 20 }], REAL());
    expect(kit.lines[0].match?.material).toBe("Golden Balloon");
    expect(kit.flagged).toBe(0);
  });

  it("still refuses a short word that merely starts the same", () => {
    // The guard this could have broken: four letters minimum keeps `net` away from `netted`,
    // and `red` away from anything.
    expect(score("Red Balloon", { category: "x", material: "Redo Balloon", paise: 1 })).toBeLessThan(SURE);
  });

  it("does not let it swallow a genuinely more specific row", () => {
    const kit = costKit([{ item: "Rose Gold Balloons", qty: 1 }], REAL());
    expect(kit.lines[0].match?.material).toBe("Rose Gold Balloon");
  });
});

/**
 * What a kit LEAVES, which is what the saved-kit list is shaded by. The arithmetic is the panel's
 * delivery table, and it is the one place GST is extracted rather than added: an Indian
 * marketplace price already includes it, so adding it on top invents money the buyer never paid.
 */
describe("what a sale actually leaves", () => {
  it("takes the tax out of the price rather than putting it on top", () => {
    // ₹200 listed, ₹40 delivery, ₹50 of materials. Taxable = 200 - 40 = 160, and 5% GST INSIDE
    // that is 160 x 5 / 105 = ₹7.62 — not ₹8, which is what adding 5% on top would give.
    expect(leftAfterEverything(20000, 4000, 5000)).toBe(20000 - 5000 - 4000 - 762);
  });

  it("never taxes a negative, when delivery is more than the price", () => {
    expect(leftAfterEverything(3000, 5000, 1000)).toBe(3000 - 1000 - 5000);
  });

  it("gives the saved list a figure per marketplace, and none at all when nothing is listed", () => {
    const dir = tmp();
    const base = {
      image: null,
      lines: [{ item: "ARCH TAPE", qty: 2 }], // ₹7.00 of materials
      overrides: {},
      marginPercent: 50,
      savedAt: "",
    };
    saveKit({ ...base, sku: "LISTED", marketplaces: { meesho: { pricePaise: 12000, shippingPaise: 4000 } } }, dir);
    saveKit({ ...base, sku: "NOT-LISTED" }, dir);

    const rows = listKits(dir, PRICES);
    const listed = rows.find((r) => r.sku === "LISTED")!;
    expect(listed.left!.meesho).toBe(leftAfterEverything(12000, 4000, 700));
    // A kit costed but never listed has NO margin — which the panel must not colour as a bad one.
    expect(rows.find((r) => r.sku === "NOT-LISTED")!.left).toBeUndefined();
  });

  it("prefers the settlement over any price, because that is the money that arrived", () => {
    // ₹240 in the bank, ₹19 of materials. The shop price is irrelevant to this figure — which is
    // the case that made it: Meesho cuts the listed price and pays the seller the same.
    expect(leftForMarket({ settlementPaise: 24000, shippingPaise: 7700 }, 1900)).toBe(22100);
    expect(leftForMarket({ settlementPaise: 24000, pricePaise: 20000 }, 1900)).toBe(22100);
    // No settlement: the old estimate, and it must still honour a rate that is not 5.
    expect(leftForMarket({ pricePaise: 20000, shippingPaise: 4000, gstPercent: 12 }, 5000))
      .toBe(leftAfterEverything(20000, 4000, 5000, 12));
    // Nothing filled in is not a margin of zero.
    expect(leftForMarket({}, 5000)).toBeNull();
    expect(leftForMarket({ shippingPaise: 4000 }, 5000)).toBeNull();
  });

  it("adds the GST back on to reach the price, so price and settlement agree both ways", () => {
    // 200 settled + 5% + 40 delivery = 250. Run back through the estimate, the same 200 comes out.
    expect(marketPrice({ settlementPaise: 20000, shippingPaise: 4000 })).toBe(25000);
    expect(leftAfterEverything(25000, 4000, 0)).toBe(20000);
    // A typed price wins outright — it is the shop window, not the payout.
    expect(marketPrice({ pricePaise: 19900, settlementPaise: 20000 })).toBe(19900);
    expect(marketPrice({})).toBe(0);
  });

  it("takes the GST AMOUNT when one is typed, and only falls back to the rate", () => {
    // The statement is the fact. ₹27 of GST on a ₹200 settlement is not 5% of anything tidy —
    // part of it is tax on the delivery — and the typed figure must survive that.
    expect(gstOn({ settlementPaise: 20000, gstPaise: 2700 })).toBe(2700);
    expect(marketPrice({ settlementPaise: 20000, shippingPaise: 4000, gstPaise: 2700 })).toBe(26700);
    // Untyped, it is the rate on the settlement — the same number the panel had before.
    expect(gstOn({ settlementPaise: 20000 })).toBe(1000);
    expect(gstOn({ settlementPaise: 20000, gstPercent: 12 })).toBe(2400);
    // And from the other end, a GST-inclusive price gives that same figure back.
    expect(gstOn({ pricePaise: 25000, shippingPaise: 4000 })).toBe(1000);
    // A typed amount reaches what is left, for a kit priced but never settled.
    expect(leftForMarket({ pricePaise: 25000, shippingPaise: 4000, gstPaise: 2700 }, 5000)).toBe(13300);
  });

  it("costs from today's price list, so a price change moves the figure", () => {
    const dir = tmp();
    saveKit(
      {
        sku: "K", image: null, lines: [{ item: "ARCH TAPE", qty: 1 }], overrides: {},
        marginPercent: 50, savedAt: "",
        marketplaces: { flipkart: { pricePaise: 10000, shippingPaise: 0 } },
      },
      dir,
    );
    const dearer = PRICES.map((m) => (m.material === "ARCH TAPE" ? { ...m, paise: 1000 } : m));
    expect(listKits(dir, PRICES)[0].left!.flipkart).toBeGreaterThan(
      listKits(dir, dearer)[0].left!.flipkart,
    );
  });

  it("says nothing about margins when the price list is not handed in", () => {
    const dir = tmp();
    saveKit(
      {
        sku: "K", image: null, lines: [], overrides: {}, marginPercent: 50, savedAt: "",
        marketplaces: { meesho: { pricePaise: 12000 } },
      },
      dir,
    );
    expect(listKits(dir)[0].left).toBeUndefined();
  });
});

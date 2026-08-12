/**
 * paste.test.ts — `npm run paste` is the last gate before a listing goes live, so what it
 * catches is what never reaches a marketplace.
 *
 * Three things, all found in real data: a value over the panel's limit (GTB-2's pack contents
 * came back 263/255 and would have been silently truncated), Model Name / Search Keywords
 * disagreeing between the two JSON files (ANP003 had three different versions), and a value
 * missing entirely because the AI's reply was cut short (WW-081).
 *
 * None of them may BLOCK — the printed values are still correct to paste. They are warnings,
 * and the test is that they are warnings you cannot scroll past.
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyParcelToListing } from "../src/paste-core.js";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "src", "paste.ts");
const PROJECT = path.join(HERE, "..");

let tmp: string;
const created: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "ww-paste-"));
  created.push(tmp);
  await mkdir(path.join(tmp, "image-meta"), { recursive: true });
  await mkdir(path.join(tmp, "products"), { recursive: true });
});

afterAll(async () => {
  for (const d of created) await rm(d, { recursive: true, force: true });
});

// A fixture that PASSES every check, so each test can break exactly one thing. Getting this
// right was itself a test of the checks: the first version had a 73-character Model Name and
// no keywords in its descriptions, and the tool correctly refused to call it clean.
const TITLE = "Groom To Be Decoration Kit Black Gold Latex Balloons Foil Banner Sash Curtain for Bachelor Party (Set of 52 Pcs)";
const KEYWORDS = ["groom to be decoration", "bachelor party kit"];

// Sized the way a good reply comes back, and the two descriptions are NOT the same size —
// Flipkart's field is 5000 characters and Meesho's is 1400, so one fixture cannot serve both.
const KW = `${KEYWORDS.join(" and ")}. `;
const LONG = `${KW}${"A ".repeat(1400)}`;         // ~2850 chars, inside Flipkart's 2500-5000
const MEESHO_LONG = `${KW}${"A ".repeat(570)}`;   // ~1190 chars, inside Meesho's 1100-1400
const NO_KEYWORDS = "A ".repeat(570);             // Meesho-sized, carrying none of the phrases
const MEESHO_TITLE = "G ".repeat(50);             // 100 chars, inside the 90-120 band

/** Write both files for one product. Anything passed in `meta`/`product` overrides the good default. */
async function fixture(id: string, meta: object = {}, product: object = {}) {
  await writeFile(path.join(tmp, "image-meta", `image-meta-${id}.json`), JSON.stringify({
    title: TITLE,
    keywords: KEYWORDS,
    images: { "1": "a photo" },
    meesho: { title: MEESHO_TITLE, description: MEESHO_LONG, pack_contents: "20 balloons" },
    ...meta,
  }));
  await writeFile(path.join(tmp, "products", `products-${id}.json`), JSON.stringify({
    category: "balloon-decoration",
    values: { "Model Name": TITLE, "Search Keywords": KEYWORDS, Description: LONG, ...product },
  }));
}

async function run(id: string) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--import", "tsx", CLI, id], {
      cwd: PROJECT,
      env: { ...process.env, WW_META_DIR: path.join(tmp, "image-meta"), WW_PRODUCTS_DIR: path.join(tmp, "products") },
    });
    return { code: 0, out: stdout + stderr };
  } catch (e: any) {
    return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("npm run paste", () => {
  it("says so plainly when there is nothing wrong", async () => {
    await fixture("GTB002");
    const { code, out } = await run("GTB-2");
    expect(code).toBe(0);
    expect(out).toContain("nothing to fix");
    expect(out).not.toContain("TO FIX");
  });

  it("catches a value over the panel's limit and says how much will be cut", async () => {
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: MEESHO_LONG, pack_contents: "x".repeat(263) } });
    const { code, out } = await run("GTB-2");
    expect(out).toContain("263/255");
    expect(out).toContain("cut the last 8 character");
    expect(out).toContain("1 THING TO FIX");
    expect(code).toBe(0); // a warning, never a block
  });

  it("catches Model Name drifting between the two files, and prints both versions", async () => {
    await fixture("GTB002", {}, { "Model Name": "A Completely Different Title" });
    const { out } = await run("GTB-2");
    expect(out).toContain("Model Name differs");
    expect(out).toContain("A Completely Different Title");
    expect(out).toContain(TITLE);
  });

  it("catches Search Keywords drifting too — same rule, different field", async () => {
    await fixture("GTB002", {}, { "Search Keywords": ["something", "else"] });
    const { out } = await run("GTB-2");
    expect(out).toContain("Search Keywords differs");
  });

  it("catches a value under the target, not only one over it", async () => {
    // Each field carries the PROMPT's own floor, not a shared percentage: Flipkart's Description
    // is a 5000-character field and Meesho's is 1400, so "too short" is a different number for
    // each. A blanket tolerance would have let one of them miss its target and still pass.
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: "Too short.", pack_contents: "1 Balloon" } });
    const meesho = await run("GTB-2");
    expect(meesho.out).toContain("under the 1100 target");
    expect(meesho.code).toBe(0);

    await fixture("GTB003", {}, { Description: "Too short." });
    const flipkart = await run("GTB-3");
    expect(flipkart.out).toContain("under the 2500 target");
    expect(flipkart.out).toContain("under the 2500 the prompt asks for");
    expect(flipkart.code).toBe(0);
  });

  it("counts a short Meesho title too — 90 is the floor, 120 the ceiling", async () => {
    await fixture("GTB002", { meesho: { title: "Groom Kit", description: MEESHO_LONG, pack_contents: "1 Balloon" } });
    expect((await run("GTB-2")).out).toContain("MEESHO TITLE is 9/120");
  });

  it("never calls pack contents short — its length is the pack's, not a target", async () => {
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: MEESHO_LONG, pack_contents: "2 Balloons" } });
    const { out } = await run("GTB-2");
    expect(out).toContain("nothing to fix");
  });

  it("catches a truncated reply — a missing value is not a silent one", async () => {
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: MEESHO_LONG } }); // no pack_contents
    const { out } = await run("GTB-2");
    expect(out).toContain("(missing)");
    expect(out).toContain("reply was cut short");
  });

  it("counts every problem in one summary rather than scattering them", async () => {
    // A different title, but still a VALID length — so this counts drift + over-limit and does
    // not quietly become a third problem.
    await fixture("GTB002",
      { meesho: { title: MEESHO_TITLE, description: MEESHO_LONG, pack_contents: "x".repeat(300) } },
      { "Model Name": "Bachelor Party Decoration Kit Black Gold Latex Balloons Foil Banner Sash for Groom To Be (Set of 52 Pcs)" });
    const { out } = await run("GTB-2");
    expect(out).toContain("2 THINGS TO FIX");
    // The summary comes AFTER the values, where the eye already is when you scroll to copy.
    expect(out.indexOf("THINGS TO FIX")).toBeGreaterThan(out.indexOf("[MEESHO PACK CONTENTS]"));
  });

  it("still prints the values it is warning about — they are correct to paste", async () => {
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: MEESHO_LONG, pack_contents: "x".repeat(300) } });
    const { out } = await run("GTB-2");
    expect(out).toContain("x".repeat(300));
  });
});

/**
 * The rules from the prompts that a machine can verify. Each is a documented rejection cause or
 * a measured limit — nothing subjective is checked here, that stays in the prompt where a human
 * can argue with it.
 */
describe("the mechanical listing rules", () => {
  it("catches a banned quality word wherever it hides", async () => {
    await fixture("GTB002", {}, { Series: "Premium" });
    const { out } = await run("GTB-2");
    expect(out).toContain(`banned quality word "premium"`);
    expect(out).toContain("products Series");
  });

  it("catches urgency wording — a policy risk, not a sales technique", async () => {
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: `${MEESHO_LONG} Limited Stock`, pack_contents: "1 Balloon" } });
    const { out } = await run("GTB-2");
    expect(out).toContain(`"limited stock"`);
    expect(out).toContain("policy risk");
  });

  it("catches a comma in a Flipkart list value — where it really does split the entry in two", async () => {
    await fixture("GTB002", { keywords: ["groom to be decoration, bachelor party"] });
    const { out } = await run("GTB-2");
    expect(out).toContain("contains a comma");
    expect(out).toContain("becomes two entries");
  });

  /**
   * The two marketplaces share this JSON, not their rules. Flipkart splits list values on
   * commas; the Meesho values are pasted into the Supplier Panel by hand and nothing splits
   * them. Applying Flipkart's constraint to the Meesho text degrades it for no reason — which
   * is exactly the mistake this test exists to prevent recurring.
   */
  it("leaves commas alone everywhere under meesho — that side never reaches Flipkart", async () => {
    await fixture("GTB002", {
      meesho: {
        title: `Groom To Be Kit, Black and Gold, Bachelor Party ${MEESHO_TITLE}`,
        description: `Balloons, banner and curtains. ${MEESHO_LONG}`,
        pack_contents: "20 Black Latex Balloons, 20 Gold Latex Balloons, 1 Groom To Be Foil Banner",
      },
    });
    const { out } = await run("GTB-2");
    expect(out).not.toContain("contains a comma");
  });

  it("leaves commas alone in the Flipkart Description — that field is prose", async () => {
    await fixture("GTB002", {}, { Description: `Black, gold and silver. ${LONG}` });
    expect((await run("GTB-2")).out).not.toContain("contains a comma");
  });

  it("counts Model Name — the only part of the Flipkart title a seller controls", async () => {
    await fixture("GTB002", { title: "Short Kit" }, { "Model Name": "Short Kit" });
    const { out } = await run("GTB-2");
    expect(out).toContain("Model Name is only 9 characters");
    expect(out).toContain("80-120");
  });

  it("flags a Model Name past Flipkart's ceiling", async () => {
    const long = "A".repeat(140);
    await fixture("GTB002", { title: long }, { "Model Name": long });
    const { out } = await run("GTB-2");
    expect(out).toContain("Model Name is 140/128");
  });

  it("says nothing about Model Name inside the target band", async () => {
    await fixture("GTB002");
    const { out } = await run("GTB-2");
    expect(out).not.toContain("Model Name is");
  });

  it("flags keywords only when MOST are missing from both descriptions", async () => {
    // Both phrases present in the descriptions (the default fixture) — silent.
    await fixture("GTB002");
    expect((await run("GTB-2")).out).not.toContain("appear in neither");

    // Neither present — worth saying.
    await fixture("GTB003",
      { meesho: { title: MEESHO_TITLE, description: NO_KEYWORDS, pack_contents: "1 Balloon" } },
      { Description: "A ".repeat(1400) });
    expect((await run("GTB-3")).out).toContain("2 of 2 keywords appear in neither");
  });

  /**
   * The most expensive bug this project has hit: emoji in the Flipkart Description made the
   * server return HTTP 500 on EVERY save. The listing could not be saved at all, and once the
   * text was in the draft even switching tabs failed. Proven live 2026-07-31 by deleting the
   * field, at which point it saved instantly.
   */
  it("catches emoji in a Flipkart field — they make the server 500 on save", async () => {
    await fixture("GTB002", {}, { Description: `Kit for a party. 🎁 What You Get 👉 ${"A ".repeat(1400)}` });
    const { out } = await run("GTB-2");
    expect(out).toContain("emoji");
    expect(out).toContain("HTTP 500");
  });

  it("catches the 3-byte emoji too — one survivor in a plain field is still one too many", async () => {
    await fixture("GTB002", {}, { Description: `Kit for a party. ✨ Key Features ${"A ".repeat(1400)}` });
    expect((await run("GTB-2")).out).toContain("emoji");
  });

  it("leaves ordinary punctuation alone — dashes, rupees and quotes are not emoji", async () => {
    await fixture("GTB002", {}, { Description: `Set of 52 - ₹499 - the buyer's kit "as shown" ${"A ".repeat(1400)}` });
    expect((await run("GTB-2")).out).not.toContain("emoji");
  });

  it("does not police emoji in the Meesho values — hand-pasted, never seen to break", async () => {
    await fixture("GTB002", { meesho: { title: MEESHO_TITLE, description: `🎁 ${MEESHO_LONG}`, pack_contents: "1 Balloon" } });
    expect((await run("GTB-2")).out).not.toContain("emoji");
  });

  it("catches a TODO_ placeholder before it reaches a live form", async () => {
    await fixture("GTB002", {}, { Shape: "TODO_pick_one" });
    const { out } = await run("GTB-2");
    expect(out).toContain("still a placeholder");
  });
});

/**
 * The parcel is measured from the packed kit; the AI could only ever guess it from a photo. These
 * pin the join between the two — before it existed, the panel showed one size and the bot typed
 * another, which is WW-055's failure (a declared parcel the courier disagrees with, charged back
 * at settlement) arriving through the front door.
 */
describe("putting the costed parcel on the listing", () => {
  const DIMS = { Width: "8", Height: "1.6", Depth: "10", Weight: "0.250", "Weight (unit)": "kg" };
  const products = () => path.join(tmp, "products");
  const read = async (id: string) =>
    JSON.parse(await readFile(path.join(products(), `products-${id}.json`), "utf8"));

  it("overwrites the AI's guess and says what it changed it from", async () => {
    const { applyParcelToListing } = await import("../src/paste-core.js");
    await fixture("GTB002", {}, { Width: "12", Depth: "16", Height: "3" });
    const r = await applyParcelToListing("GTB-2", DIMS, { products: products() });

    expect((await read("GTB002")).values).toMatchObject(DIMS);
    // Reported per key, with the old value, because the file quietly disagreeing with what was
    // on it a moment ago is the thing this whole area exists to prevent.
    expect(r.changed).toContainEqual({ key: "Width", from: "12", to: "8" });
    expect(r.changed).toContainEqual({ key: "Weight", from: null, to: "0.250" });
  });

  it("touches nothing but the parcel, however it is called", async () => {
    const { applyParcelToListing } = await import("../src/paste-core.js");
    await fixture("GTB002");
    await applyParcelToListing(
      "GTB-2",
      { ...DIMS, Description: "hijacked", "Selling Price": "1" },
      { products: products() },
    );
    const { values } = await read("GTB002");
    expect(values.Description).toBe(LONG); // the whitelist held
    expect(values["Selling Price"]).toBeUndefined();
  });

  it("changes nothing, and rewrites nothing, when the listing already agrees", async () => {
    const { applyParcelToListing } = await import("../src/paste-core.js");
    await fixture("GTB002", {}, DIMS);
    expect((await applyParcelToListing("GTB-2", DIMS, { products: products() })).changed).toEqual([]);
  });

  it("says which listing is missing rather than writing a new one", async () => {
    const { applyParcelToListing, PasteNotFound } = await import("../src/paste-core.js");
    await expect(applyParcelToListing("NOPE", DIMS, { products: products() })).rejects.toBeInstanceOf(
      PasteNotFound,
    );
  });
});


// One measured parcel, written to BOTH blocks Flipkart asks for. Height is the reason the cm set
// goes to `tabs.pricing` instead of `values`: it means centimetres there and inches in the
// Dimensions block, and a product's own values apply on every tab.
describe("the parcel writes both blocks", () => {
  it("keeps the two Heights apart, in their own units", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ww-parcel-"));
    const file = path.join(dir, "ANP004.json");
    await writeFile(file, JSON.stringify({ category: "c", values: { "Seller SKU ID": "ANP004" } }));

    await applyParcelToListing("ANP004", {
      Width: "7", Height: "1.5", Depth: "8", Weight: "0.250", "Weight (unit)": "kg",
      packageDetails: { Length: "20.32", Breadth: "17.78", Height: "3.81", Weight: "0.250" },
    }, { products: dir });

    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.values.Height).toBe("1.5");          // inches, Additional Description
    expect(saved.tabs.pricing.Height).toBe("3.81");   // centimetres, Price/Stock
    expect(saved.tabs.pricing.Length).toBe("20.32");
    expect(saved.values.Width).toBe("7");
  });

  it("still works for a caller that sends only the inches block", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ww-parcel2-"));
    const file = path.join(dir, "X1.json");
    await writeFile(file, JSON.stringify({ category: "c", values: {} }));
    const r = await applyParcelToListing("X1", { Width: "7", Height: "1.5" }, { products: dir });
    expect(r.changed.map((c) => c["key"])).toEqual(["Width", "Height"]);
    expect(JSON.parse(await readFile(file, "utf8")).tabs).toBeUndefined();
  });
});

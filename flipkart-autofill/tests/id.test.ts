/**
 * id.test.ts — one product, four filenames, one answer.
 *
 * The bug this pins: every ID→file lookup used to be exact string equality, so a folder called
 * "GTB 2" could not find image-meta-GTB002.json — the name ChatGPT actually gives the download —
 * and the operator was offered a menu marking their own product "a DIFFERENT product".
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeId, findById, whyNoMatch } from "../src/id.js";
// The prefix check lives in gui/shared.ts because the renderer needs it and cannot have node:fs.
import { isForAccount } from "../gui/shared.js";

let tmp: string;
const created: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "ww-id-"));
  created.push(tmp);
});

afterAll(async () => {
  for (const d of created) await rm(d, { recursive: true, force: true });
});

describe("normalizeId", () => {
  it("treats every name one listing arrives under as the same product", () => {
    const all = ["ANP 3", "ANP-3", "ANP003", "anp003", "ANP003.json", "image-meta-ANP003.json", "products-ANP003.json"];
    expect(new Set(all.map(normalizeId)).size).toBe(1);
    expect(normalizeId("ANP-3")).toBe("ANP3");
  });

  it("keeps genuinely different products apart", () => {
    const ids = ["ANP-3", "ANP-1", "GTB-2", "ANP-1042", "HBD-kitty"].map(normalizeId);
    expect(new Set(ids).size).toBe(5);
  });

  it("does not confuse a padded number with a longer one", () => {
    expect(normalizeId("ANP-1042")).not.toBe(normalizeId("ANP-104"));
    expect(normalizeId("GTB002")).toBe(normalizeId("GTB-2"));
  });

  it("ignores the browser's duplicate-download suffix", () => {
    expect(normalizeId("products-ANP003 (1).json")).toBe("ANP3");
    expect(normalizeId("ANP003(2)")).toBe("ANP3");
  });

  it("keeps a descriptive ID that has no number", () => {
    expect(normalizeId("HBD-space - p")).toBe("HBDSPACEP");
    expect(normalizeId("HBD-kitty")).toBe("HBDKITTY");
  });
});

describe("findById", () => {
  it("finds the raw download name from the folder-derived ID", async () => {
    await writeFile(path.join(tmp, "image-meta-GTB002.json"), "{}");
    const m = await findById(tmp, "GTB-2");
    expect(m?.file).toBe(path.join(tmp, "image-meta-GTB002.json"));
    expect(m?.others).toEqual([]);
  });

  it("gives every spelling of the ID the same file", async () => {
    await writeFile(path.join(tmp, "ANP-3.json"), "{}");
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(path.join(tmp, "image-meta-ANP003.json"), "{}");
    for (const typed of ["ANP-3", "ANP003", "image-meta-ANP003", "products-ANP003", "ANP 3"]) {
      const m = await findById(tmp, typed);
      expect(path.basename(m!.file)).toBe("image-meta-ANP003.json"); // the newest, whatever you typed
    }
  });

  it("takes the newest of two names for the same product, and reports the other", async () => {
    // Both files ARE this product, so there is nothing to ask: the one saved last is current.
    await writeFile(path.join(tmp, "ANP003.json"), "{}");
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(path.join(tmp, "image-meta-ANP003.json"), "{}");
    const m = await findById(tmp, "ANP 3");
    expect(path.basename(m!.file)).toBe("image-meta-ANP003.json");
    expect(m!.others.map((f) => path.basename(f))).toEqual(["ANP003.json"]);
  });

  it("still returns null rather than guessing at a near miss", async () => {
    await writeFile(path.join(tmp, "ANP-1.json"), "{}");
    expect(await findById(tmp, "ANP-3")).toBeNull();
    expect(await findById(path.join(tmp, "nope"), "ANP-3")).toBeNull();
  });

  it("ignores the bundled EXAMPLE and underscore files", async () => {
    await writeFile(path.join(tmp, "EXAMPLE-ANP-1042.json"), "{}");
    await writeFile(path.join(tmp, "_ANP-5.json"), "{}");
    expect(await findById(tmp, "ANP-1042")).toBeNull();
    expect(await findById(tmp, "ANP-5")).toBeNull();
  });

  // The three ways "no file matches" happens used to be ONE sentence that named no folder, so
  // creating products/ by hand changed nothing visible and read as "it cannot see my folder".
  it("says which of the three no-match states it is, and where it looked", async () => {
    const missing = path.join(tmp, "nope");
    expect(await whyNoMatch(missing, "ANP-3")).toContain(missing);
    expect(await whyNoMatch(missing, "ANP-3")).toContain("does not exist");

    expect(await whyNoMatch(tmp, "ANP-3")).toContain("empty");

    await writeFile(path.join(tmp, "GTB002.json"), "{}");
    const busy = await whyNoMatch(tmp, "ANP-3");
    expect(busy).toContain("GTB002.json"); // what IS there is the whole point
    expect(busy).toContain('"ANP3"'); // the normalised key it looked for
  });

  it("is what descriptionsFor uses — a prefixed file reaches the images", async () => {
    // The end-to-end version of the same claim, at the layer the CLIs actually call.
    const meta = path.join(tmp, "image-meta");
    await mkdir(meta, { recursive: true });
    await writeFile(path.join(meta, "image-meta-ANP003.json"), JSON.stringify({ title: "T", images: { "1": "hello" } }));
    process.env.WW_META_DIR = meta;
    process.env.WW_PRODUCTS_DIR = path.join(tmp, "products");
    const { descriptionsFor } = await import("../src/image-meta.js");
    const d = await descriptionsFor("ANP-3");
    expect(d.source).toContain("image-meta-ANP003.json");
    expect(d.perImage["1"]).toBe("hello");
  });
});

/**
 * The SKU prefix flag (WW-154). It decides whether a listing gets marked as belonging to a
 * different seller account, so the one case that must never regress is the empty prefix: an
 * account without one has to be flagged NEVER, not always.
 */
describe("isForAccount", () => {
  it("never flags an account that set no prefix", () => {
    expect(isForAccount("ANP3", undefined)).toBe(true);
    expect(isForAccount("ANP3", "")).toBe(true);
    expect(isForAccount("ANP3", "  ")).toBe(true);
  });

  it("matches however the ID and the prefix were written", () => {
    for (const id of ["GTB4", "GTB-4", "GTB 004", "gtb002"]) {
      expect(isForAccount(normalizeId(id), "GTB")).toBe(true);
      expect(isForAccount(normalizeId(id), "gtb")).toBe(true);
    }
  });

  it("flags another account's SKU", () => {
    expect(isForAccount("ANP3", "GTB")).toBe(false);
    // A prefix that is only PART of the ID's prefix is not a match either way round.
    expect(isForAccount("GT4", "GTB")).toBe(false);
  });
});

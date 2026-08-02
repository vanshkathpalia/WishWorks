/**
 * inbox.test.ts — filing the AI's downloads is the one new step that WRITES into the folders
 * every later command reads. The two rules that make it safe to press repeatedly are the two
 * things worth pinning:
 *
 *   1. Which folder a file goes to is decided by its CONTENT, never its name. A hand-renamed
 *      `ANP003.json` has no prefix left, and guessing wrong files a listing's Flipkart fields
 *      under image-meta where nothing will ever read them.
 *   2. Nothing already filed is replaced by something older. Otherwise re-running the button
 *      after an edit would quietly undo it.
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm, utimes, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classify, scanInbox, importInbox } from "../src/inbox.js";

let tmp: string;
let downloads: string;
let meta: string;
let products: string;
const created: string[] = [];

const META_SHAPE = { title: "A kit", keywords: ["a"], meesho: { title: "x" } };
const PRODUCT_SHAPE = { values: { "Model Name": "A kit" } };

/** Write a JSON file with an explicit mtime, so "newer" is decided by the test, not the clock. */
async function put(dir: string, name: string, data: unknown, minutesAgo = 0): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(data));
  const t = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(file, t, t);
  return file;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "ww-inbox-"));
  created.push(tmp);
  downloads = path.join(tmp, "Downloads");
  meta = path.join(tmp, "image-meta");
  products = path.join(tmp, "products");
  for (const d of [downloads, meta, products]) await mkdir(d, { recursive: true });
});

afterAll(async () => {
  for (const d of created) await rm(d, { recursive: true, force: true });
});

const dirs = () => ({ meta, products });

describe("classify", () => {
  it("reads the shape, not the name", () => {
    expect(classify(PRODUCT_SHAPE)).toBe("products");
    expect(classify(META_SHAPE)).toBe("image-meta");
  });

  it("returns null rather than guessing", () => {
    // A wrong guess files a listing's copy under the wrong marketplace and is silent until
    // somebody reads the output — worse than refusing.
    expect(classify({ something: "else" })).toBeNull();
    expect(classify(null)).toBeNull();
    expect(classify("a string")).toBeNull();
  });
});

describe("scanInbox", () => {
  it("routes by content even when the name says nothing", async () => {
    await put(downloads, "ANP003.json", PRODUCT_SHAPE);
    const [item] = await scanInbox(downloads, dirs());
    expect(item.half).toBe("products");
    expect(item.id).toBe("ANP3");
    expect(item.action).toBe("new");
  });

  it("marks a download older than what is filed, and does not import it", async () => {
    await put(meta, "ANP003.json", META_SHAPE, 0); // filed just now
    await put(downloads, "image-meta-ANP003.json", META_SHAPE, 60); // downloaded an hour ago

    const [item] = await scanInbox(downloads, dirs());
    expect(item.action).toBe("older");

    const { imported, skipped } = await importInbox(downloads, dirs());
    expect(imported).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("marks a newer download as an update", async () => {
    await put(meta, "ANP003.json", META_SHAPE, 60);
    await put(downloads, "image-meta-ANP003.json", { ...META_SHAPE, title: "newer" }, 0);

    const [item] = await scanInbox(downloads, dirs());
    expect(item.action).toBe("update");
  });

  it("ignores files that are not ours", async () => {
    await writeFile(path.join(downloads, "notes.txt"), "hello");
    await writeFile(path.join(downloads, "broken.json"), "{not json");
    const items = await scanInbox(downloads, dirs());
    expect(items).toEqual([]);
  });

  it("newest first", async () => {
    await put(downloads, "old.json", META_SHAPE, 90);
    await put(downloads, "new.json", META_SHAPE, 1);
    const items = await scanInbox(downloads, dirs());
    expect(items.map((i) => path.basename(i.file))).toEqual(["new.json", "old.json"]);
  });
});

describe("importInbox", () => {
  it("drops the download prefix and files each half in its own folder", async () => {
    await put(downloads, "image-meta-GTB002.json", META_SHAPE);
    await put(downloads, "products-GTB002.json", PRODUCT_SHAPE);

    const { imported } = await importInbox(downloads, dirs());
    expect(imported).toHaveLength(2);
    // The prefix existed only to keep two downloads apart in ONE folder (WW-080). In separate
    // folders it is noise, and findById matches either way.
    expect(await readdir(meta)).toEqual(["GTB002.json"]);
    expect(await readdir(products)).toEqual(["GTB002.json"]);
  });

  it("copies by default, leaving the download where it was", async () => {
    await put(downloads, "image-meta-GTB002.json", META_SHAPE);
    await importInbox(downloads, dirs());
    expect(await readdir(downloads)).toEqual(["image-meta-GTB002.json"]);
  });

  it("moves when asked", async () => {
    await put(downloads, "image-meta-GTB002.json", META_SHAPE);
    await importInbox(downloads, { ...dirs(), move: true });
    expect(await readdir(downloads)).toEqual([]);
    expect(await readdir(meta)).toEqual(["GTB002.json"]);
  });

  it("running twice changes nothing the second time", async () => {
    await put(downloads, "image-meta-GTB002.json", META_SHAPE);
    const first = await importInbox(downloads, dirs());
    const second = await importInbox(downloads, dirs());
    expect(first.imported).toHaveLength(1);
    expect(second.imported).toEqual([]);
  });

  it("never overwrites a filed file with an older download", async () => {
    await put(meta, "GTB002.json", { ...META_SHAPE, title: "the good one" }, 0);
    await put(downloads, "image-meta-GTB002.json", { ...META_SHAPE, title: "stale" }, 120);

    await importInbox(downloads, dirs());
    const kept = JSON.parse(await readFile(path.join(meta, "GTB002.json"), "utf8"));
    expect(kept.title).toBe("the good one");
  });

  it("only imports the files it was given", async () => {
    const wanted = await put(downloads, "image-meta-A1.json", META_SHAPE);
    await put(downloads, "image-meta-B2.json", META_SHAPE);

    const { imported } = await importInbox(downloads, { ...dirs(), only: [wanted] });
    expect(imported).toHaveLength(1);
    expect(await readdir(meta)).toEqual(["A1.json"]);
  });
});

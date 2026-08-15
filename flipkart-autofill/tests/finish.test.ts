/**
 * finish.test.ts — end-to-end tests for `npm run finish` (the already-clean shortcut).
 *
 * Runs the real CLI as a subprocess against throwaway temp folders, asserting on the flat files
 * it writes to --out. Covers the three simplifications added for the WhatsApp-folder workflow:
 * whole-tree recursion, the same-position collision guard, and --square. Nothing here touches
 * your real images/ or image-meta/ folders (WW_META_DIR / WW_PRODUCTS_DIR point at temp).
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { finishedName, nameWords, skuGroup } from "../src/finish-core.js";
import { NO_DESCRIPTIONS } from "../src/image-meta.js";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "src", "finish.ts");
const PROJECT = path.join(HERE, "..");

let tmp: string;
const created: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "ww-finish-"));
  created.push(tmp);
  // Empty meta/products dirs so no real descriptions leak in — we only assert on filenames/dims.
  await mkdir(path.join(tmp, "image-meta"), { recursive: true });
  await mkdir(path.join(tmp, "products"), { recursive: true });
});

afterAll(async () => {
  for (const d of created) await rm(d, { recursive: true, force: true });
});

/**
 * Run the finish CLI. Never throws on non-zero exit — returns the code so tests can assert.
 *
 * Invoked as `node --import tsx <cli>` rather than `npx tsx <cli>`: on Windows `npx` is
 * `npx.cmd`, and since the 2024 argument-injection fix Node refuses to spawn a `.cmd` without
 * `shell: true`. That threw ENOENT for every case here on the first CI run — 87 failures across
 * four files, all green on macOS. `shell: true` would "fix" it and then break on the temp paths,
 * which contain spaces. Going straight to the current node binary avoids both.
 */
async function run(args: string[]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--import", "tsx", CLI, ...args], {
      cwd: PROJECT,
      env: {
        ...process.env,
        WW_META_DIR: path.join(tmp, "image-meta"),
        WW_PRODUCTS_DIR: path.join(tmp, "products"),
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, out: stdout + stderr };
  } catch (e: any) {
    return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** Write a solid-colour image at a path under tmp. Defaults to white so it pads (not crops). */
async function makeImage(
  rel: string,
  w = 100,
  h = 100,
  bg: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 },
) {
  const file = path.join(tmp, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .png()
    .toFile(file);
  return file;
}

/**
 * Every finished file, as `GROUP/name`. Finished images are filed under the letters their ID
 * starts with (`skuGroup`) — the ready folder is the one that gets shared on Drive, so it is the
 * one that fills up. The folder is part of what these tests assert, not scaffolding around it.
 */
async function outFiles(): Promise<string[]> {
  const root = path.join(tmp, "out");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      files.push(...(await readdir(path.join(root, e.name))).map((f) => `${e.name}/${f}`));
    } else files.push(e.name);
  }
  return files.sort();
}

describe("finish — whole-tree recursion", () => {
  it("finds every listing under a two-level tree in one run", async () => {
    await makeImage("src/ANP/ANP 1/1.png");
    await makeImage("src/ANP/ANP 1/2.png");
    await makeImage("src/GTB/GTB 2/1.png");

    const { code, out } = await run([`--in=${path.join(tmp, "src")}`, `--out=${path.join(tmp, "out")}`]);

    expect(code).toBe(0);
    expect(await outFiles()).toEqual(["ANP/ANP-1.1.jpg", "ANP/ANP-1.2.jpg", "GTB/GTB-2.1.jpg"]);
    expect(out).toMatch(/Finishing every listing/);
  });

  it("gives descriptive folders a clean slug ID and drops the '- p' pending flag, no --id needed", async () => {
    await makeImage("src/HBD-T/HBD-kitty/1.png");
    await makeImage("src/HBD-T/HBD-space - p/1.png"); // "- p" is the pending flag → dropped from the ID

    const { code } = await run([`--in=${path.join(tmp, "src")}`, `--out=${path.join(tmp, "out")}`]);

    expect(code).toBe(0);
    expect(await outFiles()).toEqual(["HBD/HBD-kitty.1.jpg", "HBD/HBD-space.1.jpg"]);
  });

  it("errors when no listing folders are found under the tree", async () => {
    await mkdir(path.join(tmp, "src", "empty-category"), { recursive: true });
    const { code, out } = await run([`--in=${path.join(tmp, "src")}`, `--out=${path.join(tmp, "out")}`]);
    expect(code).not.toBe(0);
    expect(out).toMatch(/No listing folders/);
  });
});

describe("finish — collision guard", () => {
  it("refuses a listing that has two files at the same position and writes nothing for it", async () => {
    await makeImage("src/HA 1/1.png"); // the AI's new main
    await makeImage("src/HA 1/1.jpg"); // the old one, not deleted
    await makeImage("src/HA 1/2.png");

    const { out } = await run([`--in=${path.join(tmp, "src", "HA 1")}`, `--out=${path.join(tmp, "out")}`]);

    expect(out).toMatch(/share a position number/);
    // Nothing written for the clashing listing — better a loud stop than a silent shift.
    expect(await outFiles()).toEqual([]);
  });
});

describe("finish — --square", () => {
  it("leaves pixels non-square by default", async () => {
    await makeImage("src/WB 1/1.png", 100, 60);
    const { code } = await run([`--in=${path.join(tmp, "src", "WB 1")}`, `--out=${path.join(tmp, "out")}`]);
    expect(code).toBe(0);
    const meta = await sharp(path.join(tmp, "out", "WB", "WB-1.1.jpg")).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(60);
  });

  it("says so when an image is not 1:1, and stays quiet about small-but-square", async () => {
    // The ratio is never a deliberate choice; the pixel count is (SHIPPING-COST.md), so a small
    // square image must produce no warning at all.
    await makeImage("src/WB 1/1.png", 100, 60);
    await makeImage("src/WB 1/2.png", 350, 350);
    const { out } = await run([`--in=${path.join(tmp, "src", "WB 1")}`, `--out=${path.join(tmp, "out")}`]);
    expect(out).toContain("NOT SQUARE 100x60");
    expect(out).not.toContain("350px");
    expect(out.match(/NOT SQUARE/g)).toHaveLength(1); // only the 100x60, not the 350x350
  });

  it("does not warn about the ratio when --square already fixed it", async () => {
    await makeImage("src/WB 1/1.png", 100, 60);
    const { out } = await run([
      `--in=${path.join(tmp, "src", "WB 1")}`,
      `--out=${path.join(tmp, "out")}`,
      "--square",
    ]);
    expect(out).not.toContain("NOT SQUARE");
    expect(out).toContain("squared:");
  });

  it("pads a white-background image to 1:1 with --square", async () => {
    await makeImage("src/WB 1/1.png", 100, 60);
    const { code } = await run([
      `--in=${path.join(tmp, "src", "WB 1")}`,
      `--out=${path.join(tmp, "out")}`,
      "--square",
    ]);
    expect(code).toBe(0);
    const meta = await sharp(path.join(tmp, "out", "WB", "WB-1.1.jpg")).metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBe(100);
  });
});

/**
 * A small image is usually the seller's deliberate choice — Meesho prices shipping off the main
 * image (SHIPPING-COST.md) — so this note must never resize, never block, and never tell anyone
 * to fetch a bigger original. It exists only so "deliberate" and "nobody noticed" stop leaving
 * the same trace. See learning note 7.
 */
describe("small images are reported, never refused", () => {
  it("names the size and still writes the file, with the metadata in it", async () => {
    await makeImage("src/GTB 2/1.png", 350, 350);
    const { code, out } = await run([
      `--in=${path.join(tmp, "src", "GTB 2")}`,
      `--out=${path.join(tmp, "out")}`,
    ]);
    expect(code).toBe(0);
    expect(out).toContain("SMALL 350x350");
    expect(await outFiles()).toContain("GTB/GTB-2.1.jpg");
  });

  it("does not prescribe a bigger original — that is the wrong advice here", async () => {
    await makeImage("src/GTB 2/1.png", 350, 350);
    const { out } = await run([`--in=${path.join(tmp, "src", "GTB 2")}`, `--out=${path.join(tmp, "out")}`]);
    expect(out).not.toContain("larger original");
    expect(out).toContain("your shipping choice");
  });

  it("adds the rejection caution only under ~500px", async () => {
    await makeImage("src/GTB 2/1.png", 350, 350);
    const small = await run([`--in=${path.join(tmp, "src", "GTB 2")}`, `--out=${path.join(tmp, "out")}`]);
    expect(small.out).toContain("Meesho may reject");

    await makeImage("src/GTB 3/1.png", 800, 800);
    const mid = await run([`--in=${path.join(tmp, "src", "GTB 3")}`, `--out=${path.join(tmp, "out")}`]);
    expect(mid.out).toContain("SMALL 800x800");
    expect(mid.out).not.toContain("Meesho may reject");
  });

  it("says nothing at all about a full-size image", async () => {
    await makeImage("src/GTB 4/1.png", 1254, 1254);
    const { out } = await run([`--in=${path.join(tmp, "src", "GTB 4")}`, `--out=${path.join(tmp, "out")}`]);
    expect(out).not.toContain("SMALL");
  });
});

/**
 * The finished filename (WW-149). The rename always happened — this is only about which string it
 * writes. Whether a marketplace reads any of it is unproven (image-playbook Part 4); what these
 * pin is the part that is not about SEO at all: the ID leads so a listing's images sort together,
 * and the POSITION stays last so 1-2-3-4 upload in order. Image 1 is the main image, and a name
 * that sorts wrong puts the infographic on the search grid.
 */
describe("what a finished image is called", () => {
  const words = (title: string | null, keywords: string[] = []) =>
    nameWords({ ...NO_DESCRIPTIONS, title, keywords });

  it("puts the ID first, the words in the middle and the position last", () => {
    expect(finishedName("ANP003", 1, words("Annaprashan Decoration Kit Red Gold"))).toBe(
      "ANP003-annaprashan-decoration-kit-red-gold-1.jpg",
    );
  });

  it("drops the piece count in brackets — it is length, and it changes per listing", () => {
    expect(finishedName("GTB-2", 2, words("Groom To Be Kit (Set of 44 Pcs)"))).toBe(
      "GTB-2-groom-to-be-kit-2.jpg",
    );
  });

  it("falls back to a keyword when there is no title, and to the plain name when there is neither", () => {
    expect(finishedName("K1", 1, words(null, ["baby shower decoration"]))).toBe(
      "K1-baby-shower-decoration-1.jpg",
    );
    // No copy file yet is normal — a listing is often finished before its copy exists, so this
    // must keep working rather than fail or invent words.
    expect(finishedName("K1", 3, nameWords(NO_DESCRIPTIONS))).toBe("K1.3.jpg");
  });

  it("cuts a long title on a whole word, never mid-syllable", () => {
    const name = finishedName("X", 1, words(
      "Annaprashan Rice Ceremony Decoration Kit Red And Golden Metallic Balloons With Banner",
    ));
    expect(name.length).toBeLessThan(80);
    expect(name).toBe("X-annaprashan-rice-ceremony-decoration-kit-red-and-golden-1.jpg");
  });

  it("survives punctuation, symbols and runs of spaces without producing a broken filename", () => {
    const name = finishedName("ID", 1, words("  Kit: 20% More!! — Red/Gold  "));
    expect(name).toBe("ID-kit-20-more-red-gold-1.jpg");
    expect(name).not.toMatch(/[^A-Za-z0-9.\-]/); // nothing a filesystem would argue with
  });

  it("really reaches the file on disk, not just the helper", async () => {
    await makeImage("src/GTB 9/1.png");
    await writeFile(
      path.join(tmp, "image-meta", "GTB-9.json"),
      JSON.stringify({ title: "Groom To Be Decoration Kit Black Gold", keywords: [], images: {} }),
    );
    const { code } = await run([`--in=${path.join(tmp, "src", "GTB 9")}`, `--out=${path.join(tmp, "out")}`]);
    expect(code).toBe(0);
    expect(await outFiles()).toContain(
      "GTB/GTB-9-groom-to-be-decoration-kit-black-gold-1.jpg",
    );
  });
});

/**
 * Which subfolder of the ready folder a listing lands in. The ready folder is the one that gets
 * shared on Drive, so it is the one that fills up — GTB with GTB, ANP with ANP (2026-08-15).
 */
describe("skuGroup", () => {
  it("groups by the letters the ID starts with, whatever follows", () => {
    expect(skuGroup("ANP-3")).toBe("ANP");
    expect(skuGroup("GTB-9")).toBe("GTB");
    expect(skuGroup("HBD-kitty")).toBe("HBD"); // descriptive IDs group with their code too
  });

  // A combo carries two codes and belongs to what it IS, not to the number it was given.
  it("files a combo under its LAST code", () => {
    expect(skuGroup("SVP033 - ANP002")).toBe("ANP");
    expect(skuGroup("WKU003-GTB001")).toBe("GTB");
  });

  // The fussy half: these are HBD kits NAMED Kitty and Doraemon, not a KITTY category.
  it("does not mistake a variant name for a second code", () => {
    expect(skuGroup("HBD-Kitty01")).toBe("HBD");
    expect(skuGroup("HBD-DORE01-doubt-price")).toBe("HBD");
  });

  // The renderer draws the groups from its own copy of this rule; if they drift, a kit reads ANP
  // on screen and sits in WKU/ on the Drive folder everyone shares.
  it("agrees with skuPrefix, the renderer's copy", async () => {
    const { skuPrefix } = await import("../gui/shared.js");
    for (const id of [
      "ANP-3", "GTB-9", "HBD-kitty", "123", "", "SVP033 - ANP002", "WKU003-GTB001",
      "WKU001-ANP001", "HBD-Kitty01", "HBD-DORE01-doubt-price", "gtb002(2)", "WB001", "kit",
    ]) {
      expect(skuPrefix(id)).toBe(skuGroup(id));
    }
  });

  it("keeps an ID with no leading letters in the root rather than inventing a folder", () => {
    // A grouping nobody can predict is worse than no grouping.
    expect(skuGroup("123")).toBe("");
    expect(skuGroup("")).toBe("");
  });
});

/**
 * images.test.ts — end-to-end tests for `npm run images`.
 *
 * Runs the real CLI as a subprocess against a throwaway temp directory (WW_IMAGES_DIR /
 * WW_PRODUCTS_DIR), so these exercise argv parsing, both stages, and the actual files
 * written — not mocks. Nothing here touches your real images/ or products/ folders.
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type Region } from "sharp";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "src", "images.ts");
const PROJECT = path.join(HERE, "..");

let tmp: string;
const created: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "ww-images-"));
  created.push(tmp);
  await mkdir(path.join(tmp, "products"), { recursive: true });
});

afterAll(async () => {
  for (const d of created) await rm(d, { recursive: true, force: true });
});

/** Run the CLI. Never throws on non-zero exit — returns the code so tests can assert on it. */
async function run(args: string[] = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--import", "tsx", CLI, ...args], {
      cwd: PROJECT,
      env: {
        ...process.env,
        WW_IMAGES_DIR: path.join(tmp, "images"),
        WW_PRODUCTS_DIR: path.join(tmp, "products"),
        WW_META_DIR: path.join(tmp, "image-meta"),
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, out: stdout + stderr };
  } catch (e: any) {
    return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

type Fmt = "webp" | "png" | "jpeg" | "avif";

/** Write a test image: solid background with a centred red square (so distortion is visible). */
async function makeImage(
  rel: string,
  w: number,
  h: number,
  bg: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 },
  fmt: Fmt = "webp",
) {
  const file = path.join(tmp, "images", rel);
  await mkdir(path.dirname(file), { recursive: true });
  const side = Math.round(Math.min(w, h) * 0.5);
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="${(w - side) / 2}" y="${(h - side) / 2}" width="${side}" height="${side}" fill="rgb(220,20,60)"/></svg>`,
  );
  const img = sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite([
    { input: svg, top: 0, left: 0 },
  ]);
  await (fmt === "jpeg" ? img.jpeg() : fmt === "png" ? img.png() : fmt === "avif" ? img.avif() : img.webp()).toFile(file);
  return file;
}

async function writeProduct(id: string, body: unknown) {
  await writeFile(path.join(tmp, "products", `${id}.json`), JSON.stringify(body, null, 2));
}

async function meta(rel: string) {
  return sharp(path.join(tmp, "images", rel)).metadata();
}

/** Text of the EXIF ImageDescription, or null. */
async function description(rel: string): Promise<string | null> {
  const m = await meta(rel);
  if (!m.exif) return null;
  const s = m.exif.toString("latin1").replace(/[^\x20-\x7e]+/g, " ");
  return s.trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("stage 1 — raw → clean", () => {
  it("accepts .avif, the format Meesho actually serves", async () => {
    await makeImage("1-raw/ANP-1/1.avif", 900, 900, undefined, "avif");
    const { out } = await run();
    expect(out).toContain("1.avif");
    expect(out).toContain("-> ");
    const m = await meta("2-clean/ANP-1/1.jpg");
    expect(m.format).toBe("jpeg");
  });

  it.each([
    ["webp", "webp"],
    ["png", "png"],
    ["jpeg", "jpg"],
  ] as const)("accepts .%s input", async (fmt, ext) => {
    await makeImage(`1-raw/P/1.${ext}`, 800, 800, undefined, fmt);
    await run();
    expect((await meta("2-clean/P/1.jpg")).format).toBe("jpeg");
  });

  it("always outputs exactly 1500x1500, whatever the input shape", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1100); // white, landscape
    await makeImage("1-raw/P/2.webp", 900, 1400); // white, portrait
    await makeImage("1-raw/P/3.webp", 1000, 1000); // square
    await makeImage("1-raw/P/4.webp", 1400, 900, { r: 90, g: 60, b: 30 }); // dark, landscape
    await run();
    for (const n of [1, 2, 3, 4]) {
      const m = await meta(`2-clean/P/${n}.jpg`);
      expect([m.width, m.height], `image ${n}`).toEqual([1500, 1500]);
    }
  });

  it("outputs sRGB, never CMYK", async () => {
    await makeImage("1-raw/P/1.webp", 800, 800);
    await run();
    expect((await meta("2-clean/P/1.jpg")).space).toBe("srgb");
  });

  it("keeps output well under the 5MB cap", async () => {
    await makeImage("1-raw/P/1.webp", 2000, 2000);
    await run();
    const buf = await readFile(path.join(tmp, "images", "2-clean/P/1.jpg"));
    expect(buf.length).toBeLessThan(5 * 1024 * 1024);
  });

  it("names outputs as plain numbers so AI replacements drop straight in", async () => {
    await makeImage("1-raw/ANP-1042/1.webp", 800, 800);
    await makeImage("1-raw/ANP-1042/2.webp", 800, 800);
    await run();
    expect((await readdir(path.join(tmp, "images", "2-clean/ANP-1042"))).sort()).toEqual([
      "1.jpg",
      "2.jpg",
    ]);
  });
});

describe("squaring", () => {
  it("pads with white when the background is white", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1000);
    const { out } = await run();
    expect(out).toContain("padded white");
  });

  it("centre-crops when the background is not white", async () => {
    await makeImage("1-raw/P/1.webp", 1400, 900, { r: 40, g: 40, b: 40 });
    const { out } = await run();
    expect(out).toContain("centre-cropped");
  });

  it("does not distort the product when padding (a square stays square)", async () => {
    // 1200x800 white with a centred red square. After padding + resize the red region must
    // still be square — if resize ran before extend (the C-010 bug) it would be stretched.
    await makeImage("1-raw/P/1.webp", 1200, 800);
    await run();
    const trimmed = await sharp(path.join(tmp, "images", "2-clean/P/1.jpg"))
      .trim({ threshold: 40 })
      .toBuffer({ resolveWithObject: true });
    const { width, height } = trimmed.info;
    const ratio = width / height;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });
});

describe("--border (experimental Meesho shipping lever)", () => {
  it("keeps the output exactly 1500x1500 — the frame insets, it does not grow the image", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1200, { r: 40, g: 40, b: 40 });
    await run(["--border=20"]);
    const m = await meta("2-clean/P/1.jpg");
    expect(m.width).toBe(1500);
    expect(m.height).toBe(1500);
  });

  /**
   * Mean brightness of one patch of an output image.
   *
   * The extract MUST be rendered to a buffer before measuring: sharp's .stats() reads the
   * INPUT image and ignores queued operations, so `sharp(f).extract(...).stats()` silently
   * measures the whole picture instead of the patch. Same trap square.ts documents.
   */
  async function patch(rel: string, left: number, top: number): Promise<number> {
    const buf = await sharp(path.join(tmp, "images", rel))
      .extract({ left, top, width: 8, height: 8 })
      .toBuffer();
    const { channels } = await sharp(buf).stats();
    // Mean across RGB, not the red channel alone — the fixture's crimson square reads 220 on
    // red, indistinguishable from white if you only look at one channel.
    const rgb = channels.slice(0, 3);
    return rgb.reduce((sum, c) => sum + c.mean, 0) / rgb.length;
  }

  it("actually paints a white frame at the edge", async () => {
    // A dark image: with a border the outer ring must be white, the centre still dark.
    await makeImage("1-raw/P/1.webp", 1200, 1200, { r: 20, g: 20, b: 20 });
    await run(["--border=20"]);
    expect(await patch("2-clean/P/1.jpg", 2, 2)).toBeGreaterThan(200); // white frame
    expect(await patch("2-clean/P/1.jpg", 700, 700)).toBeLessThan(120); // product untouched
  });

  it("is off by default — no frame unless asked for", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1200, { r: 20, g: 20, b: 20 });
    await run();
    expect(await patch("2-clean/P/1.jpg", 2, 2)).toBeLessThan(80);
  });

  it("rejects a border that would swallow the image", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1200);
    const { out } = await run(["--border=800"]);
    expect(out).toContain("--border needs a pixel width");
  });

  it("reports the frame it applied", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1200);
    const { out } = await run(["--border=20"]);
    expect(out).toContain("20px white border");
  });
});

describe("cropping the Meesho tag", () => {
  it("crops every image by default", async () => {
    for (const n of [1, 2, 3]) await makeImage(`1-raw/P/${n}.webp`, 1000, 1000);
    const { out } = await run(["--crop-bottom=60"]);
    expect(out).toContain("every image");
    expect(out.match(/cropped 60px off bottom/g)).toHaveLength(3);
  });

  it("narrows to the positions given by --crop-images", async () => {
    for (const n of [1, 2, 3]) await makeImage(`1-raw/P/${n}.webp`, 1000, 1000);
    const { out } = await run(["--crop-bottom=60", "--crop-images=1,3"]);
    expect(out.match(/cropped 60px off bottom/g)).toHaveLength(2);
  });

  it("actually removes pixels from the bottom", async () => {
    // Red strip along the bottom 100px stands in for the tag; after a 120px crop it is gone.
    const file = path.join(tmp, "images", "1-raw/P/1.png");
    await mkdir(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: Buffer.from(`<svg width="1000" height="1000"><rect x="0" y="900" width="1000" height="100" fill="red"/></svg>`), top: 0, left: 0 }])
      .png()
      .toFile(file);

    await run(["--crop-bottom=120"]);
    const stats = await sharp(path.join(tmp, "images", "2-clean/P/1.jpg")).stats();
    // With the red strip gone the image is pure white: red channel mean ≈ green ≈ blue.
    const [r, g, b] = stats.channels.map((c) => c.mean);
    expect(Math.abs(r - g)).toBeLessThan(6);
    expect(Math.abs(r - b)).toBeLessThan(6);
  });

  it("rejects a crop larger than the image instead of producing garbage", async () => {
    await makeImage("1-raw/P/1.webp", 500, 500);
    const { out } = await run(["--crop-bottom=600"]);
    expect(out).toContain("would remove the whole image");
  });

  it("rejects a non-numeric --crop-bottom", async () => {
    await makeImage("1-raw/P/1.webp", 800, 800);
    const { code, out } = await run(["--crop-bottom=abc"]);
    expect(code).not.toBe(0);
    expect(out).toContain("positive number of pixels");
  });
});

describe("erasing the tag instead of cropping", () => {
  /** White image with a black tag bottom-left and black content bottom-centre, same rows. */
  async function withTagAndContent() {
    const file = path.join(tmp, "images", "1-raw/P/1.png");
    await mkdir(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 250, g: 245, b: 240 } } })
      .composite([{
        input: Buffer.from(
          `<svg width="1000" height="1000">
             <rect x="10" y="950" width="200" height="30" fill="black"/>
             <rect x="450" y="955" width="150" height="25" fill="black"/>
           </svg>`),
        top: 0, left: 0,
      }])
      .png()
      .toFile(file);
  }

  /** Count dark pixels in a region of the output. */
  async function darkPixels(rel: string, region: Region) {
    const { data } = await sharp(path.join(tmp, "images", rel))
      .extract(region).greyscale().raw().toBuffer({ resolveWithObject: true });
    return data.reduce((n, v) => n + (v < 120 ? 1 : 0), 0);
  }

  it("removes the tag but keeps content at the same height", async () => {
    await withTagAndContent();
    await run(["--erase-tag=230,55"]);
    // output is 1500px; source 1000px, so bottom 45px → bottom ~68px, left 230 → ~345
    const tagGone = await darkPixels("2-clean/P/1.jpg", { left: 0, top: 1420, width: 340, height: 78 });
    const contentKept = await darkPixels("2-clean/P/1.jpg", { left: 600, top: 1420, width: 350, height: 78 });
    expect(tagGone).toBe(0);
    expect(contentKept).toBeGreaterThan(500);
  });

  it("fills with the sampled background colour, not assumed white", async () => {
    await withTagAndContent();
    await run(["--erase-tag=230,55"]);
    const { data } = await sharp(path.join(tmp, "images", "2-clean/P/1.jpg"))
      .extract({ left: 40, top: 1450, width: 20, height: 20 }).raw().toBuffer({ resolveWithObject: true });
    // background is rgb(250,245,240) — the patch must match it, not be pure white
    expect(data[0]).toBeGreaterThan(240);
    expect(data[0]).toBeLessThan(255);
    expect(data[1]).toBeLessThan(data[0] + 2);
  });

  it("reports what it erased", async () => {
    await withTagAndContent();
    const { out } = await run(["--erase-tag=230,55"]);
    expect(out).toContain("erased 230x55px tag at bottom-left");
  });

  it("rejects a patch bigger than the image", async () => {
    await makeImage("1-raw/P/1.webp", 500, 500);
    const { out } = await run(["--erase-tag=600,600"]);
    expect(out).toContain("bigger than the image");
  });

  it("rejects malformed --erase-tag", async () => {
    await makeImage("1-raw/P/1.webp", 800, 800);
    const { code, out } = await run(["--erase-tag=abc"]);
    expect(code).not.toBe(0);
    expect(out).toContain("width,height in pixels");
  });

  it("refuses --erase-tag in the final stage", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1200);
    await run();
    const { code, out } = await run(["--final", "--erase-tag=100,20"]);
    expect(code).not.toBe(0);
    expect(out).toContain("belongs in stage 1");
  });
});

describe("stage 2 — clean → final", () => {
  async function stage1(id = "ANP-1042", count = 4) {
    for (let n = 1; n <= count; n++) await makeImage(`1-raw/${id}/${n}.webp`, 1200, 1200);
    await run();
  }

  it("renames with the product ID so upload order is unambiguous", async () => {
    await stage1("ANP-1042", 2);
    // --force: this listing has no description file, and the rename is what is under test here.
    await run(["--final", "--force"]);
    expect((await readdir(path.join(tmp, "images", "3-final/ANP-1042"))).sort()).toEqual([
      "ANP-1042-1.jpg",
      "ANP-1042-2.jpg",
    ]);
  });

  it("refuses to crop again — the tag is removed once, in stage 1", async () => {
    await stage1("P", 1);
    const { code, out } = await run(["--final", "--crop-bottom=40"]);
    expect(code).not.toBe(0);
    expect(out).toContain("does nothing in the --final stage");
  });

  it("writes each image its OWN description", async () => {
    await stage1("ANP-1042", 2);
    await writeProduct("ANP-1042", {
      images: { "1": "DECORATED-BACKDROP-MARKER", "2": "PACK-CONTENTS-MARKER" },
      values: { "Model Name": "Kit" },
    });
    await run(["--final"]);
    expect(await description("3-final/ANP-1042/ANP-1042-1.jpg")).toContain("DECORATED-BACKDROP-MARKER");
    expect(await description("3-final/ANP-1042/ANP-1042-2.jpg")).toContain("PACK-CONTENTS-MARKER");
  });

  it("falls back to Model Name + keywords for positions with no description, and says so", async () => {
    await stage1("ANP-1042", 3);
    await writeProduct("ANP-1042", {
      images: { "1": "ONLY-FIRST-MARKER" },
      values: { "Model Name": "FallbackKit", "Search Keywords": ["kw-marker"] },
    });
    const { out } = await run(["--final"]);
    expect(out).toContain("no per-image description for position 2");
    const d3 = await description("3-final/ANP-1042/ANP-1042-3.jpg");
    expect(d3).toContain("FallbackKit");
    expect(d3).toContain("kw-marker");
  });

  it("writes NO description in stage 1 — the AI has not written them yet", async () => {
    await makeImage("1-raw/ANP-1042/1.webp", 1200, 1200);
    await writeProduct("ANP-1042", { images: { "1": "SHOULD-NOT-APPEAR-YET" }, values: {} });
    await run();
    const d = await description("2-clean/ANP-1042/1.jpg");
    expect(d ?? "").not.toContain("SHOULD-NOT-APPEAR-YET");
  });

  // The folder name IS the product ID, so a renamed folder finds no description file and the
  // images come out looking perfect with nothing embedded. That used to be one line in the
  // results table. It now stops the run, and --force is the way past it.
  it("stops before writing when a folder has no description file", async () => {
    await stage1("NO-PRODUCT-FILE", 1);
    const { code, out } = await run(["--final"]);
    expect(code).not.toBe(0);
    expect(out).toContain("No description file");
    expect(out).toContain("NOT FOUND");
    await expect(meta("3-final/NO-PRODUCT-FILE/NO-PRODUCT-FILE-1.jpg")).rejects.toThrow();
  });

  it("--force finishes the images anyway, with no metadata", async () => {
    await stage1("NO-PRODUCT-FILE", 1);
    const { code } = await run(["--final", "--force"]);
    expect(code).toBe(0);
    expect((await meta("3-final/NO-PRODUCT-FILE/NO-PRODUCT-FILE-1.jpg")).width).toBe(1500);
  });

  it("names the file each folder resolved to, so a mismatch is visible", async () => {
    await stage1("SHOWN", 1);
    await mkdir(path.join(tmp, "image-meta"), { recursive: true });
    await writeFile(
      path.join(tmp, "image-meta", "SHOWN.json"),
      JSON.stringify({ title: "Kit", images: { "1": "a description" } }),
    );
    const { code, out } = await run(["--final"]);
    expect(code).toBe(0);
    expect(out).toContain("image-meta/SHOWN.json");
    expect(out).toContain("1 per-image description");
  });

  it("treats a malformed product file as missing rather than crashing", async () => {
    await stage1("BROKEN", 1);
    await writeFile(path.join(tmp, "products", "BROKEN.json"), "{ this is not json ");
    const { code, out } = await run(["--final"]);
    expect(code).not.toBe(0);
    expect(out).toContain("No description file");
    const forced = await run(["--final", "--force"]);
    expect(forced.code).toBe(0);
    expect((await meta("3-final/BROKEN/BROKEN-1.jpg")).width).toBe(1500);
  });
});

describe("metadata content", () => {
  async function finalWith(images: Record<string, string>, values: Record<string, unknown>) {
    await makeImage("1-raw/ANP-1042/1.webp", 1200, 1200);
    await run();
    await writeProduct("ANP-1042", { images, values });
    await run(["--final"]);
    return (await description("3-final/ANP-1042/ANP-1042-1.jpg")) ?? "";
  }

  it("combines the per-image line, the product name and the keywords", async () => {
    const d = await finalWith(
      { "1": "Red and gold balloon backdrop set up on a wall" },
      { "Model Name": "Annaprashan Kit 42 Pcs", "Search Keywords": ["rice ceremony decoration", "annaprashan items"] },
    );
    expect(d).toContain("Red and gold balloon backdrop");
    expect(d).toContain("Annaprashan Kit 42 Pcs");
    expect(d).toContain("rice ceremony decoration");
    expect(d).toContain("annaprashan items");
  });

  it("writes the attribution fields Google recommends", async () => {
    const d = await finalWith({ "1": "A backdrop" }, { "Model Name": "Kit" });
    expect(d).toContain("WishWorks"); // Artist
    expect(d).toContain("All rights reserved"); // Copyright
    expect(d).toContain("Listing Factory"); // Software
  });

  it("does not repeat the product name when the description already contains it", async () => {
    const d = await finalWith({ "1": "Annaprashan Kit 42 Pcs on a wall" }, { "Model Name": "Annaprashan Kit 42 Pcs" });
    expect(d.match(/Annaprashan Kit 42 Pcs/g)).toHaveLength(1);
  });

  it("caps runaway descriptions rather than bloating the file", async () => {
    const d = await finalWith({ "1": "x".repeat(400) }, { "Search Keywords": Array(60).fill("long-keyword-phrase") });
    const desc = d.slice(d.indexOf("xxx"));
    expect(desc.length).toBeLessThan(1000);
  });

  it("still writes attribution when only keywords exist", async () => {
    const d = await finalWith({}, { "Search Keywords": ["balloon-kit-marker"] });
    expect(d).toContain("balloon-kit-marker");
    expect(d).toContain("WishWorks");
  });
});

describe("image-meta/ vs products/ — Meesho needs no 66-field file", () => {
  async function writeMeta(id: string, body: unknown) {
    await mkdir(path.join(tmp, "image-meta"), { recursive: true });
    await writeFile(path.join(tmp, "image-meta", `${id}.json`), JSON.stringify(body, null, 2));
  }

  async function stage1(id: string) {
    await makeImage(`1-raw/${id}/1.webp`, 1200, 1200);
    await run();
  }

  it("reads image-meta/<ID>.json with no products/ file present", async () => {
    await stage1("MEESHO-ONLY");
    await writeMeta("MEESHO-ONLY", {
      title: "Meesho Kit 42 Pcs",
      keywords: ["meesho-keyword-marker"],
      images: { "1": "META-FILE-MARKER" },
    });
    const { code } = await run(["--final"]);
    expect(code).toBe(0);
    const d = (await description("3-final/MEESHO-ONLY/MEESHO-ONLY-1.jpg")) ?? "";
    expect(d).toContain("META-FILE-MARKER");
    expect(d).toContain("Meesho Kit 42 Pcs");
    expect(d).toContain("meesho-keyword-marker");
  });

  it("prefers image-meta/ when both files exist", async () => {
    await stage1("BOTH");
    await writeMeta("BOTH", { title: "FromMeta", images: { "1": "META-WINS" } });
    await writeProduct("BOTH", {
      images: { "1": "PRODUCT-LOSES" },
      values: { "Model Name": "FromProduct" },
    });
    await run(["--final"]);
    const d = (await description("3-final/BOTH/BOTH-1.jpg")) ?? "";
    expect(d).toContain("META-WINS");
    expect(d).not.toContain("PRODUCT-LOSES");
  });

  it("still falls back to products/<ID>.json for older single-file products", async () => {
    await stage1("LEGACY");
    await writeProduct("LEGACY", {
      images: { "1": "LEGACY-MARKER" },
      values: { "Model Name": "Legacy Kit", "Search Keywords": ["legacy-kw"] },
    });
    await run(["--final"]);
    const d = (await description("3-final/LEGACY/LEGACY-1.jpg")) ?? "";
    expect(d).toContain("LEGACY-MARKER");
    expect(d).toContain("legacy-kw");
  });
});

describe("mixing crop and erase in one run", () => {
  it("crops one position and erases the others", async () => {
    for (const n of [1, 2, 3]) await makeImage(`1-raw/P/${n}.webp`, 1000, 1000);
    const { out } = await run([
      "--crop-bottom=25", "--crop-images=1", "--erase-tag=150,30", "--erase-images=2,3",
    ]);
    expect(out).toContain("Cropping 25px off the bottom of image 1 only");
    expect(out).toContain("Erasing a 150x30px tag at bottom-left of image 2, 3");
    expect(out.match(/cropped 25px off bottom/g)).toHaveLength(1);
    expect(out.match(/erased 150x30px tag/g)).toHaveLength(2);
  });

  it("rejects malformed --erase-images", async () => {
    await makeImage("1-raw/P/1.webp", 800, 800);
    const { code, out } = await run(["--erase-tag=100,20", "--erase-images=x"]);
    expect(code).not.toBe(0);
    expect(out).toContain("positions like 2,3,4");
  });
});

describe("ordering and input handling", () => {
  it("orders numerically, not alphabetically (1,2,10 — not 1,10,2)", async () => {
    for (const n of [1, 2, 10]) await makeImage(`1-raw/P/${n}.webp`, 800, 800);
    await run();
    const files = (await readdir(path.join(tmp, "images", "2-clean/P"))).sort();
    expect(files).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
    // 10.webp must land in position 3, i.e. after 2 — alphabetical order would put it second
  });

  it("ignores non-image files", async () => {
    await makeImage("1-raw/P/1.webp", 800, 800);
    await writeFile(path.join(tmp, "images", "1-raw/P/notes.txt"), "hello");
    await writeFile(path.join(tmp, "images", "1-raw/P/.DS_Store"), "junk");
    await run();
    expect(await readdir(path.join(tmp, "images", "2-clean/P"))).toEqual(["1.jpg"]);
  });

  it("warns when files are not named as plain numbers", async () => {
    await makeImage("1-raw/P/main-shot.webp", 800, 800);
    const { out } = await run();
    expect(out).toContain("not named 1, 2, 3");
  });

  it("processes every product folder in one run", async () => {
    await makeImage("1-raw/ANP-1/1.webp", 800, 800);
    await makeImage("1-raw/GTB-2/1.webp", 800, 800);
    await run();
    expect((await meta("2-clean/ANP-1/1.jpg")).width).toBe(1500);
    expect((await meta("2-clean/GTB-2/1.jpg")).width).toBe(1500);
  });

  it("reports an empty inbox without failing", async () => {
    const { code, out } = await run();
    expect(code).toBe(0);
    expect(out).toContain("is empty");
  });

  it("tells you to run stage 1 first when 2-clean is empty", async () => {
    const { code, out } = await run(["--final"]);
    expect(code).toBe(0);
    expect(out).toContain("Run stage 1 first");
  });
});

describe("safety", () => {
  it("warns loudly when the source is under 1000px", async () => {
    await makeImage("1-raw/P/1.webp", 512, 512); // a real Meesho download
    const { out } = await run();
    expect(out).toContain("SOURCE ONLY 512px");
  });

  it("does not warn for a healthy source", async () => {
    await makeImage("1-raw/P/1.webp", 1600, 1600);
    const { out } = await run();
    expect(out).not.toContain("SOURCE ONLY");
  });

  it("never modifies the source files", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1000);
    const before = await readFile(path.join(tmp, "images", "1-raw/P/1.webp"));
    await run(["--crop-bottom=50"]);
    const after = await readFile(path.join(tmp, "images", "1-raw/P/1.webp"));
    expect(after.equals(before)).toBe(true);
  });

  it("is safe to re-run — same input, same output", async () => {
    await makeImage("1-raw/P/1.webp", 1200, 1000);
    await run(["--crop-bottom=50"]);
    const first = await readFile(path.join(tmp, "images", "2-clean/P/1.jpg"));
    await run(["--crop-bottom=50"]);
    const second = await readFile(path.join(tmp, "images", "2-clean/P/1.jpg"));
    expect(second.equals(first)).toBe(true);
  });

  it("keeps going when one file in a folder is corrupt", async () => {
    await makeImage("1-raw/P/1.webp", 900, 900);
    await writeFile(path.join(tmp, "images", "1-raw/P/2.webp"), "not an image at all");
    const { out } = await run();
    expect(out).toContain("Problems:");
    expect((await meta("2-clean/P/1.jpg")).width).toBe(1500); // good file still processed
  });
});

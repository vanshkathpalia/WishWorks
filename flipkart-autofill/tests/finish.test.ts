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
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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

/** Run the finish CLI. Never throws on non-zero exit — returns the code so tests can assert. */
async function run(args: string[]) {
  try {
    const { stdout, stderr } = await exec("npx", ["tsx", CLI, ...args], {
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

async function outFiles(): Promise<string[]> {
  try {
    return (await readdir(path.join(tmp, "out"))).sort();
  } catch {
    return [];
  }
}

describe("finish — whole-tree recursion", () => {
  it("finds every listing under a two-level tree in one run", async () => {
    await makeImage("src/ANP/ANP 1/1.png");
    await makeImage("src/ANP/ANP 1/2.png");
    await makeImage("src/GTB/GTB 2/1.png");

    const { code, out } = await run([`--in=${path.join(tmp, "src")}`, `--out=${path.join(tmp, "out")}`]);

    expect(code).toBe(0);
    expect(await outFiles()).toEqual(["ANP-1.1.jpg", "ANP-1.2.jpg", "GTB-2.1.jpg"]);
    expect(out).toMatch(/Finishing every listing/);
  });

  it("gives descriptive folders a clean slug ID and drops the '- p' pending flag, no --id needed", async () => {
    await makeImage("src/HBD-T/HBD-kitty/1.png");
    await makeImage("src/HBD-T/HBD-space - p/1.png"); // "- p" is the pending flag → dropped from the ID

    const { code } = await run([`--in=${path.join(tmp, "src")}`, `--out=${path.join(tmp, "out")}`]);

    expect(code).toBe(0);
    expect(await outFiles()).toEqual(["HBD-kitty.1.jpg", "HBD-space.1.jpg"]);
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
    const meta = await sharp(path.join(tmp, "out", "WB-1.1.jpg")).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(60);
  });

  it("pads a white-background image to 1:1 with --square", async () => {
    await makeImage("src/WB 1/1.png", 100, 60);
    const { code } = await run([
      `--in=${path.join(tmp, "src", "WB 1")}`,
      `--out=${path.join(tmp, "out")}`,
      "--square",
    ]);
    expect(code).toBe(0);
    const meta = await sharp(path.join(tmp, "out", "WB-1.1.jpg")).metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBe(100);
  });
});

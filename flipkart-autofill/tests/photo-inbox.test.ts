/**
 * photo-inbox.test.ts — the AI's pictures land in somebody's real archive, so the two things
 * worth pinning are: does every spelling of an ID find the same folder, and does filing a
 * picture remove the one it replaced?
 *
 * That second one is not tidiness. `finish` refuses to run a listing where `1.png` and `1.jpg`
 * both exist, because it cannot know which is position 1 — so a filing step that leaves both
 * behind breaks the next step every time.
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findListingFolders, scanPhotos, importPhoto } from "../src/photo-inbox.js";

let tmp: string;
let downloads: string;
let archive: string;
const created: string[] = [];

/** A listing folder is one that already holds numbered images — that is what makes it a listing. */
async function listingFolder(rel: string, files = ["1.jpg", "2.jpg"]): Promise<string> {
  const dir = path.join(archive, rel);
  await mkdir(dir, { recursive: true });
  for (const f of files) await writeFile(path.join(dir, f), "x");
  return dir;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "ww-photos-"));
  created.push(tmp);
  downloads = path.join(tmp, "Downloads");
  archive = path.join(tmp, "Whatsapp DW");
  await mkdir(downloads, { recursive: true });
  await mkdir(archive, { recursive: true });
});

afterAll(async () => {
  for (const d of created) await rm(d, { recursive: true, force: true });
});

describe("findListingFolders", () => {
  it("finds folders that hold images, not the categories above them", async () => {
    await listingFolder("ANP/ANP 1 - p");
    const found = await findListingFolders(archive);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("ANP-1");
    // "ANP" holds no images of its own, so it is a category and must not be offered.
    expect(found.map((f) => f.dir)).not.toContain(path.join(archive, "ANP"));
  });

  it("drops the pending flag, so a folder keeps matching after it comes off", async () => {
    await listingFolder("ANP/ANP 1 - p");
    const [pending] = await findListingFolders(archive);
    await rm(path.join(archive, "ANP"), { recursive: true });
    await listingFolder("ANP/ANP 1");
    const [done] = await findListingFolders(archive);
    expect(done.id).toBe(pending.id);
  });
});

describe("scanPhotos", () => {
  it("matches every spelling of the ID to the same folder", async () => {
    const dir = await listingFolder("ANP/ANP 1 - p");
    for (const n of ["ANP1-1.png", "ANP001-1.png", "ANP-1-1.png"]) {
      await writeFile(path.join(downloads, n), "x");
    }
    const items = await scanPhotos(downloads, archive);
    expect(items).toHaveLength(3);
    for (const i of items) {
      expect(i.target?.dir, path.basename(i.file)).toBe(dir);
      expect(i.id).toBe("ANP1");
    }
  });

  it("reads a trailing number as the position, not part of the ID", async () => {
    await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "ANP-1-2.png"), "x");
    const [item] = await scanPhotos(downloads, archive);
    expect(item.position).toBe(2);
    // Without stripping it first the id would be ANP12 and nothing would match.
    expect(item.id).toBe("ANP1");
  });

  it("prefers the whole name as an ID over reading its tail as a position", async () => {
    // "ANP-1" is ambiguous: listing ANP-1, or listing ANP position 1? Only the folders on disk
    // can say, and here only ANP-1 exists — so the whole name wins and no position is invented.
    await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "ANP-1.png"), "x");
    const [item] = await scanPhotos(downloads, archive);
    expect(item.id).toBe("ANP1");
    expect(item.position).toBeNull();
  });

  it("falls back to the position reading only when that is the one that exists", async () => {
    // Now ANP-1 is NOT a folder and ANP is, so the same shape of name resolves the other way.
    await listingFolder("ANP");
    await writeFile(path.join(downloads, "ANP-1.png"), "x");
    const [item] = await scanPhotos(downloads, archive);
    expect(item.id).toBe("ANP");
    expect(item.position).toBe(1);
  });

  it("reports no target rather than picking a near miss", async () => {
    await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "GTB-9.png"), "x");
    const [item] = await scanPhotos(downloads, archive);
    expect(item.target).toBeNull();
  });

  it("ignores anything that is not an image", async () => {
    await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "ANP-1.json"), "{}");
    expect(await scanPhotos(downloads, archive)).toEqual([]);
  });
});

describe("importPhoto", () => {
  it("removes the file it replaces — one file per position", async () => {
    const dir = await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "ANP-1-1.png"), "hero");
    const [item] = await scanPhotos(downloads, archive);

    const r = await importPhoto(item, 1);
    expect(r.removed).toEqual(["1.jpg"]);
    const left = (await readdir(dir)).sort();
    expect(left).toEqual(["1.png", "2.jpg"]);
  });

  it("copies by default and moves when asked", async () => {
    await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "ANP-1-1.png"), "hero");

    let [item] = await scanPhotos(downloads, archive);
    await importPhoto(item, 1);
    expect(await readdir(downloads)).toEqual(["ANP-1-1.png"]);

    [item] = await scanPhotos(downloads, archive);
    await importPhoto(item, 1, { move: true });
    expect(await readdir(downloads)).toEqual([]);
  });

  it("refuses when nothing matches", async () => {
    await listingFolder("ANP/ANP 1 - p");
    await writeFile(path.join(downloads, "GTB-9.png"), "x");
    const [item] = await scanPhotos(downloads, archive);
    await expect(importPhoto(item, 1)).rejects.toThrow(/No listing folder matches/);
  });
});

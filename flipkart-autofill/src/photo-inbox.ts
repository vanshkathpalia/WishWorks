/**
 * photo-inbox.ts — file the AI's downloaded pictures into the listing folder they belong to.
 *
 * The JSON half of this is `inbox.ts`. This is the other half, and it is the one that has an
 * extra trap in it: the destination is not a folder this tool owns, it is Vansh's own archive
 * (`Whatsapp DW/ANP/ANP 1 - p`), so the folder has to be *found* rather than constructed.
 *
 * Matching is the same rule as everywhere else, but **the two ends are normalised differently**
 * and getting that backwards silently matches nothing:
 *
 *   download   `ANP1.png` `ANP001.png` `ANP-1.png`  → normalizeId          → `ANP1`
 *   folder     `ANP 1 - p`                          → cleanId → normalizeId → `ANP1`
 *
 * Folders need `cleanId` first because it is what drops the ` - p` pending flag; `normalizeId`
 * alone would keep the P and produce `ANP1P`, so the folder would stop matching the day the flag
 * came off. Files must NOT go through `cleanId` — it is a folder-name rule and it mangles the
 * download prefixes that `normalizeId` already understands (`image-meta-ANP003` → `IMAGE-003`
 * → `IMAGE3`, matching nothing). Verified against both, 2026-07-31.
 *
 * Two rules carried over from THE-FLOW, because forgetting them is what actually costs time:
 *   - the AI's hero replaces position 1 and the infographic replaces position 2;
 *   - **the file being replaced must go.** `1.png` and `1.jpg` both present is position 1 twice,
 *     and `finish` stops the whole listing when it sees that.
 */

import { copyFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { cleanId } from "./finish-core.js";
import { normalizeId } from "./id.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".heic", ".heif"]);

export interface ListingFolder {
  /** Normalised key for matching. Never a filename. */
  id: string;
  /** The display ID the images will be named after — `ANP 1 - p` → `ANP-1`. */
  name: string;
  /** Absolute path of the folder itself. */
  dir: string;
}

/**
 * Every folder under `root` that looks like a listing, found by walking down.
 *
 * A listing folder is one that already holds numbered images — that is what makes
 * `Whatsapp DW/ANP/ANP 1 - p` a listing and `Whatsapp DW/ANP` merely a category. Guessing from
 * the name alone would match every level of the tree.
 */
export async function findListingFolders(root: string, maxDepth = 4): Promise<ListingFolder[]> {
  const out: ListingFolder[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder is the same answer as an empty one
    }

    const hasImages = entries.some(
      (d) => d.isFile() && !d.name.startsWith(".") && IMAGE_EXT.has(path.extname(d.name).toLowerCase()),
    );
    if (hasImages) {
      const name = cleanId(path.basename(dir));
      out.push({ id: normalizeId(name), name, dir });
      // Still walk on: a listing folder holding a sub-folder is unusual but not forbidden.
    }

    for (const d of entries) {
      if (d.isDirectory() && !d.name.startsWith(".")) await walk(path.join(dir, d.name), depth + 1);
    }
  }

  await walk(root, 0);
  return out;
}

export interface PhotoItem {
  file: string;
  /** The listing this download names, normalised. */
  id: string;
  modified: number;
  /** Where it would go, or null when no folder under the root answers to that ID. */
  target: ListingFolder | null;
  /**
   * Which position it should take. Parsed from a trailing number when the name carries one
   * (`ANP-1-2.png` → 2), otherwise null and the UI asks — guessing here would overwrite the
   * wrong picture, and a hero landing in slot 2 is invisible until the listing is live.
   */
  position: number | null;
  /** Files already in the target folder at that position, which filing would replace. */
  replaces: string[];
}

/** Look at a folder of downloads against an archive root. Changes nothing. */
export async function scanPhotos(from: string, root: string): Promise<PhotoItem[]> {
  const folders = await findListingFolders(root);
  const byId = new Map(folders.map((f) => [f.id, f]));

  let names: string[];
  try {
    names = await readdir(from);
  } catch {
    return [];
  }

  const items: PhotoItem[] = [];
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXT.has(ext) || name.startsWith(".")) continue;
    const file = path.join(from, name);
    const modified = await stat(file).then((s) => s.mtimeMs, () => 0);

    const bare = path.basename(name, ext);

    /**
     * Where the ID ends and a position begins, decided by **what exists** rather than by a
     * pattern. `ANP-1-2` could be listing ANP-1 position 2, and `ANP-1` could be listing ANP
     * position 1 — the two readings are indistinguishable from the text alone, and a pattern
     * that picks one is wrong for the other half of the time. So: try the whole name as an ID
     * first, and only fall back to "trailing digit is a position" when that resolves to a real
     * folder and the whole name does not.
     *
     * normalizeId ONLY here — see the header. cleanId is a folder-name rule and would wreck a
     * download-prefixed filename.
     */
    const whole = normalizeId(bare);
    const posMatch = bare.match(/[-_ (]\s*([1-9])\s*\)?$/);
    const trimmed = posMatch ? normalizeId(bare.slice(0, posMatch.index)) : null;

    let id = whole;
    let position: number | null = null;
    if (!byId.has(whole) && trimmed && byId.has(trimmed)) {
      id = trimmed;
      position = Number(posMatch![1]);
    }

    const target = byId.get(id) ?? null;
    const replaces =
      target && position
        ? (await readdir(target.dir).catch(() => []))
            .filter((f) => path.basename(f, path.extname(f)) === String(position) && path.extname(f).toLowerCase() !== ext)
        : [];

    items.push({ file, id, modified, target, position, replaces });
  }

  return items.sort((a, b) => b.modified - a.modified);
}

export interface PhotoImport {
  from: string;
  to: string;
  /** What was deleted to keep one file per position. */
  removed: string[];
}

/**
 * File one picture into its listing folder as `<position><ext>`, removing whatever else held
 * that position.
 *
 * The removal is the point, not a tidy-up: `finish` refuses to run a listing where `1.png` and
 * `1.jpg` both exist, because it cannot know which one you meant. Doing it here means the rule
 * is kept by the tool that creates the situation rather than remembered by a person.
 */
export async function importPhoto(
  item: PhotoItem,
  position: number,
  opts: { move?: boolean } = {},
): Promise<PhotoImport> {
  if (!item.target) throw new Error(`No listing folder matches "${item.id}".`);
  const ext = path.extname(item.file).toLowerCase();
  const to = path.join(item.target.dir, `${position}${ext}`);

  const removed: string[] = [];
  for (const f of await readdir(item.target.dir).catch(() => [])) {
    const full = path.join(item.target.dir, f);
    if (path.basename(f, path.extname(f)) !== String(position) || full === to) continue;
    await rm(full, { force: true });
    removed.push(f);
  }

  if (opts.move) {
    await rename(item.file, to).catch(async () => {
      await copyFile(item.file, to); // rename fails across volumes
      await rm(item.file, { force: true });
    });
  } else {
    await copyFile(item.file, to);
  }

  return { from: item.file, to, removed };
}

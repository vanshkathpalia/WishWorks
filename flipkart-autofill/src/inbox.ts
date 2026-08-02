/**
 * inbox.ts — file the AI's downloaded JSON into `image-meta/` and `products/` automatically.
 *
 * The prompts hand back two downloads named `image-meta-<ID>.json` and `products-<ID>.json`
 * (WW-080), and they land in Downloads. `paste` and `start` read from `image-meta/` and
 * `products/`. Somebody has been closing that gap by hand every single listing, and a hand-copy
 * is exactly where a file gets dropped in the wrong folder — the same class of mistake as
 * WW-077/WW-078, one directory over.
 *
 * Two rules make it safe to run repeatedly:
 *   - **Which folder is decided by the file's CONTENT, not its name.** A products file has a
 *     `values` object; an image-meta file has `meesho`/`images`/`title`. The prefix is only a
 *     hint, and a file renamed by hand ("ANP003.json") has no prefix at all.
 *   - **Nothing already filed is overwritten by something older.** A download is imported when
 *     nothing answers to its ID yet, or when it is newer than what is there. Re-running after
 *     no new downloads does nothing at all.
 */

import { copyFile, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { findById, normalizeId } from "./id.js";
import { META_DIR, PRODUCTS_DIR } from "./paths.js";

export type Half = "image-meta" | "products";

export interface InboxItem {
  /** Full path of the download. */
  file: string;
  /** The listing it belongs to, normalised — `image-meta-ANP003.json` → `ANP3`. */
  id: string;
  /** Which folder it belongs in, or null when the content matches neither shape. */
  half: Half | null;
  /** When the download was written. */
  modified: number;
  /**
   * What importing it would do:
   *   new       nothing answers to this ID yet
   *   update    something does, and this download is newer
   *   older     something does, and it is newer than this — skipped, never overwritten
   *   unknown   the content matches neither shape; skipped
   */
  action: "new" | "update" | "older" | "unknown";
  /** The file it would replace, for "update" and "older". */
  existing: string | null;
}

/**
 * Decide which half a file is by looking inside it. `values` is the Flipkart 66-field map and
 * appears in nothing else; `meesho` / `images` / `keywords` belong to the image-meta half.
 * Returns null rather than guessing — a wrong guess files a listing's copy under the wrong
 * marketplace and is silent until someone reads the output.
 */
export function classify(data: unknown): Half | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o.values && typeof o.values === "object") return "products";
  if (o.meesho || o.images || o.keywords) return "image-meta";
  return null;
}

/** Look at a folder of downloads and say what importing would do. Changes nothing. */
export async function scanInbox(
  from: string,
  dirs: { meta?: string; products?: string } = {},
): Promise<InboxItem[]> {
  const metaDir = dirs.meta ?? META_DIR;
  const productsDir = dirs.products ?? PRODUCTS_DIR;

  let names: string[];
  try {
    names = await readdir(from);
  } catch {
    return []; // no Downloads folder is the same answer as nothing to import
  }

  const items: InboxItem[] = [];
  for (const name of names) {
    if (!/\.json$/i.test(name) || name.startsWith(".")) continue;
    const file = path.join(from, name);

    let data: unknown;
    let modified = 0;
    try {
      const [text, s] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      data = JSON.parse(text);
      modified = s.mtimeMs;
    } catch {
      continue; // unreadable or not JSON — not ours, leave it alone
    }

    const half = classify(data);
    const id = normalizeId(name);
    if (!half) {
      items.push({ file, id, half: null, modified, action: "unknown", existing: null });
      continue;
    }

    const match = await findById(half === "products" ? productsDir : metaDir, id);
    if (!match) {
      items.push({ file, id, half, modified, action: "new", existing: null });
      continue;
    }
    const there = await stat(match.file).then((s) => s.mtimeMs, () => 0);
    items.push({
      file,
      id,
      half,
      modified,
      action: modified > there ? "update" : "older",
      existing: match.file,
    });
  }

  // Newest download first — the one just saved is the one being looked for.
  return items.sort((a, b) => b.modified - a.modified);
}

export interface ImportResult {
  imported: { from: string; to: string; action: "new" | "update" }[];
  skipped: InboxItem[];
}

/**
 * File everything `scanInbox` marked `new` or `update`. `move: true` takes the download out of
 * the source folder so it stops piling up; the default copies, because the source is usually
 * Downloads and leaving the original there costs nothing.
 *
 * The destination name drops the download prefix — `image-meta-ANP003.json` is filed as
 * `ANP003.json` — because that is what the prefixes were for: keeping the two downloads apart in
 * one folder (WW-080). Once they are in separate folders the prefix is noise, and `findById`
 * matches either way.
 */
export async function importInbox(
  from: string,
  opts: { move?: boolean; meta?: string; products?: string; only?: string[] } = {},
): Promise<ImportResult> {
  const metaDir = opts.meta ?? META_DIR;
  const productsDir = opts.products ?? PRODUCTS_DIR;
  const items = await scanInbox(from, { meta: metaDir, products: productsDir });

  // On a fresh install neither of these exists yet — only the image pipeline creates its own
  // folders. Without this the very first import fails with ENOENT on the copy, which is what
  // "the button does nothing" looked like.
  await mkdir(metaDir, { recursive: true });
  await mkdir(productsDir, { recursive: true });

  const imported: ImportResult["imported"] = [];
  const skipped: InboxItem[] = [];

  for (const item of items) {
    const wanted = !opts.only || opts.only.includes(item.file);
    if (!wanted || item.action === "older" || item.action === "unknown" || !item.half) {
      skipped.push(item);
      continue;
    }
    const base = path.basename(item.file).replace(/^(image-?meta|products?)[-_ ]+/i, "");
    const to = path.join(item.half === "products" ? productsDir : metaDir, base);
    if (opts.move) await rename(item.file, to).catch(async () => {
      // rename fails across volumes; copy-then-leave is better than failing the import
      await copyFile(item.file, to);
    });
    else await copyFile(item.file, to);
    imported.push({ from: item.file, to, action: item.action });
  }

  return { imported, skipped };
}

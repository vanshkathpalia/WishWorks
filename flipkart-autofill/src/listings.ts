/**
 * listings.ts — "which listings do I have, and which did I touch last?"
 *
 * Every step after the images asks the operator to name a listing, and typing an ID from memory
 * is how the wrong one gets picked (WW-078). A list — newest first, showing which halves are
 * actually present — turns that into a choice you can see.
 *
 * Newest first because the listing being worked on is always the one most recently written. The
 * ID shown is the normalised one from `id.ts`, so `ANP003.json` and `image-meta-ANP003.json` are
 * one row, not two.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeId } from "./id.js";
import { IMAGES_DIR, META_DIR, PRODUCTS_DIR } from "./paths.js";

export interface Listing {
  /**
   * Normalised ID — a MATCHING key, for `findById` / `runPaste`. **Never a filename.**
   * `GTB-4` normalises to `GTB4`, and writing that to disk produces `GTB4.1.jpg` in a workspace
   * where every other file says `GTB-4`. Use `folder` for paths and `label` for display.
   */
  id: string;
  /** The real `images/2-clean/` folder name, or null when there is no folder. A path, not a key. */
  folder: string | null;
  /** Whatever the newest file for this listing was actually called, for display. */
  label: string;
  meta: boolean;
  product: boolean;
  /** Clean images exist for it (`images/2-clean/<ID>/`). */
  images: boolean;
  /** Finished images exist (`images/3-final/<ID>/`). */
  finished: boolean;
  /** Newest mtime across everything belonging to it. */
  modified: number;
}

async function jsonIds(dir: string): Promise<Map<string, { label: string; modified: number }>> {
  const out = new Map<string, { label: string; modified: number }>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/\.json$/i.test(name) || name.startsWith(".") || name.startsWith("_") || /^EXAMPLE/i.test(name)) continue;
    const id = normalizeId(name);
    const modified = await stat(path.join(dir, name)).then((s) => s.mtimeMs, () => 0);
    const prev = out.get(id);
    if (!prev || modified > prev.modified) out.set(id, { label: path.basename(name, ".json"), modified });
  }
  return out;
}

/** Folders keyed by their normalised ID, keeping the REAL name — that is what paths need. */
async function folderIds(dir: string): Promise<Map<string, { name: string; modified: number }>> {
  const out = new Map<string, { name: string; modified: number }>();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const modified = await stat(path.join(dir, d.name)).then((s) => s.mtimeMs, () => 0);
    out.set(normalizeId(d.name), { name: d.name, modified });
  }
  return out;
}

/** Every listing this machine knows about, newest first. */
export async function listListings(): Promise<Listing[]> {
  const [meta, products, clean, final] = await Promise.all([
    jsonIds(META_DIR),
    jsonIds(PRODUCTS_DIR),
    folderIds(path.join(IMAGES_DIR, "2-clean")),
    folderIds(path.join(IMAGES_DIR, "3-final")),
  ]);

  const ids = new Set([...meta.keys(), ...products.keys(), ...clean.keys(), ...final.keys()]);

  return [...ids]
    .map((id) => ({
      id,
      folder: clean.get(id)?.name ?? null,
      // The name a human would recognise, preferring the folder — that is what the images are
      // actually called on disk. Never the normalised key: "GTB4" is a lookup, "GTB-4" is a file.
      label:
        clean.get(id)?.name ??
        ((meta.get(id)?.modified ?? 0) >= (products.get(id)?.modified ?? 0)
          ? meta.get(id)?.label ?? products.get(id)?.label ?? id
          : products.get(id)?.label ?? id),
      meta: meta.has(id),
      product: products.has(id),
      images: clean.has(id),
      finished: final.has(id),
      modified: Math.max(
        meta.get(id)?.modified ?? 0,
        products.get(id)?.modified ?? 0,
        clean.get(id)?.modified ?? 0,
        final.get(id)?.modified ?? 0,
      ),
    }))
    .sort((a, b) => b.modified - a.modified);
}

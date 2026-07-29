/**
 * id.ts — ONE answer to "which file belongs to this product?".
 *
 * The same listing arrives under four different names, none of them wrong:
 *
 *   image-meta-ANP003.json   what ChatGPT names the download
 *   products-ANP003.json     ditto, for the Flipkart half
 *   ANP003.json              what you get after deleting the prefix
 *   ANP-3.json               what a folder called "ANP 3" resolves to (finish.ts's cleanId)
 *
 * Every lookup used to be exact string equality, so three of those four missed and you got a
 * menu asking you to pick between "image-meta-GTB002" and "a DIFFERENT product" — for the same
 * product. Normalise instead: drop the download prefix, ignore case, punctuation and leading
 * zeros. `ANP 3`, `ANP-3`, `ANP003`, `image-meta-ANP003` are all `ANP3`.
 *
 * Deliberately NOT fuzzy beyond that. No edit distance, no prefix matching — "close enough"
 * picking the wrong product's descriptions is WW-078, and it is worse than not matching at all.
 * Two different files that normalise the same are reported, never silently ranked.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * A filename or ID reduced to its identity. `image-meta-ANP003.json` → `ANP3`.
 *
 * Leading zeros inside the number go because "ANP003" and "ANP-3" are the same listing written
 * two ways — the AI pads, the folder name doesn't. That does mean `ANP-0042` and `ANP-42` are
 * one product; they should be.
 */
export function normalizeId(name: string): string {
  return path
    .basename(name, path.extname(name))
    .replace(/^(image-?meta|products?)[-_ ]+/i, "") // the download's prefix, not the identity
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "") // ANP-3 / ANP 3 / ANP_3 → ANP3
    .replace(/([A-Z])0+(\d)/g, "$1$2"); // ANP003 → ANP3
}

export interface IdMatch {
  /** Full path to the file to use. */
  file: string;
  /** Other files that ALSO answer to this ID — a real duplicate, worth telling the operator. */
  others: string[];
}

/**
 * The `.json` in `dir` belonging to `id`, whatever either is named. An exact filename match
 * wins; otherwise the normalised match, alphabetically, so the answer never depends on
 * readdir order. `null` when nothing matches.
 *
 * `others` is populated when more than one file matches — e.g. both `ANP003.json` and
 * `image-meta-ANP003.json` on disk, one of them a stale copy. Callers show it; nothing here
 * guesses which one you meant.
 */
export async function findById(dir: string, id: string): Promise<IdMatch | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null; // no such folder is the same answer as no such file
  }

  const want = normalizeId(id);
  const matches = entries
    .filter((f) => /\.json$/i.test(f) && !f.startsWith(".") && !f.startsWith("_") && !/^EXAMPLE/i.test(f))
    .filter((f) => normalizeId(f) === want)
    .sort();
  if (matches.length === 0) return null;

  const best = matches.find((f) => f === `${id}.json`) ?? matches[0];
  return {
    file: path.join(dir, best),
    others: matches.filter((f) => f !== best).map((f) => path.join(dir, f)),
  };
}

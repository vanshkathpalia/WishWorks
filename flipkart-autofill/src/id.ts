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

import { readdir, stat } from "node:fs/promises";
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
 * The `.json` in `dir` belonging to `id`, whatever either is named. When several match, the most
 * recently written one — one rule, so `ANP-3`, `ANP003` and `image-meta-ANP003` all reach the
 * same file. `null` when nothing matches.
 *
 * `others` is populated when more than one file matches — e.g. both `ANP003.json` and
 * `image-meta-ANP003.json` on disk, one of them a stale copy. They are the SAME product (they
 * normalise the same), so there is no wrong-product risk in picking; the only question is which
 * copy is current, and the answer is always the one you saved last. Callers list the rest so a
 * stale file is visible, and stop asking.
 */
export async function findById(dir: string, id: string): Promise<IdMatch | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null; // no such folder is the same answer as no such file
  }

  const want = normalizeId(id);
  const named = entries
    .filter((f) => /\.json$/i.test(f) && !f.startsWith(".") && !f.startsWith("_") && !/^EXAMPLE/i.test(f))
    .filter((f) => normalizeId(f) === want)
    .sort();
  if (named.length === 0) return null;

  // Newest first: the file you just downloaded is the one you meant. The alphabetical sort above
  // stays as the tie-break so the answer never depends on readdir order.
  const times = await Promise.all(named.map((f) => stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)));
  const [best, ...others] = named
    .map((f, i) => ({ f, t: times[i] }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.f);

  return {
    file: path.join(dir, best),
    others: others.map((f) => path.join(dir, f)),
  };
}

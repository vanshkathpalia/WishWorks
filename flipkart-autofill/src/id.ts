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
    // The browser's duplicate-download suffix. `products-ANP003 (1).json` is the SAME listing
    // downloaded twice — without this it normalised to ANP31 and showed up as a phantom second
    // product in the picker, one that no folder and no other half would ever match.
    .replace(/\s*\(\d+\)$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "") // ANP-3 / ANP 3 / ANP_3 → ANP3
    .replace(/([A-Z])0+(\d)/g, "$1$2"); // ANP003 → ANP3
}

/**
 * Why `findById` came back null, in words, naming the folder it actually looked in.
 *
 * A missing folder, an empty folder and a folder full of OTHER listings are three different
 * problems with three different fixes, and every caller used to report all three as the same
 * sentence — one that never said where it looked. So creating the folder by hand changed nothing
 * visible and read as "the button cannot see my folder", when the file was simply never imported.
 */
export async function whyNoMatch(dir: string, id: string): Promise<string> {
  const names = await readdir(dir).catch(() => null);
  const jsons = names?.filter((f) => /\.json$/i.test(f) && !f.startsWith(".") && !f.startsWith("_"));
  const state =
    jsons === undefined
      ? "that folder does not exist yet"
      : jsons.length === 0
        ? "that folder is empty"
        : `it holds ${jsons.slice(0, 8).join(", ")}`;
  return `No file in ${dir} matches "${normalizeId(id)}" — ${state}.`;
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

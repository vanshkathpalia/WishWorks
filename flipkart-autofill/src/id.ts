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
 * The `<letters><number>` a name STARTS with, zero-insensitive. `""` when it starts with neither.
 *
 * `ANP-1-annaprasan-decoration-kit-red-gold-2.jpg` → `ANP1`, and so does `ANP001`. **That pair is
 * the whole reason this exists**: a SKU is written `ANP001` and the file it belongs to is written
 * `ANP-1-<the whole title>`, because a filename has to stay readable to a person browsing the
 * shared drive. Vansh, 2026-08-19: *"our SKU is named like this and the file can't, for
 * readability — through coding, checking that is easy, so do that."*
 *
 * Sibling of `normalizeId` above, and NOT the same job: that one reduces a whole name to an
 * identity, which is right when both sides are identities. Here one side is an identity and the
 * other is a title with the identity on the front, so the comparison has to stop at the number.
 * Reducing both to strings and asking whether one contains the other is what it replaced, and it
 * is wrong in a way that never announces itself — `ANP001` is inside `ANP-10-…` too.
 */
export function leadCode(name: string): string {
  const base = path.basename(name);
  const themed = THEMED.exec(base);
  if (themed !== null) return `${themed[1]}${themed[2]}${themed[3]}`.toUpperCase();
  const m = /^([A-Za-z]+)[\s_-]*0*(\d+)/.exec(base);
  return m === null ? "" : `${m[1].toUpperCase()}${m[2]}`;
}

/**
 * A tag with a THEME under it: `HBD-peppa01`, `HBD-Kitty01`, `HBD-space02`, `HBD-dore01`.
 *
 * **`HBD` is not one product and the code has been pretending it is.** Peppa, Kitty, space and
 * doremon are four different listings that buyers search for with four different sets of words,
 * and the old grammar — letters, then a number — could not see the theme at all: `leadCode` gave
 * `""` for every one of them, and `cleanId` collapsed all four onto `HBD-01`, `HBD-02`… so two
 * themes sharing a number were **one ID, overwriting each other's files**. Vansh, 2026-08-21:
 * *"every peppa or theme image showing 1.1 thing not the full name."* That `1.1` is `HBD-01` with
 * a slot on the end, which is the theme having been thrown away three steps earlier.
 *
 * **Three deliberate tightenings, each of which keeps an existing name working:**
 *
 * - The tag is **at most four letters**. Real tags are `ANP`, `WB`, `GTB`, `HBD`, `HAL`, `SVP`,
 *   `WKU`. Without a bound, a descriptive folder like `annaprashan kit 2` would read `annaprashan`
 *   as a tag and `kit` as a theme.
 * - A **separator is required** between tag and theme. `photo booth 16` cannot match, because
 *   `phot` is not followed by one.
 * - **Anchored.** It describes how a name STARTS, like `leadCode` itself; an unanchored version
 *   would find a code in the middle of a title.
 *
 * Both spellings normalise the same, which is what lets `cleanId` write the readable one:
 * `HBD-peppa01` and `HBD-peppa-01` are both `HBDPEPPA1`.
 */
const THEMED = /^([A-Za-z]{1,4})[\s_-]+([A-Za-z]+)[\s_-]*0*(\d+)/;

/**
 * The theme in a name, lower case — `HBD-peppa01` → `peppa`. `""` when there is none.
 *
 * What the ready folder files a listing under, one level below its tag: `ready/HBD/peppa/`. The
 * tag is `skuGroup`'s job and stays exactly as it was, because peppa IS a Happy Birthday kit.
 *
 * **`HBD-01` gives `""`, and that is the honest answer, not a bug.** A file finished before this
 * existed has already had its theme thrown away (C-070), so nothing can say which of peppa, kitty,
 * space or doremon it was. It stays in `HBD/` rather than being guessed into a theme folder.
 */
export function themeIn(name: string): string {
  const m = THEMED.exec(path.basename(name));
  return m === null ? "" : m[2].toLowerCase();
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

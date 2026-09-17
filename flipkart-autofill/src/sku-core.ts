/**
 * sku-core.ts — which of OUR products a catalog listing is, and what to call the next one.
 *
 * The latch form has one field this tool used to refuse to fill: `Seller SKU ID`. It refused
 * because the SKU on the other seller's label is theirs, and only Vansh knew which of ours it
 * should be. This file is the part that can now answer — by reading the listing's own title the
 * same way `weSell` already does, and by counting what we have already named.
 *
 * **It still refuses when it does not know.** A wrong SKU is a listing filed under another
 * product's costing, its photos and its price, and nothing downstream would ever question it. No
 * theme matched, or two matched equally → the field stays empty and a human fills it, exactly as
 * before. Being right nine times out of ten is not good enough when the tenth is silent.
 */

/**
 * Words that name one of our product lines, most specific first.
 *
 * **Order is the whole design.** `Peppa Pig Happy Birthday Decoration Kit` contains "birthday", so
 * a generic HBD rule placed first would swallow every themed kit we sell. The character themes are
 * therefore tested before the plain birthday one, and the occasions — which are never ambiguous —
 * before either.
 */
const THEMES: { prefix: string; words: string[] }[] = [
  // Occasions. Distinctive words, no overlap with anything else we sell.
  { prefix: "ANP", words: ["annaprashan", "annaprasan", "annaprashanam", "annaprasanam", "rice ceremony"] },
  { prefix: "HAL", words: ["haldi"] },
  { prefix: "GTB", words: ["groom to be", "groom-to-be", "bachelor"] },
  { prefix: "WB", words: ["welcome baby", "baby shower", "babyshower"] },
  { prefix: "WH", words: ["welcome home"] },
  // Birthday, by character. Before the plain birthday rule, or it never gets a look in.
  { prefix: "HBD-peppa", words: ["peppa"] },
  { prefix: "HBD-jungle", words: ["jungle", "safari"] },
  { prefix: "HBD-space", words: ["space", "astronaut", "rocket"] },
  { prefix: "HBD-sonic", words: ["sonic"] },
  { prefix: "HBD-spider", words: ["spiderman", "spider man", "spider-man"] },
  { prefix: "HBD-ironman", words: ["ironman", "iron man"] },
  { prefix: "HBD-dore", words: ["doraemon", "doremon", "dore"] },
  { prefix: "HBD-masha", words: ["masha"] },
  { prefix: "HBD-Kitty", words: ["kitty"] },
  { prefix: "HBD-bb", words: ["baby boss", "boss baby", "babyboss"] },
  // Plain birthday, last, so it only catches what no theme claimed.
  { prefix: "HBD", words: ["birthday", "bday", "b'day"] },
];

/** Lowercase, letters and digits only — the same flattening the rest of the tool matches on. */
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which of our lines this listing belongs to, or null.
 *
 * Null is a real answer and the safe one: it leaves the SKU for a human rather than filing the
 * product under a line it may not belong to.
 */
export function themeFor(title: string): string | null {
  const t = ` ${flat(title)} `;
  for (const { prefix, words } of THEMES) {
    if (words.some((w) => t.includes(` ${flat(w)} `) || t.includes(`${flat(w)} `))) return prefix;
  }
  return null;
}

/**
 * How many digits a SKU number carries. **One rule, everywhere.**
 *
 * What is on disk today is four habits at once — `ANP001` pads to three, `GTB-1` does not pad and
 * takes a dash, `HAL03` pads to two, `HBD-dore01` pads to two after a word. An earlier version of
 * this file learnt each prefix's habit and copied it, so a new SKU would sort beside its siblings.
 * Vansh, 2026-09-13: *"make it like same format all over."* He is right, and the reason is stronger
 * than tidiness: four formats means four ways to write the same SKU, and `GTB-1` / `GTB01` /
 * `GTB001` are three different folders, three different filenames and three different rows to a
 * tool matching on text.
 *
 * **Nothing already on disk is renamed.** `normalizeId` in `id.ts` is what makes the old spellings
 * still match; this only decides what NEW ones are called.
 *
 * **One exception, and it is the live listings that set it.** Vansh, 2026-09-17: the character
 * birthday kits were always `HBD-dore01`, `HBD-spider01`, `HBD-masha02` — two digits after the word —
 * and Flipkart and Meesho do not allow a SKU to be renamed. The app handed out `HBD-dore003`, he
 * saved the listing as `HBD-dore03` to match its siblings, and the two records no longer agreed.
 * *"lets just follow this convention."* So a themed `HBD-<word>` prefix pads to two; everything
 * else, including plain `HBD001`, pads to three.
 */
export const SKU_DIGITS = 3;
export const THEMED_SKU_DIGITS = 2;
const digitsFor = (prefix: string) => (/^HBD-/i.test(prefix) ? THEMED_SKU_DIGITS : SKU_DIGITS);

/**
 * The next unused SKU for a listing, or null when we cannot say which line it is.
 *
 * `taken` is every SKU already in use **including the ones handed out earlier in this same run** —
 * latching ten annaprashan kits in one batch must produce ten different SKUs, and a function that
 * only read the disk would hand out `ANP016` ten times.
 *
 * Old spellings still count as taken: `GTB-1`, `GTB01` and `GTB001` are one product, so the next
 * GTB is numbered past all of them rather than colliding with a differently-spelt sibling.
 */
export function nextSku(title: string, taken: string[]): string | null {
  const prefix = themeFor(title);
  if (!prefix) return null;

  const owned = new RegExp(`^${prefix.replace(/-/g, "\\-")}-?0*(\\d+)$`, "i");
  let highest = 0;
  const used = new Set<string>();
  for (const raw of taken) {
    const t = raw.trim();
    used.add(t.toUpperCase().replace(/-/g, "").replace(/(\d+)$/, (d) => String(Number(d))));
    const m = owned.exec(t);
    if (m) highest = Math.max(highest, Number(m[1]));
  }

  for (let n = highest + 1; n < highest + 1000; n++) {
    const sku = `${prefix}${String(n).padStart(digitsFor(prefix), "0")}`;
    const key = sku.toUpperCase().replace(/-/g, "").replace(/(\d+)$/, (d) => String(Number(d)));
    if (!used.has(key)) return sku;
  }
  return null;
}

/**
 * Where a product's generated images go: `images/1-raw/<SKU>/`.
 *
 * **Not a new folder of its own.** The pipeline that already exists is `1-raw` -> `2-clean` ->
 * `3-final`, driven by `runImages` and `runFinish`, and it is already keyed by the product id with
 * numbered files inside (`images/1-raw/GTB-4/1.avif`). Generated images drop straight into the
 * front of it and every step downstream — squaring, naming, the Meesho and Flipkart halves — works
 * unchanged. Inventing `wishworks-ready/<THEME>/<SKU>/` would have been a second pipeline that
 * agrees with the first only until one of them changes.
 */
export const rawDirFor = (imagesDir: string, sku: string): string => `${imagesDir}/1-raw/${sku}`;

/** `1.png`, `2.png`, `3.png` — the order the prompts produce them in, which is the order they list. */
export const rawFileFor = (imagesDir: string, sku: string, n: number): string =>
  `${rawDirFor(imagesDir, sku)}/${n}.png`;

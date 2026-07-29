/**
 * paste.ts — print the four marketplace values with REAL line breaks, ready to copy.
 *
 * JSON stores line breaks as \n, which no marketplace form accepts. The prompt used to work
 * around that by printing every value a second time as plain text ("section 3"), which doubled
 * the AI's output for no new information. JSON.parse already unescapes, so this does it here.
 *
 *   npm run paste -- ANP-1
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { findById } from "./id.js";
import { META_DIR, PRODUCTS_DIR, ROOT } from "./paths.js";

const id = process.argv[2];
if (!id) {
  console.error("usage: npm run paste -- <ID>");
  process.exit(1);
}

/** The download arrives named `image-meta-<ID>.json` / `products-ANP003.json`; you may have
 *  filed it as `ANP003.json` or `ANP-3.json`. findById treats all four as the same product, so
 *  any of them can be typed here — see id.ts. */
const read = async (dir: string) => {
  const match = await findById(dir, id);
  if (!match) {
    console.error(`\nNothing in ${path.basename(dir)}/ matches "${id}".`);
    console.error(`  Save the download there under any of: ${id}.json, image-meta-${id}.json, products-${id}.json`);
    process.exit(1);
  }
  if (match.others.length) {
    console.error(`⚠️  ${match.others.length + 1} files answer to "${id}" — reading ${path.relative(ROOT, match.file)}, ignoring ${match.others.map((f) => path.basename(f)).join(", ")}`);
  }
  return JSON.parse(await readFile(match.file, "utf8"));
};

const [meta, product] = await Promise.all([read(META_DIR), read(PRODUCTS_DIR)]);

/**
 * The two files must agree on two values. `PROMPT-product.md` says so in capitals — *"REUSE, DO
 * NOT REWRITE… character for character. Two different versions of either one is a bug, not a
 * variation"* — because the meta file's `title`/`keywords` ARE the Flipkart `Model Name`/`Search
 * Keywords`, and Flipkart builds the listing title out of Model Name.
 *
 * Nothing enforced it. Send the two prompts twice, or edit one file and not the other, and you
 * get a listing whose title, image descriptions and Meesho copy describe the same kit in three
 * different phrasings — with the keyword work split across them. Invisible until it is live.
 * This is the one place both files are open at once, and it runs before every paste.
 */
const drift = ([
  ["Model Name", meta.title, product.values?.["Model Name"]],
  ["Search Keywords", meta.keywords, product.values?.["Search Keywords"]],
] as const).filter(([, a, b]) => a != null && b != null && JSON.stringify(a) !== JSON.stringify(b));

if (drift.length) {
  console.error(`\n⚠️  image-meta and products disagree — these must be character-for-character identical:`);
  for (const [field, a, b] of drift) {
    console.error(`\n   ${field}`);
    console.error(`     image-meta : ${JSON.stringify(a)}`);
    console.error(`     products   : ${JSON.stringify(b)}`);
  }
  console.error(`\n   Pick one and copy it into the other file. Flipkart builds the listing title from`);
  console.error(`   Model Name, so the version you keep is the one buyers search.\n`);
}

/** Field, value, and the ceiling the panel enforces. Both 1400s were read off the live form by
 *  the seller; the 120 is blog-sourced and unconfirmed (see START-HERE). The AI is told a target
 *  but routinely comes in far under it, and nothing used to show that — a description at a third
 *  of its allowance is search surface thrown away, which is the whole point of the field. */
/** `fill` marks the fields where unused characters are lost search reach, so coming in short is
 *  worth flagging. Pack contents is not one of them: its length is decided by the inventory, and
 *  a short one is correct. Its 255 still matters as a CAP — the panel truncates past it. */
const FIELDS = [
  ["FLIPKART DESCRIPTION", product.values?.Description, 1400, true],
  ["MEESHO TITLE", meta.meesho?.title, 120, true],
  ["MEESHO DESCRIPTION", meta.meesho?.description, 1400, true],
  ["MEESHO PACK CONTENTS", meta.meesho?.pack_contents, 255, false],
] as const;

for (const [label, value, limit, fill] of FIELDS) {
  if (value == null) {
    console.log(`\n[${label}]  (missing)`);
    continue;
  }
  const n = value.length;
  const note =
    n > limit ? "  ⚠️ OVER — the form will cut it off"
    : fill && n < limit * 0.7 ? "  ⚠️ short — room for more"
    : "";
  console.log(`\n[${label}]  ${n}/${limit}${note}\n${value}`);
}

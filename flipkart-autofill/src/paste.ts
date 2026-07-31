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
import { META_DIR, PRODUCTS_DIR, showPath } from "./paths.js";

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
    console.error(`⚠️  ${match.others.length + 1} files answer to "${id}" — reading ${showPath(match.file)}, ignoring ${match.others.map((f) => path.basename(f)).join(", ")}`);
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
/** Everything wrong, collected as we go and printed together at the end. Nothing here ever stops
 *  the run: the values are still correct to paste, and a problem you have to scroll back up for
 *  is a problem you ship. */
const problems: string[] = [];

for (const [field, a, b] of ([
  ["Model Name", meta.title, product.values?.["Model Name"]],
  ["Search Keywords", meta.keywords, product.values?.["Search Keywords"]],
] as const)) {
  if (a == null || b == null || JSON.stringify(a) === JSON.stringify(b)) continue;
  problems.push(
    `${field} differs between the two files — they must be character-for-character identical\n` +
      `      image-meta : ${JSON.stringify(a)}\n` +
      `      products   : ${JSON.stringify(b)}\n` +
      `      Pick one and copy it into the other. Flipkart builds the listing title from Model\n` +
      `      Name, so the version you keep is the one buyers search.`,
  );
}

/**
 * The rules the prompts state that a machine can actually verify. Each one below is a
 * documented rejection or a measured limit, not a style preference — everything subjective
 * stays in the prompt where a human can argue with it.
 *
 * Every value in BOTH files is swept. `commas: false` marks the fields where a comma is a
 * defect rather than punctuation — and that is decided by ONE thing: does the value end up in
 * a Flipkart field? Flipkart splits list values on commas, so a comma inside an entry silently
 * becomes two entries.
 *
 * It does NOT apply to anything under `meesho`. Those four values are pasted by hand into the
 * Supplier Panel and never reach Flipkart, so a comma there is ordinary punctuation and reads
 * better than " - " in a long pack list. Treating one file's rule as the whole file's rule is
 * how a Flipkart constraint ends up degrading the Meesho copy for no reason — the two
 * marketplaces share this JSON, not their rules.
 */
const BANNED = [
  "premium", "elegant", "luxury", "royal", "exclusive", "cheapest", "finest",
  "100% original", "guaranteed", "high quality", "superior",
];
const URGENCY = [
  "limited stock", "selling fast", "hurry", "trending", "best seller", "bestseller", "no. 1",
];

const scanned: Array<{ where: string; text: string; commas: boolean }> = [];
const sweep = (where: string, v: unknown, commas: boolean) => {
  if (typeof v === "string") scanned.push({ where, text: v, commas });
  else if (Array.isArray(v)) {
    v.forEach((s, i) => typeof s === "string" && scanned.push({ where: `${where}[${i + 1}]`, text: s, commas }));
  }
};

// Flipkart-bound: title becomes Model Name, keywords become Search Keywords (a split list).
sweep("image-meta title", meta.title, false);
sweep("image-meta keywords", meta.keywords, false);
// Meesho-bound: hand-pasted, never split, commas welcome.
sweep("meesho.title", meta.meesho?.title, true);
sweep("meesho.pack_contents", meta.meesho?.pack_contents, true);
sweep("meesho.description", meta.meesho?.description, true);
for (const [k, v] of Object.entries(meta.images ?? {})) sweep(`image ${k} description`, v, true);
for (const [k, v] of Object.entries(product.values ?? {})) {
  // Description is the one Flipkart field that is prose, so commas are punctuation there.
  sweep(`products ${k}`, v, k === "Description");
}

for (const { where, text, commas } of scanned) {
  const low = text.toLowerCase();
  for (const w of BANNED) {
    if (low.includes(w)) problems.push(`${where} contains the banned quality word "${w}" — it is an unverifiable claim and "elegant" was flagged on a real listing.`);
  }
  for (const w of URGENCY) {
    if (low.includes(w)) problems.push(`${where} contains "${w}" — urgency wording is a marketplace policy risk. Badges make that claim, sellers do not.`);
  }
  if (!commas && text.includes(",")) {
    problems.push(`${where} contains a comma — Flipkart splits list values on commas, so "${text.slice(0, 60)}…" becomes two entries. Use " - " or "and".`);
  }
  if (text.startsWith("TODO_")) problems.push(`${where} is still a placeholder (${text}).`);
}

// Model Name is the ONLY part of the Flipkart title a seller controls — Flipkart composes the
// rest — so its length is the single highest-leverage number in the file, and until now nothing
// counted it. 80-120 target, 128 ceiling (WW-070).
const modelName: unknown = product.values?.["Model Name"] ?? meta.title;
if (typeof modelName === "string") {
  const n = modelName.length;
  if (n > 128) problems.push(`Model Name is ${n}/128 — over Flipkart's ceiling, the tail will be cut.`);
  else if (n < 80) problems.push(`Model Name is only ${n} characters (target 80-120). Flipkart builds the listing title out of this field and nothing else — short here is search reach you cannot get back anywhere else.`);
}

// A keyword that appears in neither description sits in one capped field (WW-071) on one
// marketplace; the same phrase inside a sentence works on both. The prompt asks for at least
// half of them to be worked in, so that is the threshold — a warning that fires on every
// listing is a warning people learn to skim past (learning note 7).
const kwText = [product.values?.Description, meta.meesho?.description].filter((s) => typeof s === "string").join(" ").toLowerCase();
const keywords: string[] = Array.isArray(meta.keywords) ? meta.keywords.filter((k: unknown) => typeof k === "string") : [];
const orphans = kwText ? keywords.filter((k) => !kwText.includes(k.toLowerCase())) : [];
if (orphans.length > keywords.length / 2) {
  problems.push(`${orphans.length} of ${keywords.length} keywords appear in neither description — ${orphans.map((k) => `"${k}"`).join(", ")}.\n      Work the ones that can be said naturally into the description text. Never as a list.`);
}

/** Field, value, and the ceiling the panel enforces. Both 1400s were read off the live form by
 *  the seller; the 120 is blog-sourced and unconfirmed (see START-HERE). The AI is told a target
 *  but routinely comes in far under it, and nothing used to show that — a description at a third
 *  of its allowance is search surface thrown away, which is the whole point of the field. */
/** `fill` marks the fields where unused characters are lost search reach, so coming in short is
 *  worth flagging. Pack contents is not one of them: its length is decided by the inventory, and
 *  a short one is correct. Its 255 still matters as a CAP — the panel truncates past it. */
/**
 * `min` is the prompt's own stated target, not a percentage — a blanket 70% was looser than
 * what the prompts actually ask for, so a reply could miss its target and still pass. Both
 * ends matter and for different reasons: over the max, the panel silently truncates and the
 * tail of your text simply vanishes; under the min, nothing breaks but every unwritten
 * sentence is a query you cannot be found for.
 *
 * `min: 0` = there is no such thing as too short. Pack contents is as long as the pack is;
 * warning that a small kit has a short list would be noise, not signal (learning note 7).
 */
const FIELDS = [
  ["FLIPKART DESCRIPTION", product.values?.Description, 2500, 5000, "products"],
  ["MEESHO TITLE", meta.meesho?.title, 90, 120, "image-meta"],
  ["MEESHO DESCRIPTION", meta.meesho?.description, 1100, 1400, "image-meta"],
  ["MEESHO PACK CONTENTS", meta.meesho?.pack_contents, 0, 255, "image-meta"],
] as const;

for (const [label, value, min, max, file] of FIELDS) {
  if (value == null) {
    console.log(`\n[${label}]  (missing)`);
    problems.push(`${label} is missing — the AI's reply was cut short. Re-run that prompt (WW-081).`);
    continue;
  }
  const n = value.length;
  const note =
    n > max ? "  ⚠️ OVER — the form will cut it off"
    : n < min ? `  ⚠️ under the ${min} target`
    : "";
  console.log(`\n[${label}]  ${n}/${max}${note}\n${value}`);

  if (n > max) {
    problems.push(
      `${label} is ${n}/${max} — the panel will silently cut the last ${n - max} character(s).\n` +
        `      Trim it in ${file}/ before you list.`,
    );
  } else if (n < min) {
    problems.push(
      `${label} is ${n}/${max}, under the ${min} the prompt asks for — ${min - n} more character(s) to reach it,\n` +
        `      ${max - n} available in total. Nothing breaks, but every sentence you do not write is a\n` +
        `      query you cannot be found for. Ask the AI to extend it in ${file}/.`,
    );
  }
}

// The whole point of this block: the four values above run to hundreds of lines in a terminal,
// so an inline ⚠️ on line 3 is gone by the time you have scrolled to the bottom to copy. Repeat
// everything that matters here, after the values, where the eye already is.
if (problems.length) {
  console.log(`\n──────── ⚠️  ${problems.length} THING${problems.length === 1 ? "" : "S"} TO FIX ────────\n`);
  for (const p of problems) console.log(`  • ${p}\n`);
  console.log(`  Nothing is blocked — the values above are still correct to paste.\n`);
} else {
  console.log(`\n──────── ✅ nothing to fix — every value is present and within its limit ────────\n`);
}

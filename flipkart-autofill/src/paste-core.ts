/**
 * paste-core.ts — every check `npm run paste` performs, as a plain function.
 *
 * Options in, structured result out, nothing printed and nothing exited. `paste.ts` is the CLI
 * that prints this; the app renders the same fields and problems as a panel, which is the whole
 * point — today a limit breach is only caught if someone remembers to run the command.
 *
 * The rules below are each a documented rejection or a measured limit, not a style preference.
 * Everything subjective stays in the prompt files where a human can argue with it.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findById } from "./id.js";
import { META_DIR, PRODUCTS_DIR } from "./paths.js";

/** One of the four values that gets pasted into a marketplace form. */
export interface PasteField {
  label: string;
  /** null when the AI's reply was cut short and the key never arrived (WW-081). */
  value: string | null;
  length: number;
  /** The prompt's own stated target. 0 = there is no such thing as too short. */
  min: number;
  /** The panel's ceiling. Past this the form silently truncates. */
  max: number;
  status: "ok" | "over" | "under" | "missing";
}

export interface PasteResult {
  /**
   * Which file each half came from, and any others answering to the same ID — one of those is
   * probably stale, and the operator is the only one who can say which.
   */
  halves: { dir: string; file: string; others: string[] }[];
  fields: PasteField[];
  /** Everything wrong, in the order it was found. Never blocks: the values are still correct. */
  problems: string[];
}

/** Thrown when a half is missing entirely — the only condition that makes the run meaningless. */
export class PasteNotFound extends Error {
  constructor(readonly dir: string, readonly id: string) {
    super(`Nothing in ${path.basename(dir)}/ matches "${id}".`);
  }
}

const BANNED = [
  "premium", "elegant", "luxury", "royal", "exclusive", "cheapest", "finest",
  "100% original", "guaranteed", "high quality", "superior",
];
const URGENCY = [
  "limited stock", "selling fast", "hurry", "trending", "best seller", "bestseller", "no. 1",
];

/**
 * `min` is the prompt's own target, not a percentage. Both ends matter and for different
 * reasons: over the max the panel silently truncates and the tail vanishes; under the min
 * nothing breaks, but every unwritten sentence is a query you cannot be found for.
 *
 * Flipkart's Description is 5000 and Meesho's is 1400 — different fields on different
 * platforms, and one number cannot serve both (WW-095).
 */
const LIMITS = [
  { label: "FLIPKART DESCRIPTION", min: 2500, max: 5000, file: "products" },
  { label: "MEESHO TITLE", min: 90, max: 120, file: "image-meta" },
  { label: "MEESHO DESCRIPTION", min: 1100, max: 1400, file: "image-meta" },
  { label: "MEESHO PACK CONTENTS", min: 0, max: 255, file: "image-meta" },
] as const;

/**
 * Emoji in a Flipkart field are not a style problem — they are an HTTP 500. Proven on a live
 * listing 2026-07-31: with emoji in the Description every save returned "Internal Server Error".
 * >0xFFFF is the proven breaker (4 bytes in UTF-8); the dingbat/misc-symbol ranges are included
 * because the seller's instruction is "no emoji at all". Deliberately NOT matched: – — ₹ and
 * smart quotes, which are ordinary punctuation.
 */
export function isEmoji(c: string): boolean {
  const n = c.codePointAt(0) ?? 0;
  return n > 0xffff || (n >= 0x2600 && n <= 0x27bf) || (n >= 0x2b00 && n <= 0x2bff) || n === 0xfe0f;
}

/**
 * Take the emoji out of every Flipkart-bound value in `products/<id>.json`.
 *
 * **Why this exists as a repair and not just a prompt rule.** WW-096 fixed the *prompt* on
 * 2026-07-31 so new replies come back plain — but every file written before that still carries
 * 🎁 ✨ 🎈 💡 👉 as section headings, and those files are what get filled. The fix changed what
 * the AI writes next time; it could not change what was already on disk, so the same HTTP 500
 * came back on the next listing and looked like a regression.
 *
 * Safe because of what the emoji were doing: headings. `🎁 What You Get` becomes `What You Get`,
 * which is what the corrected prompt produces anyway. Nothing but the emoji and the space they
 * leave behind is touched, and `products/` is regenerable from the prompt if this is ever wrong.
 *
 * **Meesho values are deliberately left alone** — they are pasted by hand into a different panel
 * and have never shown the problem. One platform's constraint must not degrade the other's copy.
 */
export async function stripFlipkartEmoji(
  id: string,
  dirs: { products?: string } = {},
): Promise<{ file: string; changed: string[] }> {
  const dir = dirs.products ?? PRODUCTS_DIR;
  const match = await findById(dir, id);
  if (!match) throw new PasteNotFound(dir, id);

  const data = JSON.parse(await readFile(match.file, "utf8"));
  const changed: string[] = [];

  const clean = (s: string) =>
    [...s]
      .filter((c) => !isEmoji(c))
      .join("")
      // An emoji heading leaves "  What You Get"; collapse the gap it held open without
      // touching indentation that was never emoji-related.
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^[ \t]+/gm, "")
      .trim();

  for (const [k, v] of Object.entries(data.values ?? {})) {
    if (typeof v === "string" && [...v].some(isEmoji)) {
      data.values[k] = clean(v);
      changed.push(k);
    } else if (Array.isArray(v) && v.some((x) => typeof x === "string" && [...x].some(isEmoji))) {
      data.values[k] = v.map((x: unknown) => (typeof x === "string" ? clean(x) : x));
      changed.push(k);
    }
  }

  if (changed.length) await writeFile(match.file, JSON.stringify(data, null, 2) + "\n");
  return { file: match.file, changed };
}

async function readHalf(dir: string, id: string): Promise<{ data: any; file: string; others: string[] }> {
  const match = await findById(dir, id);
  if (!match) throw new PasteNotFound(dir, id);
  return { data: JSON.parse(await readFile(match.file, "utf8")), file: match.file, others: match.others };
}

/** Run every check for one listing. Throws `PasteNotFound` if either half is missing. */
export async function runPaste(
  id: string,
  dirs: { meta?: string; products?: string } = {},
): Promise<PasteResult> {
  const [meta, product] = await Promise.all([
    readHalf(dirs.meta ?? META_DIR, id),
    readHalf(dirs.products ?? PRODUCTS_DIR, id),
  ]);

  const problems: string[] = [];

  // The two files must agree on two values, because the meta file's title/keywords ARE the
  // Flipkart Model Name / Search Keywords. Nothing used to enforce it, so sending the prompts
  // twice produced a listing describing one kit in three different phrasings.
  for (const [field, a, b] of [
    ["Model Name", meta.data.title, product.data.values?.["Model Name"]],
    ["Search Keywords", meta.data.keywords, product.data.values?.["Search Keywords"]],
  ] as const) {
    if (a == null || b == null || JSON.stringify(a) === JSON.stringify(b)) continue;
    problems.push(
      `${field} differs between the two files — they must be character-for-character identical\n` +
        `      image-meta : ${JSON.stringify(a)}\n` +
        `      products   : ${JSON.stringify(b)}\n` +
        `      Pick one and copy it into the other. Flipkart builds the listing title from Model\n` +
        `      Name, so the version you keep is the one buyers search.`,
    );
  }

  // Every string in BOTH files is swept. `commas: false` marks the fields where a comma is a
  // defect rather than punctuation, decided by one thing: does the value reach a Flipkart field?
  // Flipkart splits list values on commas. Nothing under `meesho` is affected — those are pasted
  // by hand and a comma there reads better than " - " in a long pack list.
  const scanned: Array<{ where: string; text: string; commas: boolean }> = [];
  const sweep = (where: string, v: unknown, commas: boolean) => {
    if (typeof v === "string") scanned.push({ where, text: v, commas });
    else if (Array.isArray(v)) {
      v.forEach((s, i) => typeof s === "string" && scanned.push({ where: `${where}[${i + 1}]`, text: s, commas }));
    }
  };

  sweep("image-meta title", meta.data.title, false);
  sweep("image-meta keywords", meta.data.keywords, false);
  sweep("meesho.title", meta.data.meesho?.title, true);
  sweep("meesho.pack_contents", meta.data.meesho?.pack_contents, true);
  sweep("meesho.description", meta.data.meesho?.description, true);
  for (const [k, v] of Object.entries(meta.data.images ?? {})) sweep(`image ${k} description`, v, true);
  for (const [k, v] of Object.entries(product.data.values ?? {})) {
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

    if (!where.startsWith("meesho")) {
      const nonBmp = [...text].filter(isEmoji);
      if (nonBmp.length) {
        problems.push(
          `${where} contains ${nonBmp.length} emoji / 4-byte character(s) — ${[...new Set(nonBmp)].slice(0, 8).join(" ")}\n` +
            `      Flipkart's server returns HTTP 500 on save when this field carries them: the listing\n` +
            `      cannot be saved at all. Remove every one before you fill.`,
        );
      }
    }
  }

  // Model Name is the ONLY part of the Flipkart title a seller controls — Flipkart composes the
  // rest — so its length is the highest-leverage number in the file (WW-070).
  const modelName: unknown = product.data.values?.["Model Name"] ?? meta.data.title;
  if (typeof modelName === "string") {
    const n = modelName.length;
    if (n > 128) problems.push(`Model Name is ${n}/128 — over Flipkart's ceiling, the tail will be cut.`);
    else if (n < 80) problems.push(`Model Name is only ${n} characters (target 80-120). Flipkart builds the listing title out of this field and nothing else — short here is search reach you cannot get back anywhere else.`);
  }

  // A keyword in neither description sits in one capped field on one marketplace; the same
  // phrase inside a sentence works on both. Half is the threshold because a warning that fires
  // on every listing is one people learn to skim past (learning note 7).
  const kwText = [product.data.values?.Description, meta.data.meesho?.description]
    .filter((s) => typeof s === "string")
    .join(" ")
    .toLowerCase();
  const keywords: string[] = Array.isArray(meta.data.keywords)
    ? meta.data.keywords.filter((k: unknown) => typeof k === "string")
    : [];
  const orphans = kwText ? keywords.filter((k) => !kwText.includes(k.toLowerCase())) : [];
  if (orphans.length > keywords.length / 2) {
    problems.push(`${orphans.length} of ${keywords.length} keywords appear in neither description — ${orphans.map((k) => `"${k}"`).join(", ")}.\n      Work the ones that can be said naturally into the description text. Never as a list.`);
  }

  const raw = [
    product.data.values?.Description,
    meta.data.meesho?.title,
    meta.data.meesho?.description,
    meta.data.meesho?.pack_contents,
  ];

  const fields: PasteField[] = LIMITS.map((limit, i) => {
    const value = raw[i];
    if (value == null) {
      problems.push(`${limit.label} is missing — the AI's reply was cut short. Re-run that prompt (WW-081).`);
      return { ...limit, value: null, length: 0, status: "missing" as const };
    }
    const n = value.length;
    if (n > limit.max) {
      problems.push(
        `${limit.label} is ${n}/${limit.max} — the panel will silently cut the last ${n - limit.max} character(s).\n` +
          `      Trim it in ${limit.file}/ before you list.`,
      );
      return { ...limit, value, length: n, status: "over" as const };
    }
    if (n < limit.min) {
      problems.push(
        `${limit.label} is ${n}/${limit.max}, under the ${limit.min} the prompt asks for — ${limit.min - n} more character(s) to reach it,\n` +
          `      ${limit.max - n} available in total. Nothing breaks, but every sentence you do not write is a\n` +
          `      query you cannot be found for. Ask the AI to extend it in ${limit.file}/.`,
      );
      return { ...limit, value, length: n, status: "under" as const };
    }
    return { ...limit, value, length: n, status: "ok" as const };
  });

  return {
    halves: [
      { dir: dirs.meta ?? META_DIR, file: meta.file, others: meta.others },
      { dir: dirs.products ?? PRODUCTS_DIR, file: product.file, others: product.others },
    ],
    fields,
    problems,
  };
}

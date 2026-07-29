/**
 * image-meta.ts — reads a product's image descriptions and turns them into the EXIF block
 * that gets written into each finished photo.
 *
 * Shared by two tools so there is ONE copy of this logic:
 *   - images.ts   the full pipeline (raw → clean → final), for tagged Meesho downloads
 *   - finish.ts   the shortcut, for images that are already clean (partner/AI photos)
 *
 * Descriptions come from image-meta/<ID>.json (marketplace-agnostic, all Meesho needs) and
 * fall back to products/<ID>.json (Flipkart's 66-field file) so older single-file products
 * still work. Whether any marketplace actually reads embedded descriptions is still unproven
 * (C-019) — writing them is free, so we do.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "sharp";
import { findById } from "./id.js";
import { META_DIR, PRODUCTS_DIR, showPath } from "./paths.js";

export const BRAND = "WishWorks";

/** An all-empty description set — used when the operator picks "no descriptions". */
export const NO_DESCRIPTIONS: Descriptions = { perImage: {}, fallback: null, title: null, keywords: [], source: null, ambiguous: [] };

/**
 * The description-file IDs available to pick from — every `image-meta/<ID>.json`, minus the
 * bundled EXAMPLE and any `_`/dotfile. Returned as bare IDs (no `.json`), sorted, so a menu can
 * offer them the way `npm start` offers products.
 *
 * These are the names as they sit on disk, prefix and all, because a menu that renamed them
 * would stop you finding the file you need to edit. Match them with `normalizeId` — never with
 * `===`, or `image-meta-GTB002` reads as a different product from `GTB-2`.
 */
export async function availableMetaIds(): Promise<string[]> {
  try {
    return (await readdir(META_DIR))
      .filter((f) => /\.json$/i.test(f) && !f.startsWith(".") && !f.startsWith("_") && !/^EXAMPLE/i.test(f))
      .map((f) => f.replace(/\.json$/i, ""))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Files that resolve to the SAME position number — e.g. "1.jpg" and "1.png" both left in a
 * folder after dropping in an AI recreation without deleting the original. Both image tools
 * number their output by ORDER, so a duplicate silently pushes every later image down a slot;
 * callers use this to STOP loudly instead. Returns only the clashing positions → their files.
 */
export function duplicatePositions(files: string[]): Map<number, string[]> {
  const byPos = new Map<number, string[]>();
  for (const f of files) {
    const n = parseInt(path.basename(f, path.extname(f)), 10);
    if (!Number.isFinite(n)) continue;
    byPos.set(n, [...(byPos.get(n) ?? []), f]);
  }
  return new Map([...byPos].filter(([, group]) => group.length > 1));
}

/**
 * Scan a source image's metadata for Meesho traces — the seller-code tag ("s-971393175") or
 * the word "meesho" — in whatever EXIF/XMP/IPTC block the download carried. Returns the match
 * (to show the operator) or null.
 *
 * This is only about METADATA. Both image tools re-encode WITHOUT copying source metadata, so
 * the OUTPUT is clean regardless — a hit here just warns you the file came from Meesho. A tag
 * burned into the PIXELS is invisible to this; that needs the crop/erase path in images.ts.
 */
export function meeshoResidue(meta: Metadata): string | null {
  const blob = [meta.exif, meta.iptc, meta.xmp]
    .filter(Boolean)
    .map((b) => (Buffer.isBuffer(b) ? b.toString("latin1") : String(b)))
    .join(" ");
  if (!blob) return null;
  const code = blob.match(/\bs-\d{6,}\b/i);
  if (code) return code[0];
  if (/meesho/i.test(blob)) return "meesho";
  return null;
}

/**
 * Per-image descriptions from the product file.
 *
 * The AI writes these after looking at BOTH source images, so image 1 gets a description of
 * the decorated shot and image 2 a description of the pack contents — they are not
 * interchangeable.
 *
 *   "images": { "1": "…main shot…", "2": "…contents…" }
 *
 * Falls back to Model Name + Search Keywords when a per-image line is missing, so an older
 * product file still gets something rather than nothing.
 */
export type Descriptions = {
  perImage: Record<string, string>;
  fallback: string | null;
  /** Model Name — used as the title portion of each description. */
  title: string | null;
  /** Search Keywords — appended to every image's description. */
  keywords: string[];
  /**
   * Which file these came from, relative to the project root — e.g. "image-meta/ANP-1.json".
   * `null` means no description file matched this product at all, which is different from a
   * file that exists but says nothing: the first is almost always a folder named wrong, the
   * second is a legitimate fallback. Callers that warn need to tell those two apart.
   */
  source: string | null;
  /**
   * Other files that answer to the same product ID — e.g. `ANP003.json` left behind next to
   * `image-meta-ANP003.json`. One of them is stale and nothing here can tell which, so the
   * lookup picks deterministically and the CLIs say so. Empty in the normal case.
   */
  ambiguous: string[];
};

/**
 * The full metadata block written into each image.
 *
 * Only these EXIF tags are used because they are the ones sharp actually writes — verified by
 * test. XPTitle/XPKeywords/XPSubject and XMP are silently dropped by sharp's EXIF writer, so
 * writing them would be a lie. Real IPTC/XMP would need exiftool; not worth it while the
 * benefit is unproven (C-019).
 *
 * Artist + Copyright are Google's recommended attribution pair — if any channel ever does read
 * this, they are what earns a credit link.
 */
export function buildExif(description: string) {
  const year = new Date().getUTCFullYear();
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/-/g, ":");
  return {
    IFD0: {
      ImageDescription: description,
      Artist: BRAND,
      Copyright: `(c) ${year} ${BRAND}. All rights reserved.`,
      Software: `${BRAND} Listing Factory`,
      DateTime: stamp,
    },
  };
}

/**
 * One image's description: what the AI saw in that specific photo, then the product name, then
 * the keyword set. Natural language first so it reads as a sentence, not a keyword dump.
 */
export function composeDescription(perImage: string | null, d: Descriptions): string | null {
  const parts: string[] = [];
  if (perImage) parts.push(perImage.replace(/\s*[.]\s*$/, ""));
  if (d.title && !(perImage ?? "").toLowerCase().includes(d.title.toLowerCase())) parts.push(d.title);
  if (parts.length === 0 && d.fallback) parts.push(d.fallback);
  if (parts.length === 0) return null;
  let text = parts.join(". ") + ".";
  if (d.keywords.length) text += ` Keywords: ${d.keywords.join(", ")}.`;
  // EXIF ASCII fields have no hard limit but bloating them helps nobody.
  return text.length > 900 ? text.slice(0, 897) + "..." : text;
}

/**
 * Looks in image-meta/<ID>.json first — the marketplace-agnostic file, all a Meesho listing
 * needs. Falls back to products/<ID>.json (Flipkart's 66-field file) so older products that
 * kept everything in one place still work.
 */
export async function descriptionsFor(product: string): Promise<Descriptions> {
  const empty: Descriptions = { perImage: {}, fallback: null, title: null, keywords: [], source: null, ambiguous: [] };

  // findById matches on the normalised ID, so a folder called "ANP 3" finds ANP-3.json,
  // ANP003.json or the raw download name image-meta-ANP003.json — see id.ts.
  const candidates: Array<{ dir: string; kind: "meta" | "product" }> = [
    { dir: META_DIR, kind: "meta" },
    { dir: PRODUCTS_DIR, kind: "product" },
  ];

  for (const { dir, kind } of candidates) {
    const match = await findById(dir, product);
    if (!match) continue;
    const { file, others } = match;
    try {
      const data = JSON.parse(await readFile(file, "utf8"));

      // image-meta uses flat title/keywords; the Flipkart file nests them under values.
      const v = data?.values ?? {};
      const title =
        kind === "meta"
          ? typeof data?.title === "string" ? data.title : null
          : typeof v["Model Name"] === "string" ? v["Model Name"] : null;
      const rawKw = kind === "meta" ? data?.keywords : v["Search Keywords"];
      const keywords = Array.isArray(rawKw)
        ? rawKw.filter((k: unknown) => typeof k === "string" && k.trim())
        : [];
      const fallback = [title, ...keywords].filter(Boolean).join(", ").slice(0, 400) || null;

      const perImage: Record<string, string> = {};
      const raw = data?.images;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, val] of Object.entries(raw)) {
          if (typeof val === "string" && val.trim()) perImage[k] = val.trim().slice(0, 400);
        }
      }
      return {
        perImage, fallback, title, keywords,
        source: showPath(file),
        ambiguous: others.map((f) => showPath(f)),
      };
    } catch {
      return empty; // malformed file is not this tool's problem
    }
  }
  return empty;
}

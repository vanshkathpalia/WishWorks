/**
 * finish-core.ts — the "already clean" shortcut as a plain function.
 *
 * Options in, structured result out, nothing printed and nothing exited. `finish.ts` is the CLI
 * wrapper (argv + the descriptions menu + the report); the Electron app calls `runFinish()`.
 * What the tool does and why is documented in `finish.ts`.
 *
 * `cleanId` and `numberedImages` are exported because a caller has to decide, before running,
 * whether a folder IS a listing and what it will be named — tab 4 has to show that pairing
 * before anything is written (WW-077 / WW-078).
 */

import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  buildExif, composeDescription, descriptionsFor, duplicatePositions, meeshoResidue,
  NO_DESCRIPTIONS, type Descriptions,
} from "./image-meta.js";
import { encodeJpeg } from "./encode.js";
import { addBorder, squareImage } from "./square.js";

// Two size notes, both in finishOne, both purely informational — finish never resizes and never
// refuses. The RATIO (1:1) is never a deliberate choice, so its note prescribes a fix. The
// RESOLUTION usually is deliberate — Meesho prices shipping off the main image
// (docs/guides/SHIPPING-COST.md) — so its note states the number and prescribes nothing.
// Contrast images.ts, where a small source genuinely does mean "re-download a bigger one".

/** Below this on the short side, a listing image is soft once a buyer zooms. */
const SMALL_BELOW = 1000;
/** Under this, Meesho may refuse the image. Blog-sourced, never confirmed — worded as a maybe. */
const LIKELY_REJECTED = 500;

// Same input formats images.ts accepts. Output is always JPEG — the container EXIF descriptions
// land in reliably (PNG/AVIF metadata is dropped by sharp's writer).
const INPUT_EXT = new Set([
  ".avif", ".webp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".bmp", ".heic", ".heif",
]);

export type Row = { id: string; from: string; to: string; size: string; notes: string[] };

export interface FinishOptions {
  /** A single listing folder, a category, or the whole tree — it walks down to find listings. */
  inDir: string;
  /** Flat output folder. Every finished image lands here as <ID>.<n>.jpg. */
  outDir: string;
  /** Force the output name prefix. Single-listing only — this is the ONLY thing that renames. */
  id?: string | null;
  /** Which image-meta/<ID>.json supplies the descriptions. "none" embeds nothing.
   *  Omit to use each listing's own auto-ID. Single-listing only. */
  metaId?: string | "none" | null;
  /** Pad/crop each image to 1:1. Off by default — the point of finish is untouched pixels. */
  square?: boolean;
  /** Inset inside a white frame this many px wide. Implies square. Untested, SHIPPING-COST.md. */
  border?: number;
}

export interface FinishResult {
  /** "single" when inDir held numbered images directly, "tree" when it was walked. */
  mode: "single" | "tree";
  /** Single mode: the output prefix and the folder it came from. */
  id?: string;
  folderName?: string;
  /** How many listing folders were finished. Tree mode; 0 means nothing was found. */
  listings: number;
  rows: Row[];
  failures: string[];
}

/**
 * Folder name → product ID.
 *   Numbered:    "ANP 1 - p" → "ANP-1", "GTB3" → "GTB-3"  (code + first number, project shape)
 *   Descriptive: "HBD-kitty" → "HBD-kitty", "HBD-space - p" → "HBD-space" ("- p" is the pending flag)
 *
 * A trailing " - p" is Vansh's PENDING flag, not part of the identity, so it's dropped first —
 * the ID must be the same whether or not the listing is still pending, or its image-meta/<ID>.json
 * would stop matching the moment the flag comes off.
 *
 * Then: when the name carries a NUMBER, that's the identifier — leading letters as the code plus
 * the number, trailing notes dropped. When there is NO number, the descriptive word ("kitty",
 * "space") IS the identifier, kept and tidied into a clean slug so it needs no --id override.
 */
export function cleanId(folderName: string): string {
  const name = folderName.trim().replace(/\s+-\s*p\s*$/i, "").trim(); // drop the "- p" pending flag
  const m = name.match(/([A-Za-z]+)\D*?(\d+)/);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || folderName;
}

/** Image files in a folder, in true numeric order (1, 2, 10 — not 1, 10, 2). */
export async function numberedImages(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((f) => !f.startsWith(".") && INPUT_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => {
      const na = parseInt(path.basename(a, path.extname(a)), 10);
      const nb = parseInt(path.basename(b, path.extname(b)), 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
}

interface OneOptions {
  id: string;
  srcDir: string;
  file: string;
  index: number;
  outDir: string;
  descs: Descriptions;
  square: boolean;
  border: number;
}

async function finishOne(o: OneOptions): Promise<Row> {
  const { id, file, index, descs, square, border } = o;
  const src = path.join(o.srcDir, file);
  const outName = `${id}.${index}.jpg`;
  const out = path.join(o.outDir, outName);
  const notes: string[] = [];

  let img = sharp(src, { failOn: "none" });
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error(`could not read dimensions (${meta.format ?? "unknown format"})`);

  // The one shape check that survives. NOT how many pixels — the seller sets that deliberately
  // (Meesho prices shipping off the main image) and 1254x1254 is as fine as 1500x1500. But the
  // RATIO is never deliberate: an AI hands back a 1024x1536 now and then, and finish does not
  // resize, so it would go out the odd one in a listing of squares. Warn, don't fix — --square
  // fixes it if you want it fixed.
  if (w !== h && !square) {
    notes.push(`NOT SQUARE ${w}x${h} — every other image is 1:1. Re-run with --square, or get a 1:1 original`);
  }

  // Resolution, stated and NOT prescribed. This never blocks, never resizes, and the metadata
  // still goes in — a small main image is often the deliberate choice here, because Meesho
  // prices shipping off it (SHIPPING-COST.md), so "get a larger original" is the wrong advice
  // and was rightly cut once already (learning note 7). But deliberate and overlooked leave the
  // same trace, so print the number and let the operator decide. The ~500px floor is
  // blog-sourced, not from Meesho's own docs — see SHIPPING-COST.md on that whole family of
  // claims — so it is worded as a maybe.
  if (Math.min(w, h) < SMALL_BELOW) {
    notes.push(
      `SMALL ${w}x${h} — fine if that is your shipping choice; otherwise soft when a buyer zooms` +
        (Math.min(w, h) < LIKELY_REJECTED ? `, and under ~500px Meesho may reject it outright` : ``),
    );
  }

  // Metadata-only Meesho check. The output never carries source metadata (we don't copy it),
  // so this is a heads-up that the file came from Meesho — not something in the finished image.
  const residue = meeshoResidue(meta);
  if (residue) {
    notes.push(`MEESHO METADATA in source ("${residue}") — dropped from output. Check pixels for a visible tag too`);
  }

  // square: pad-to-white / centre-crop to 1:1 (same rule as images.ts, via square.ts). Off by
  // default — finish's whole point is to leave already-good pixels untouched.
  let outSize = `${w}x${h} (unchanged)`;
  if (square) {
    const sq = await squareImage(img, w, h);
    img = sq.img;
    if (sq.method !== "already square") {
      const side = sq.method === "padded white" ? Math.max(w, h) : Math.min(w, h);
      outSize = `${w}x${h} -> ${side}x${side} (${sq.method})`;
      notes.push(`squared: ${sq.method}`);
    }
  }

  // border: inset the picture inside a white frame, keeping the outer size unchanged. Opt-in,
  // and unproven — see square.ts and docs/guides/SHIPPING-COST.md. Needs a square to inset into,
  // so it implies square; on a non-square image we'd otherwise silently distort it.
  if (border > 0) {
    const side = Math.min(w, h);
    if (w !== h && !square) {
      notes.push(`SKIPPED --border: ${w}x${h} is not square. Re-run with --square as well`);
    } else {
      img = await addBorder(img, side, border);
      outSize = `${side}x${side} (inset in a ${border}px white border)`;
      notes.push(`inset inside a ${border}px white border`);
    }
  }

  // Beyond the optional square/border above, pixels are left as they are — no resize. flatten()
  // only matters for a transparent PNG, which JPEG can't hold; it fills transparency with white.
  let pipe = img.flatten({ background: { r: 255, g: 255, b: 255 } });

  const own = descs.perImage[String(index)] ?? null;
  const description = composeDescription(own, descs);
  if (description) {
    pipe = pipe.withExif(buildExif(description));
    notes.push(
      own
        ? `metadata: "${description.slice(0, 62)}${description.length > 62 ? "…" : ""}"`
        : `no per-image line for position ${index} — used the product-level fallback`,
    );
  } else {
    notes.push(`no description — add an "images" block to image-meta/${id}.json`);
  }

  // finish does NOT resize, so unlike images.ts a big source really can blow past Meesho's 5MB
  // cap at q95 — and the upload just fails with no explanation. Same guard, shared.
  const { buf, notes: encodeNotes } = await encodeJpeg(pipe, 95);
  notes.push(...encodeNotes);
  await writeFile(out, buf);

  return { id, from: file, to: outName, size: outSize, notes };
}

/** One listing folder → its rows. Skips folders with no readable images. */
async function finishListing(
  id: string,
  srcDir: string,
  outDir: string,
  descs: Descriptions,
  square: boolean,
  border: number,
  rows: Row[],
  failures: string[],
  onRow?: (row: Row) => void,
): Promise<void> {
  const files = await numberedImages(srcDir);
  if (files.length === 0) {
    failures.push(`${id}: no readable images in ${srcDir}`);
    return;
  }
  const unnumbered = files.filter((f) => !Number.isFinite(parseInt(path.basename(f, path.extname(f)), 10)));
  if (unnumbered.length > 0) {
    failures.push(`${id}: not named 1, 2, 3… so upload order is a guess -> ${unnumbered.join(", ")}`);
  }
  // Two files at the same position (a leftover 1.jpg beside the AI's new 1.png) would each be
  // finished and shift every later image down a slot. Skip this listing loudly rather than that.
  const dupes = duplicatePositions(files);
  if (dupes.size > 0) {
    const detail = [...dupes].map(([n, group]) => `${n}: ${group.join(" + ")}`).join("; ");
    failures.push(`${id}: two files share a position number (${detail}). Keep ONE file per number — delete the one you replaced.`);
    return;
  }
  for (let i = 0; i < files.length; i++) {
    try {
      const row = await finishOne({ id, srcDir, file: files[i], index: i + 1, outDir, descs, square, border });
      rows.push(row);
      onRow?.(row);
    } catch (err) {
      failures.push(`${id}/${files[i]}: ${(err as Error).message}`);
    }
  }
}

/**
 * Walk a folder tree, finishing every listing found. A subfolder that directly holds numbered
 * images IS a listing (finished with its cleanId + matching descriptions); a subfolder that
 * holds only more folders is a container (a category) and is recursed into. So inDir can be a
 * single category or the whole downloads root and it finds every listing at any depth. Returns
 * how many listing folders it finished.
 */
async function finishTree(
  dir: string,
  outDir: string,
  square: boolean,
  border: number,
  rows: Row[],
  failures: string[],
  onRow?: (row: Row) => void,
): Promise<number> {
  const subs = (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  let listings = 0;
  for (const sub of subs) {
    const subPath = path.join(dir, sub);
    if ((await numberedImages(subPath)).length > 0) {
      listings++;
      const id = cleanId(sub);
      await finishListing(id, subPath, outDir, await descriptionsFor(id), square, border, rows, failures, onRow);
    } else {
      listings += await finishTree(subPath, outDir, square, border, rows, failures, onRow);
    }
  }
  return listings;
}

/**
 * Finish one listing or a whole tree of them. `onRow` fires as each image lands, for a live
 * progress bar; every row is in the result too, so a caller that doesn't want progress can
 * ignore it.
 *
 * Note what `id` and `metaId` do NOT do: choosing a descriptions file never renames anything.
 * That was WW-078 — picking ANP-1's descriptions for a folder called "GTB 1" wrote Annaprashan
 * text into Groom-To-Be photos AND named them ANP-1.*. `id` is the only thing that renames,
 * because that is what the caller explicitly asked for.
 */
export async function runFinish(
  o: FinishOptions,
  onRow?: (row: Row) => void,
): Promise<FinishResult> {
  const square = o.square === true;
  const border = o.border ?? 0;
  const rows: Row[] = [];
  const failures: string[] = [];

  await mkdir(o.outDir, { recursive: true });

  // If inDir holds images directly, it IS one listing. Otherwise treat each subfolder as one.
  if ((await numberedImages(o.inDir)).length > 0) {
    const folderName = path.basename(o.inDir);
    const id = o.id || cleanId(folderName);
    const descs = o.metaId === "none"
      ? NO_DESCRIPTIONS
      : await descriptionsFor(o.metaId || id);
    await finishListing(id, o.inDir, o.outDir, descs, square, border, rows, failures, onRow);
    return { mode: "single", id, folderName, listings: 1, rows, failures };
  }

  // Batch: finishTree walks down through any category levels, auto-cleaning each listing's ID
  // and using its matching image-meta/<ID>.json if present. id/metaId do not apply here.
  const listings = await finishTree(o.inDir, o.outDir, square, border, rows, failures, onRow);
  return { mode: "tree", listings, rows, failures };
}

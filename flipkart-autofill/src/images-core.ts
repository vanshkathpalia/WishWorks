/**
 * images-core.ts — the raw→clean→final image pipeline as a plain function.
 *
 * Options in, structured result out, nothing printed and nothing exited. `images.ts` is the CLI
 * wrapper that parses argv and prints this; the Electron app calls `runImages()` directly.
 * The three-folder model and the reasoning behind each step are documented in `images.ts`.
 *
 * Nothing here reads process.argv or writes to the console — that is the whole point. Errors
 * that concern one image become a `failures` entry; the only thrown errors are ones that make
 * the whole run meaningless.
 */

import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildExif, composeDescription, descriptionsFor, duplicatePositions, meeshoResidue, type Descriptions } from "./image-meta.js";
import { encodeJpeg } from "./encode.js";
import { IMAGES_DIR } from "./paths.js";
import { addBorder, squareImage } from "./square.js";

// Image descriptions (image-meta/, products/) are read via ./image-meta.ts, which owns those
// paths. A Meesho-only product needs an image-meta file and nothing else.
export const RAW = path.join(IMAGES_DIR, "1-raw");
export const CLEAN = path.join(IMAGES_DIR, "2-clean");
export const FINAL = path.join(IMAGES_DIR, "3-final");

/** Marketplace target. Square, comfortably above the 1000px zoom threshold. */
export const TARGET = 1500;
/** Below this on the short side, upscaling can't recover detail — warn the user. */
const SOFT_BELOW = 1000;

// Meesho serves .avif today (not .webp). Accept the HEIF family too — iPhone photos are .heic.
const INPUT_EXT = new Set([
  ".avif", ".webp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".bmp", ".heic", ".heif",
]);

export type Row = {
  product: string;
  from: string;
  to: string;
  size: string;
  square: string;
  notes: string[];
};

/** What one folder's name resolved to. Show this BEFORE writing — see WW-077. */
export type Pairing = {
  product: string;
  /** The description file that matched, or null when there is none. */
  source: string | null;
  /** How many per-image descriptions it carries. */
  perImage: number;
  /** Other files answering to the same ID — one is probably stale. Empty in the normal case. */
  ambiguous: string[];
};

export interface ImagesOptions {
  /** Stage 2 (2-clean → 3-final, embeds descriptions) instead of stage 1 (1-raw → 2-clean). */
  final?: boolean;
  /** Pixels to take off the bottom — the Meesho watermark strip. Stage 1 only. */
  cropBottom?: number;
  /** Positions to crop. Omit/null for every image. */
  cropImages?: number[] | null;
  /** [width, height] of the tag to paint out at bottom-left. Stage 1 only. */
  eraseTag?: [number, number] | null;
  /** Positions to erase. Omit/null for every image. */
  eraseImages?: number[] | null;
  /** Inset the picture inside a white frame this many px wide. Untested, see SHIPPING-COST.md. */
  border?: number;
  /** Stage 2: write the images even when a folder has no description file. */
  force?: boolean;
}

export interface ImagesResult {
  stage: 1 | 2;
  /** Folder names, for messages: "1-raw" → "2-clean" or "2-clean" → "3-final". */
  srcName: string;
  outName: string;
  /** Product folders found in the source directory. Empty means there was nothing to do. */
  products: string[];
  /** Stage 2 only: folder → description file, resolved before anything was written. */
  pairings: Pairing[];
  rows: Row[];
  failures: string[];
  /** Set when the run stopped and wrote NOTHING. `missing` names the folders with no file. */
  blocked: { missing: string[] } | null;
}

interface OneOptions {
  product: string;
  file: string;
  index: number;
  cropBottom: number;
  cropPositions: Set<number> | null;
  eraseTag: [number, number] | null;
  erasePositions: Set<number> | null;
  descs: Descriptions;
  isFinal: boolean;
  border: number;
}

async function processOne(o: OneOptions): Promise<Row> {
  const { product, file, index, descs, isFinal, border } = o;
  const srcDir = isFinal ? CLEAN : RAW;
  const outDir = isFinal ? FINAL : CLEAN;
  const src = path.join(srcDir, product, file);
  // Stage 1 keeps plain numbers so the AI's replacements drop straight in. Stage 2 stamps the
  // product ID so upload order is unambiguous.
  const outName = isFinal ? `${product}-${index}.jpg` : `${index}.jpg`;
  const out = path.join(outDir, product, outName);
  const notes: string[] = [];

  let img = sharp(src, { failOn: "none" });
  const meta = await img.metadata();
  let w = meta.width ?? 0;
  let h = meta.height ?? 0;
  if (!w || !h) throw new Error(`could not read dimensions (${meta.format ?? "unknown format"})`);

  const originalSize = `${w}x${h}`;

  if (meta.space === "cmyk") notes.push("was CMYK, converted to sRGB");

  // Warn if the SOURCE carried Meesho metadata (a seller code or "meesho"). We never copy
  // source metadata into the output, so this is a heads-up, not a defect — and it sees only
  // METADATA, never a tag burned into the pixels. Most useful in stage 1, reading the raw
  // .avif; in --final the source is already our clean JPEG, so it rarely fires there.
  const residue = meeshoResidue(meta);
  if (residue) {
    notes.push(`MEESHO METADATA in source ("${residue}") — dropped from output; check pixels for a visible tag too`);
  }

  // 1. Optional fixed crop off the bottom (the Meesho watermark strip). Applies to every
  //    image by default, since Meesho stamps the tag on all of them; cropImages narrows
  //    it to specific positions.
  if (o.cropBottom > 0 && (o.cropPositions === null || o.cropPositions.has(index))) {
    if (o.cropBottom >= h - 10) throw new Error(`--crop-bottom=${o.cropBottom} would remove the whole image`);
    img = img.extract({ left: 0, top: 0, width: w, height: h - o.cropBottom });
    h = h - o.cropBottom;
    notes.push(`cropped ${o.cropBottom}px off bottom`);
    img = sharp(await img.toBuffer(), { failOn: "none" }); // re-open so later extracts use new size
  }

  // 1b. Paint out the tag instead of cropping it. Needed when the tag sits at the same
  //     height as real content (e.g. the "what's inside" infographic, where the Meesho code
  //     is level with a product label) — a bottom crop would take the label with it.
  if (o.eraseTag && (o.erasePositions === null || o.erasePositions.has(index))) {
    const [ew, eh] = o.eraseTag;
    if (ew >= w || eh >= h) throw new Error(`--erase-tag=${ew},${eh} is bigger than the image`);
    // Sample just above/right of the patch so we match the real background, not assume white.
    const probe = await sharp(await img.clone().extract({
      left: Math.min(ew + 2, w - 4), top: Math.max(0, h - eh - 6), width: 4, height: 4,
    }).toBuffer()).stats();
    const [r, g, b] = probe.channels.slice(0, 3).map((c) => Math.round(c.mean));
    const patch = await sharp({
      create: { width: ew, height: eh, channels: 3, background: { r, g, b } },
    }).png().toBuffer();
    img = sharp(
      await img.composite([{ input: patch, left: 0, top: h - eh }]).toBuffer(),
      { failOn: "none" },
    );
    notes.push(`erased ${ew}x${eh}px tag at bottom-left (filled rgb(${r},${g},${b}))`);
  }

  // 2. Make it square. Pad with white when the background is white (invisible), centre-crop
  //    when it isn't (white bars would be glaring). Shared with finish.ts via square.ts.
  const squared = await squareImage(img, w, h);
  img = squared.img;
  const squareMethod = squared.method;
  if (squareMethod === "padded white") {
    notes.push(`padded ${originalSize} to square — this shrinks how much of the frame the product fills`);
  } else if (squareMethod === "centre-cropped") {
    notes.push(`background is not white, so ${originalSize} was centre-cropped rather than padded`);
  }

  // 3. Warn on genuinely soft sources — upscaling cannot invent detail.
  const shortSide = Math.min(w, h);
  if (shortSide < SOFT_BELOW) {
    notes.push(`SOURCE ONLY ${shortSide}px — will look soft, re-download a larger original`);
  }

  // 4. Resize, force sRGB, encode. With a border the picture is inset inside a white frame
  //    instead, so the output is still exactly TARGET x TARGET (see square.ts / SHIPPING-COST.md).
  if (border > 0) {
    img = await addBorder(img, TARGET, border);
    notes.push(`inset inside a ${border}px white border (outer size still ${TARGET}x${TARGET})`);
  } else {
    img = img.resize(TARGET, TARGET, { fit: "fill" });
  }
  img = img
    .toColourspace("srgb")
    .flatten({ background: { r: 255, g: 255, b: 255 } });

  // Descriptions are written in the FINAL stage only — at stage 1 the AI hasn't written them
  // yet. Whether any marketplace reads them is still unproven (C-019); writing is free.
  const own = descs.perImage[String(index)] ?? null;
  const description = isFinal ? composeDescription(own, descs) : null;
  if (description) {
    try {
      img = img.withExif(buildExif(description));
      notes.push(
        own
          ? `metadata: "${description.slice(0, 62)}${description.length > 62 ? "…" : ""}"`
          : `no per-image description for position ${index} — used the product-level fallback`,
      );
    } catch {
      /* older sharp without withExif — skip silently, it is optional */
    }
  } else if (isFinal) {
    notes.push(`no description — create image-meta/${product}.json with an "images" block`);
  }

  // 1500x1500 at q90 lands ~400KB, so the cap is only ever a guard here — but it is the same
  // guard finish.ts uses, so neither tool can ship a file Meesho will reject.
  const { buf, notes: encodeNotes } = await encodeJpeg(img, 90);
  notes.push(...encodeNotes);

  await mkdir(path.join(outDir, product), { recursive: true });
  await writeFile(out, buf);

  return {
    product,
    from: file,
    to: outName,
    size: `${originalSize} -> ${TARGET}x${TARGET}`,
    square: squareMethod,
    notes,
  };
}

/**
 * Run one stage of the pipeline. `onRow` fires as each image lands, for a live progress bar;
 * every row is in the result too, so a caller that doesn't want progress can ignore it.
 */
export async function runImages(
  opts: ImagesOptions = {},
  onRow?: (row: Row) => void,
): Promise<ImagesResult> {
  const isFinal = opts.final === true;
  const cropBottom = opts.cropBottom ?? 0;
  const border = opts.border ?? 0;
  const cropPositions = opts.cropImages ? new Set(opts.cropImages) : null; // null = every image
  const erasePositions = opts.eraseImages ? new Set(opts.eraseImages) : null;
  const eraseTag = opts.eraseTag ?? null;

  const srcDir = isFinal ? CLEAN : RAW;
  const base: Omit<ImagesResult, "rows" | "failures" | "pairings" | "blocked"> = {
    stage: isFinal ? 2 : 1,
    srcName: isFinal ? "2-clean" : "1-raw",
    outName: isFinal ? "3-final" : "2-clean",
    products: [],
  };

  await mkdir(RAW, { recursive: true });
  await mkdir(CLEAN, { recursive: true });
  await mkdir(FINAL, { recursive: true });

  const products = (await readdir(srcDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  if (products.length === 0) {
    return { ...base, pairings: [], rows: [], failures: [], blocked: null };
  }

  // Descriptions are the whole point of --final, and they are found by FOLDER NAME:
  // images/2-clean/ANP-1042/ -> image-meta/ANP-1042.json. Get them for every product BEFORE
  // writing anything, so a missing or mismatched file stops the run instead of quietly
  // producing correct-looking images with nothing embedded. That failure used to be one line
  // in a results table, which is not where anyone looks.
  const descsBy = new Map<string, Descriptions>();
  for (const p of products) descsBy.set(p, await descriptionsFor(p));

  const pairings: Pairing[] = isFinal
    ? products.map((p) => ({
        product: p,
        source: descsBy.get(p)!.source,
        perImage: Object.keys(descsBy.get(p)!.perImage).length,
        ambiguous: descsBy.get(p)!.ambiguous,
      }))
    : [];

  // Only a MISSING FILE stops the run. A file that exists but has no "images" block is a
  // different thing — composeDescription falls back to Model Name + keywords on purpose, and
  // that path is tested. Stopping on it would break a working feature to prevent a typo.
  if (isFinal && !opts.force) {
    const missing = products.filter((p) => descsBy.get(p)!.source === null);
    if (missing.length > 0) {
      return { ...base, products, pairings, rows: [], failures: [], blocked: { missing } };
    }
  }

  const rows: Row[] = [];
  const failures: string[] = [];

  for (const product of products) {
    const files = (await readdir(path.join(srcDir, product)))
      .filter((f) => !f.startsWith(".") && INPUT_EXT.has(path.extname(f).toLowerCase()))
      // numeric order: 1, 2, 3, 10 — not the text order 1, 10, 2, 3
      .sort((a, b) => {
        const na = parseInt(path.basename(a, path.extname(a)), 10);
        const nb = parseInt(path.basename(b, path.extname(b)), 10);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.localeCompare(b);
      });

    if (files.length === 0) {
      failures.push(`${product}: no readable images in the folder`);
      continue;
    }

    const unnumbered = files.filter((f) => !Number.isFinite(parseInt(path.basename(f, path.extname(f)), 10)));
    if (unnumbered.length > 0) {
      failures.push(
        `${product}: these are not named 1, 2, 3… so the order is a guess -> ${unnumbered.join(", ")}`,
      );
    }

    // Two files sharing a position number (e.g. a leftover 1.jpg next to the AI's new 1.png)
    // would each be processed and shift every later image down a slot. Stop this listing loudly.
    const dupes = duplicatePositions(files);
    if (dupes.size > 0) {
      const detail = [...dupes].map(([n, group]) => `${n}: ${group.join(" + ")}`).join("; ");
      failures.push(`${product}: two files share a position number (${detail}). Keep ONE file per number — delete the one you replaced.`);
      continue;
    }

    const descs = descsBy.get(product)!;

    for (let i = 0; i < files.length; i++) {
      try {
        const row = await processOne({
          product, file: files[i], index: i + 1,
          cropBottom, cropPositions, eraseTag, erasePositions, descs, isFinal, border,
        });
        rows.push(row);
        onRow?.(row);
      } catch (err) {
        failures.push(`${product}/${files[i]}: ${(err as Error).message}`);
      }
    }
  }

  return { ...base, products, pairings, rows, failures, blocked: null };
}

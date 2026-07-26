/**
 * images.ts — turns raw downloaded product photos into upload-ready listing images.
 *
 * Three folders, one direction of travel. Nothing is ever overwritten in place, so a mistake
 * at any stage is undone by deleting a folder and re-running.
 *
 *   images/1-raw/<ID>/1.avif …     what you downloaded (Meesho tag still on it)
 *        |  npm run images -- --crop-bottom=40    convert · crop tag · square · 1500px
 *   images/2-clean/<ID>/1.jpg …    clean plates — FEED THESE TO THE AI
 *        |  (you replace 1.jpg / 2.jpg with the AI's recreations)
 *        |  npm run images -- --final             square · 1500px · embed descriptions
 *   images/3-final/<ID>/<ID>-1.jpg …   upload these
 *
 * The tag is cropped ONCE, in stage 1. Stage 2 never crops — by then images 1 and 2 are
 * AI-recreated and 3/4 were already cleaned. All deterministic: no AI, no network, no credits.
 *
 * Run:  npm run images -- --crop-bottom=40     stage 1 (raw → clean)
 *       npm run images                         stage 1, no cropping
 *       npm run images -- --erase-tag=150,30   stage 1, paint the tag out instead of cropping
 *                                              (use when the tag is level with real content)
 *
 *   Typical real run — crop image 1 (goes to the AI anyway), paint the tag out on the rest:
 *       npm run images -- --crop-bottom=25 --crop-images=1 --erase-tag=150,30 --erase-images=2,3,4
 *       npm run images -- --final              stage 2 (clean → final, writes metadata)
 *       npm run images -- --final --border=20  stage 2, inset in a 20px white frame
 *
 * --border is EXPERIMENTAL and off by default: the seller believes a ~20px frame lowers
 * Meesho's shipping estimate, which is untested. See docs/guides/SHIPPING-COST.md.
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
const RAW = path.join(IMAGES_DIR, "1-raw");
const CLEAN = path.join(IMAGES_DIR, "2-clean");
const FINAL = path.join(IMAGES_DIR, "3-final");

/** Marketplace target. Square, comfortably above the 1000px zoom threshold. */
const TARGET = 1500;
/** Below this on the short side, upscaling can't recover detail — warn the user. */
const SOFT_BELOW = 1000;

// Meesho serves .avif today (not .webp). Accept the HEIF family too — iPhone photos are .heic.
const INPUT_EXT = new Set([
  ".avif", ".webp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".bmp", ".heic", ".heif",
]);

type Row = {
  product: string;
  from: string;
  to: string;
  size: string;
  square: string;
  notes: string[];
};

async function processOne(
  product: string,
  file: string,
  index: number,
  cropBottom: number,
  cropPositions: Set<number> | null,
  eraseTag: [number, number] | null,
  erasePositions: Set<number> | null,
  descs: Descriptions,
  isFinal: boolean,
  border: number,
): Promise<Row> {
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
  //    image by default, since Meesho stamps the tag on all of them; --crop-images narrows
  //    it to specific positions.
  if (cropBottom > 0 && (cropPositions === null || cropPositions.has(index))) {
    if (cropBottom >= h - 10) throw new Error(`--crop-bottom=${cropBottom} would remove the whole image`);
    img = img.extract({ left: 0, top: 0, width: w, height: h - cropBottom });
    h = h - cropBottom;
    notes.push(`cropped ${cropBottom}px off bottom`);
    img = sharp(await img.toBuffer(), { failOn: "none" }); // re-open so later extracts use new size
  }

  // 1b. Paint out the tag instead of cropping it. Needed when the tag sits at the same
  //     height as real content (e.g. the "what's inside" infographic, where the Meesho code
  //     is level with a product label) — a bottom crop would take the label with it.
  if (eraseTag && (erasePositions === null || erasePositions.has(index))) {
    const [ew, eh] = eraseTag;
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

  // 4. Resize, force sRGB, encode. With --border the picture is inset inside a white frame
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

async function main() {
  const cropArg = process.argv.find((a) => a.startsWith("--crop-bottom="));
  const cropBottom = cropArg ? parseInt(cropArg.split("=")[1], 10) : 0;
  if (cropArg && (!Number.isFinite(cropBottom) || cropBottom < 0)) {
    console.error(`✖ --crop-bottom needs a positive number of pixels, got "${cropArg}"`);
    process.exit(1);
  }

  // Which positions get cropped. Default: ALL of them — Meesho stamps its tag on every
  // downloaded image. Narrow it with --crop-images=1,3 if a listing ever differs.
  const posArg = process.argv.find((a) => a.startsWith("--crop-images="));
  const cropPositions: Set<number> | null = posArg
    ? new Set(posArg.split("=")[1].split(",").map((n) => parseInt(n.trim(), 10)))
    : null; // null = every image
  if (cropPositions && [...cropPositions].some((n) => !Number.isFinite(n) || n < 1)) {
    console.error(`✖ --crop-images needs positions like 1 or 1,3 — got "${posArg}"`);
    process.exit(1);
  }
  if (cropBottom > 0) {
    const which = cropPositions ? `image ${[...cropPositions].join(", ")} only` : "every image";
    console.log(`\n  Cropping ${cropBottom}px off the bottom of ${which}.`);
  }

  const eraseArg = process.argv.find((a) => a.startsWith("--erase-tag="));
  let eraseTag: [number, number] | null = null;
  if (eraseArg) {
    const [ew, eh] = eraseArg.split("=")[1].split(",").map((n) => parseInt(n.trim(), 10));
    if (!Number.isFinite(ew) || !Number.isFinite(eh) || ew < 1 || eh < 1) {
      console.error(`✖ --erase-tag needs width,height in pixels, e.g. --erase-tag=130,28`);
      process.exit(1);
    }
    eraseTag = [ew, eh];
  }

  // Which positions get the tag painted out. Default: all of them.
  const erasePosArg = process.argv.find((a) => a.startsWith("--erase-images="));
  const erasePositions: Set<number> | null = erasePosArg
    ? new Set(erasePosArg.split("=")[1].split(",").map((n) => parseInt(n.trim(), 10)))
    : null;
  if (erasePositions && [...erasePositions].some((n) => !Number.isFinite(n) || n < 1)) {
    console.error(`✖ --erase-images needs positions like 2,3,4 — got "${erasePosArg}"`);
    process.exit(1);
  }
  if (eraseTag) {
    const which = erasePositions ? `image ${[...erasePositions].join(", ")}` : "every image";
    console.log(`\n  Erasing a ${eraseTag[0]}x${eraseTag[1]}px tag at bottom-left of ${which}.`);
  }

  // Opt-in white frame. The seller's claim is that it lowers Meesho's shipping estimate;
  // that is untested, so it is a flag rather than the default. See docs/guides/SHIPPING-COST.md.
  const borderArg = process.argv.find((a) => a.startsWith("--border="));
  const border = borderArg ? parseInt(borderArg.split("=")[1], 10) : 0;
  if (borderArg && (!Number.isFinite(border) || border < 1 || border * 2 >= TARGET)) {
    console.error(`✖ --border needs a pixel width between 1 and ${TARGET / 2 - 1}, got "${borderArg}"`);
    process.exit(1);
  }
  if (border > 0) {
    console.log(`\n  Insetting every image inside a ${border}px white border (output stays ${TARGET}x${TARGET}).`);
  }

  const isFinal = process.argv.includes("--final");
  const srcDir = isFinal ? CLEAN : RAW;
  const srcName = isFinal ? "2-clean" : "1-raw";
  const outName = isFinal ? "3-final" : "2-clean";

  await mkdir(RAW, { recursive: true });
  await mkdir(CLEAN, { recursive: true });
  await mkdir(FINAL, { recursive: true });

  if (isFinal && eraseTag) {
    console.error(`\n✖ --erase-tag belongs in stage 1. The tag is already gone by --final.\n`);
    process.exit(1);
  }

  if (isFinal && cropBottom > 0) {
    console.error(`\n✖ --crop-bottom does nothing in the --final stage.`);
    console.error(`  The tag is cropped once, in stage 1. Re-cropping here would eat product.\n`);
    process.exit(1);
  }

  console.log(`\n  Stage ${isFinal ? 2 : 1}: images/${srcName}/ → images/${outName}/`);

  const products = (await readdir(srcDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  if (products.length === 0) {
    console.log(`\nNothing to do — images/${srcName}/ is empty.\n`);
    if (isFinal) {
      console.log(`Run stage 1 first:  npm run images -- --crop-bottom=40\n`);
    } else {
      console.log(`Make a folder named after the product ID and put the downloads in it:\n`);
      console.log(`  images/1-raw/ANP-1042/1.avif   <- main image`);
      console.log(`  images/1-raw/ANP-1042/2.avif   <- what's in the pack`);
      console.log(`  images/1-raw/ANP-1042/3.avif\n`);
    }
    return;
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

    const descs = await descriptionsFor(product);

    for (let i = 0; i < files.length; i++) {
      try {
        rows.push(await processOne(product, files[i], i + 1, cropBottom, cropPositions, eraseTag, erasePositions, descs, isFinal, border));
      } catch (err) {
        failures.push(`${product}/${files[i]}: ${(err as Error).message}`);
      }
    }
  }

  // Report
  console.log("");
  let current = "";
  for (const r of rows) {
    if (r.product !== current) {
      current = r.product;
      console.log(`  ${current}`);
    }
    console.log(`    ${r.from.padEnd(12)} ->  ${r.to.padEnd(18)} ${r.size.padEnd(22)} ${r.square}`);
    for (const n of r.notes) {
      const flag = n.includes("SOURCE ONLY") || n.includes("MEESHO METADATA") ? "⚠️ " : "   ";
      console.log(`    ${flag}   ${n}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n  Problems:`);
    for (const f of failures) console.log(`    ✖ ${f}`);
  }

  console.log(`\n  ${rows.length} image(s) written to images/${outName}/`);
  console.log(`  Everything in images/${srcName}/ is untouched.\n`);
  console.log(`  CHECK BEFORE UPLOADING: open images/${outName}/ and confirm that, for each product,`);
  console.log(`  image 1 is the main shot and image 2 shows what is in the pack.\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});

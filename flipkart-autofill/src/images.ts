/**
 * images.ts — turns raw downloaded product photos into upload-ready listing images.
 *
 * This file is the COMMAND LINE only: it parses flags, calls `runImages()` in images-core.ts,
 * and prints the result. All the actual work is in images-core.ts so the Electron app can call
 * it too (WW-066). Nothing here is imported by anything else.
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
 *       npm run images -- --final --force      stage 2 with NO metadata, when you have no
 *                                              description file yet and just want the images
 *
 * Stage 2 prints which description file each folder resolves to and REFUSES to run if any
 * folder has none — the folder name is the product ID, so a rename silently costs you the
 * metadata on every image in it.
 *
 * --border is EXPERIMENTAL and off by default: the seller believes a ~20px frame lowers
 * Meesho's shipping estimate, which is untested. See docs/guides/SHIPPING-COST.md.
 */

import { runImages, TARGET } from "./images-core.js";

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
  const cropImages: number[] | null = posArg
    ? posArg.split("=")[1].split(",").map((n) => parseInt(n.trim(), 10))
    : null; // null = every image
  if (cropImages && cropImages.some((n) => !Number.isFinite(n) || n < 1)) {
    console.error(`✖ --crop-images needs positions like 1 or 1,3 — got "${posArg}"`);
    process.exit(1);
  }
  if (cropBottom > 0) {
    const which = cropImages ? `image ${[...new Set(cropImages)].join(", ")} only` : "every image";
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
  const eraseImages: number[] | null = erasePosArg
    ? erasePosArg.split("=")[1].split(",").map((n) => parseInt(n.trim(), 10))
    : null;
  if (eraseImages && eraseImages.some((n) => !Number.isFinite(n) || n < 1)) {
    console.error(`✖ --erase-images needs positions like 2,3,4 — got "${erasePosArg}"`);
    process.exit(1);
  }
  if (eraseTag) {
    const which = eraseImages ? `image ${[...new Set(eraseImages)].join(", ")}` : "every image";
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
  // Escape hatch for the description guard below — same shape as scan.ts's --force.
  const force = process.argv.includes("--force");

  if (isFinal && eraseTag) {
    console.error(`\n✖ --erase-tag belongs in stage 1. The tag is already gone by --final.\n`);
    process.exit(1);
  }

  if (isFinal && cropBottom > 0) {
    console.error(`\n✖ --crop-bottom does nothing in the --final stage.`);
    console.error(`  The tag is cropped once, in stage 1. Re-cropping here would eat product.\n`);
    process.exit(1);
  }

  const r = await runImages({ final: isFinal, cropBottom, cropImages, eraseTag, eraseImages, border, force });

  console.log(`\n  Stage ${r.stage}: images/${r.srcName}/ → images/${r.outName}/`);

  if (r.products.length === 0) {
    console.log(`\nNothing to do — images/${r.srcName}/ is empty.\n`);
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

  // The folder → description-file pairing, shown whether or not the run went ahead. This is
  // what WW-077 was missing: a rename silently cost every image in the folder its metadata.
  if (r.stage === 2) {
    console.log(`\n  Folder -> description file (the folder name IS the product ID):`);
    for (const p of r.pairings) {
      const found = p.source
        ? `${p.source}  (${p.perImage} per-image description${p.perImage === 1 ? "" : "s"})`
        : `image-meta/${p.product}.json  ✖ NOT FOUND`;
      console.log(`    2-clean/${p.product}/`.padEnd(34) + `->  ${found}`);
      // Two files answering to one ID means one is a stale copy. Which one is a judgement
      // nothing here can make, so name both rather than quietly using the alphabetical winner.
      for (const other of p.ambiguous) {
        console.log(`    ⚠️  also matches ${other} — delete whichever is out of date`);
      }
    }
  }

  if (r.blocked) {
    console.error(`\n⛔ No description file for ${r.blocked.missing.length} of ${r.products.length} folder(s). Nothing was written.`);
    console.error(`\n   Either it does not exist yet — run the listing prompt (docs/guides/PROMPT.md)`);
    console.error(`   and save its section 1 — or the folder name and the file name do not match.`);
    console.error(`   They have to be identical, capitals included.\n`);
    console.error(`   Finish the images anyway, with no metadata embedded:`);
    console.error(`     npm run images -- --final --force\n`);
    process.exit(1);
  }

  // Report
  console.log("");
  let current = "";
  for (const row of r.rows) {
    if (row.product !== current) {
      current = row.product;
      console.log(`  ${current}`);
    }
    console.log(`    ${row.from.padEnd(12)} ->  ${row.to.padEnd(18)} ${row.size.padEnd(22)} ${row.square}`);
    for (const n of row.notes) {
      const flag = n.includes("SOURCE ONLY") || n.includes("MEESHO METADATA") ? "⚠️ " : "   ";
      console.log(`    ${flag}   ${n}`);
    }
  }

  if (r.failures.length > 0) {
    console.log(`\n  Problems:`);
    for (const f of r.failures) console.log(`    ✖ ${f}`);
  }

  console.log(`\n  ${r.rows.length} image(s) written to images/${r.outName}/`);
  console.log(`  Everything in images/${r.srcName}/ is untouched.\n`);
  console.log(`  CHECK BEFORE UPLOADING: open images/${r.outName}/ and confirm that, for each product,`);
  console.log(`  image 1 is the main shot and image 2 shows what is in the pack.\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});

/**
 * finish.ts — the shortcut for images that are ALREADY clean.
 *
 * When your photos need no work — a partner or the AI already made them square-ish, tag-free
 * JPEGs — you don't want the three-folder raw→clean→final pipeline in images.ts. You want the
 * one useful part: write each photo's description into its EXIF, then hand you the files under
 * a tidy flat name so they aren't buried in per-listing folders at upload time.
 *
 * That is all this does. It never crops, never resizes, never squares — the pixels your
 * partner uploaded go out untouched. (If images ever arrive with a Meesho tag, use images.ts,
 * which crops/erases; this tool assumes clean input.)
 *
 *   <in>/<Listing Folder>/1.jpg 2.png …     clean numbered images (your archive, kept as-is)
 *   image-meta/<ID>.json                     your descriptions  { "images": { "1": "…" } }
 *        |  npm run finish -- --in="<path>"
 *   ~/Downloads/wishworks-ready/<ID>.<n>.jpg  flat · description embedded · ready to upload
 *
 * The folder name becomes the ID: "ANP 1 - p" → "ANP-1", so its images come out ANP-1.1.jpg,
 * ANP-1.2.jpg. Override a single folder's ID with --id=ANP-1 if the auto-clean guesses wrong.
 *
 * --in can point at ANY level: a single listing folder, a category (ANP/), or the whole tree
 * (Whatsapp DW/ with categories inside). It walks down until it finds folders that hold numbered
 * images and finishes each — so one command can do everything.
 *
 * Run:  npm run finish -- --in="/path/to/ANP 1 - p"          one listing
 *       npm run finish -- --in="/path/to/ANP"                every listing under a category
 *       npm run finish -- --in="/path/to/Whatsapp DW"        every listing under every category
 *       npm run finish -- --in="…" --square                  also pad/crop each to 1:1
 *       npm run finish -- --in="…" --out="~/somewhere"       different flat output folder
 *       npm run finish -- --in="…" --id=ANP-1                force the ID (single folder only)
 */

import { readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  buildExif, composeDescription, descriptionsFor, duplicatePositions, meeshoResidue,
  availableMetaIds, NO_DESCRIPTIONS, type Descriptions,
} from "./image-meta.js";
import { encodeJpeg } from "./encode.js";
import { squareImage } from "./square.js";

/** Ask a question on the terminal and return the typed answer. Mirrors connect.ts's `ask`,
 *  kept local so this image tool never imports the browser module. */
function ask(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => process.stdin.once("data", (d) => resolve(String(d))));
}

/**
 * Let the operator pick which `image-meta/<ID>.json` supplies the descriptions for a folder —
 * the same "type a number" menu `npm start` uses to pick a product. The folder's own auto-ID is
 * marked as the match. Returns the chosen ID (which also becomes the output filename prefix) and
 * whether to skip descriptions entirely. Only called when the terminal is interactive.
 */
async function chooseMeta(folderName: string, auto: string): Promise<{ id: string; skip: boolean }> {
  const ids = await availableMetaIds();
  if (ids.length === 0) {
    console.log(`\n  No description files in image-meta/ yet — I'll just rename & copy (no descriptions).`);
    console.log(`  Create image-meta/${auto}.json and re-run to embed descriptions.`);
    return { id: auto, skip: true };
  }
  console.log(`\n  Which descriptions file should I use for "${folderName}"?\n`);
  ids.forEach((id, i) => {
    const mark = id.toLowerCase() === auto.toLowerCase() ? "   ← matches this folder" : "";
    console.log(`   ${String(i + 1).padStart(2)}. ${id}${mark}`);
  });
  const noneNum = ids.length + 1;
  console.log(`   ${String(noneNum).padStart(2)}. (none — just rename & copy, no descriptions)`);

  const answer = (await ask(`\n  Type a number (1-${noneNum}) and press ENTER: `)).trim();
  const pick = Number(answer);
  if (pick === noneNum) return { id: auto, skip: true };
  if (Number.isInteger(pick) && pick >= 1 && pick <= ids.length) return { id: ids[pick - 1], skip: false };
  console.log(`\n  "${answer}" isn't one of the numbers — using the folder match "${auto}".`);
  return { id: auto, skip: false };
}

/** Below this on the short side, upscaling can't recover detail — warn (we still don't touch it). */
const SOFT_BELOW = 1000;

// Same input formats images.ts accepts. Output is always JPEG — the container EXIF descriptions
// land in reliably (PNG/AVIF metadata is dropped by sharp's writer).
const INPUT_EXT = new Set([
  ".avif", ".webp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".bmp", ".heic", ".heif",
]);

type Row = { id: string; from: string; to: string; size: string; notes: string[] };

/** ~/x → /Users/you/x. Leaves absolute and relative paths alone. */
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
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
function cleanId(folderName: string): string {
  const name = folderName.trim().replace(/\s+-\s*p\s*$/i, "").trim(); // drop the "- p" pending flag
  const m = name.match(/([A-Za-z]+)\D*?(\d+)/);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || folderName;
}

/** Image files in a folder, in true numeric order (1, 2, 10 — not 1, 10, 2). */
async function numberedImages(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((f) => !f.startsWith(".") && INPUT_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => {
      const na = parseInt(path.basename(a, path.extname(a)), 10);
      const nb = parseInt(path.basename(b, path.extname(b)), 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
}

async function finishOne(
  id: string,
  srcDir: string,
  file: string,
  index: number,
  outDir: string,
  descs: Descriptions,
  square: boolean,
): Promise<Row> {
  const src = path.join(srcDir, file);
  const outName = `${id}.${index}.jpg`;
  const out = path.join(outDir, outName);
  const notes: string[] = [];

  let img = sharp(src, { failOn: "none" });
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error(`could not read dimensions (${meta.format ?? "unknown format"})`);

  const shortSide = Math.min(w, h);
  if (shortSide < SOFT_BELOW) {
    notes.push(`SOURCE ONLY ${shortSide}px — will look soft, get a larger original`);
  }

  // Metadata-only Meesho check. The output never carries source metadata (we don't copy it),
  // so this is a heads-up that the file came from Meesho — not something in the finished image.
  const residue = meeshoResidue(meta);
  if (residue) {
    notes.push(`MEESHO METADATA in source ("${residue}") — dropped from output. Check pixels for a visible tag too`);
  }

  // --square: pad-to-white / centre-crop to 1:1 (same rule as images.ts, via square.ts). Off by
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

  // Beyond the optional square above, pixels are left as they are — no resize. flatten() only
  // matters for a transparent PNG, which JPEG can't hold; it fills that transparency with white.
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
  rows: Row[],
  failures: string[],
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
      rows.push(await finishOne(id, srcDir, files[i], i + 1, outDir, descs, square));
    } catch (err) {
      failures.push(`${id}/${files[i]}: ${(err as Error).message}`);
    }
  }
}

/**
 * Walk a folder tree, finishing every listing found. A subfolder that directly holds numbered
 * images IS a listing (finished with its cleanId + matching descriptions); a subfolder that
 * holds only more folders is a container (a category) and is recursed into. So --in can be a
 * single category or the whole downloads root and it finds every listing at any depth. Returns
 * how many listing folders it finished.
 */
async function finishTree(
  dir: string,
  outDir: string,
  square: boolean,
  rows: Row[],
  failures: string[],
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
      await finishListing(id, subPath, outDir, await descriptionsFor(id), square, rows, failures);
    } else {
      listings += await finishTree(subPath, outDir, square, rows, failures);
    }
  }
  return listings;
}

async function main() {
  const inArg = process.argv.find((a) => a.startsWith("--in="));
  if (!inArg) {
    console.error(`\n✖ Tell me which folder to finish:\n`);
    console.error(`    npm run finish -- --in="/path/to/ANP 1 - p"   one listing`);
    console.error(`    npm run finish -- --in="/path/to/ANP"         every listing inside\n`);
    process.exit(1);
  }
  const inDir = expandHome(inArg.slice("--in=".length));

  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outDir = expandHome(outArg ? outArg.slice("--out=".length) : path.join(homedir(), "Downloads", "wishworks-ready"));

  const idArg = process.argv.find((a) => a.startsWith("--id="));
  const forcedId = idArg ? idArg.slice("--id=".length) : null;

  const square = process.argv.includes("--square");

  if (!(await stat(inDir).then((s) => s.isDirectory()).catch(() => false))) {
    console.error(`\n✖ Not a folder: ${inDir}\n`);
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });

  const rows: Row[] = [];
  const failures: string[] = [];

  // If --in holds images directly, it IS one listing. Otherwise treat each subfolder as one.
  const directImages = await numberedImages(inDir);
  if (directImages.length > 0) {
    const folderName = path.basename(inDir);
    const auto = cleanId(folderName);
    // Pick which descriptions file to use, the way `npm start` picks a product. Skip the menu
    // when --id is given (explicit) or the terminal isn't interactive (a pipe/test would hang).
    let id: string;
    let descs: Descriptions;
    if (forcedId) {
      id = forcedId;
      descs = await descriptionsFor(id);
    } else if (process.stdin.isTTY) {
      const chosen = await chooseMeta(folderName, auto);
      id = chosen.id;
      descs = chosen.skip ? NO_DESCRIPTIONS : await descriptionsFor(id);
    } else {
      id = auto;
      descs = await descriptionsFor(id);
    }
    console.log(`\n  Finishing one listing: ${folderName} → ${id}`);
    await finishListing(id, inDir, outDir, descs, square, rows, failures);
  } else {
    if (forcedId) {
      console.error(`\n✖ --id only works on a single listing folder, but ${inDir}`);
      console.error(`  holds subfolders. Point --in at one listing folder to use --id.\n`);
      process.exit(1);
    }
    // Batch: no per-folder menu (it would be one prompt per subfolder). finishTree walks down
    // through any category levels, auto-cleaning each listing's ID and using its matching
    // image-meta/<ID>.json if present. To pick a descriptions file, run --in on one listing.
    console.log(`\n  Finishing every listing found under ${path.basename(inDir)}:`);
    const found = await finishTree(inDir, outDir, square, rows, failures);
    if (found === 0) {
      console.error(`\n✖ No listing folders with numbered images found under ${inDir}\n`);
      process.exit(1);
    }
  }

  // Report
  console.log("");
  let current = "";
  for (const r of rows) {
    if (r.id !== current) {
      current = r.id;
      console.log(`  ${current}`);
    }
    console.log(`    ${r.from.padEnd(12)} ->  ${r.to.padEnd(18)} ${r.size}`);
    for (const n of r.notes) {
      const flag = n.includes("SOURCE ONLY") || n.includes("MEESHO METADATA") ? "⚠️ " : "   ";
      console.log(`    ${flag}   ${n}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n  Problems:`);
    for (const f of failures) console.log(`    ✖ ${f}`);
  }

  console.log(`\n  ${rows.length} image(s) written to ${outDir}`);
  console.log(`  Your source folders were not touched.\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});

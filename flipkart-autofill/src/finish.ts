/**
 * finish.ts — the shortcut for images that are ALREADY clean.
 *
 * This file is the COMMAND LINE only: flags, the "which descriptions?" menu, and the report.
 * The work is in finish-core.ts (`runFinish`) so the Electron app can call it too (WW-066).
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
 *       npm run finish -- --in="…" --square --border=20      inset in a 20px white frame
 *       npm run finish -- --in="…" --out="~/somewhere"       different flat output folder
 *       npm run finish -- --in="…" --id=ANP-1                force the ID (single folder only)
 *
 * --border is EXPERIMENTAL and off by default: the seller believes a ~20px frame lowers
 * Meesho's shipping estimate, which is untested. See docs/guides/SHIPPING-COST.md.
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { availableMetaIds } from "./image-meta.js";
import { findById, normalizeId } from "./id.js";
import { META_DIR, showPath } from "./paths.js";
import { cleanId, numberedImages, runFinish } from "./finish-core.js";

/** Ask a question on the terminal and return the typed answer. Mirrors connect.ts's `ask`,
 *  kept local so this image tool never imports the browser module. */
function ask(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) =>
    process.stdin.once("data", (d) => {
      // Attaching a "data" listener puts stdin in flowing mode and KEEPS IT THERE, so node
      // never sees an empty event loop and the command hangs after printing its report —
      // you had to Ctrl+C a run that had already finished. Pausing hands the prompt back;
      // the next ask() resumes it automatically by attaching its own listener.
      process.stdin.pause();
      resolve(String(d));
    }),
  );
}

/**
 * Let the operator pick which `image-meta/<ID>.json` supplies the descriptions for a folder —
 * the same "type a number" menu `npm start` uses to pick a product. The folder's own auto-ID is
 * marked as the match. Returns the chosen ID and whether to skip descriptions entirely. It never
 * renames anything (WW-078). Only called when the terminal is interactive.
 */
async function chooseMeta(auto: string): Promise<{ id: string; skip: boolean }> {
  const ids = await availableMetaIds();
  if (ids.length === 0) {
    console.log(`\n  No description files in image-meta/ yet — I'll just rename & copy (no descriptions).`);
    console.log(`  Create image-meta/${auto}.json and re-run to embed descriptions.`);
    return { id: auto, skip: true };
  }
  // Compare on the normalised ID, never on the raw name: "image-meta-GTB002" IS "GTB-2", and
  // calling it "a DIFFERENT product" is how you get talked into picking the wrong one.
  const want = normalizeId(auto);
  const match = ids.some((id) => normalizeId(id) === want);
  console.log(`\n  These photos will be named ${auto}.1.jpg, ${auto}.2.jpg …`);
  console.log(`  Which descriptions should go INSIDE them? (this does not rename anything)\n`);
  ids.forEach((id, i) => {
    const mark = normalizeId(id) === want
      ? "   ← matches these photos, pick this"
      : "   ⚠️  a DIFFERENT product";
    console.log(`   ${String(i + 1).padStart(2)}. ${id}${mark}`);
  });
  const noneNum = ids.length + 1;
  console.log(`   ${String(noneNum).padStart(2)}. (none — just rename & copy, no descriptions)`);
  if (!match) {
    console.log(`\n  There is no image-meta/${auto}.json yet, so nothing here matches these photos.`);
    console.log(`  Unless you know better, pick ${noneNum} — then run the listing prompt, save`);
    console.log(`  image-meta/${auto}.json, and run this again to embed the real descriptions.`);
  }

  const answer = (await ask(`\n  Type a number (1-${noneNum}) and press ENTER: `)).trim();
  const pick = Number(answer);
  if (pick === noneNum) return { id: auto, skip: true };
  if (Number.isInteger(pick) && pick >= 1 && pick <= ids.length) return { id: ids[pick - 1], skip: false };
  console.log(`\n  "${answer}" isn't one of the numbers — using the folder match "${auto}".`);
  return { id: auto, skip: false };
}

/**
 * Where this listing's descriptions come from, decided BEFORE anything is written. Returns the
 * `metaId` to hand `runFinish`, or null to let it resolve the folder's own ID.
 *
 * The menu only appears when NOTHING matched. Two files answering to the same ID is not a
 * question either — they are the same product under two names (`ANP003.json` next to
 * `image-meta-ANP003.json`), so findById takes the newest and we just say which is ignored.
 * Asking anyway is what let WW-078 happen: an operator picking from a list of things all
 * marked "a DIFFERENT product".
 */
async function resolveMeta(auto: string): Promise<string | "none" | null> {
  const match = await findById(META_DIR, auto);

  if (match) {
    console.log(`\n  Descriptions: ${showPath(match.file)}  ← matches these photos`);
    for (const f of match.others) console.log(`       (ignoring older copy: ${showPath(f)})`);
    return null; // runFinish finds the same file by the same rule
  }

  if (!process.stdin.isTTY) return null; // a pipe or a test would hang on the menu
  const chosen = await chooseMeta(auto);
  if (chosen.skip) return "none";
  if (normalizeId(chosen.id) !== normalizeId(auto)) {
    console.log(`\n  ⚠️  These photos are "${auto}" but you picked descriptions from "${chosen.id}".`);
    console.log(`      The files stay named ${auto}.1.jpg … — only the descriptions come from`);
    console.log(`      ${chosen.id}. If that is not what you meant, press Ctrl+C now.`);
  }
  return chosen.id;
}

/** ~/x → /Users/you/x. Leaves absolute and relative paths alone. */
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
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

  // Opt-in white frame around the picture. The seller's claim is that it lowers Meesho's
  // shipping estimate; that is untested, so it stays a flag. See docs/guides/SHIPPING-COST.md.
  const borderArg = process.argv.find((a) => a.startsWith("--border="));
  const border = borderArg ? parseInt(borderArg.slice("--border=".length), 10) : 0;
  if (borderArg && (!Number.isFinite(border) || border < 1)) {
    console.error(`\n✖ --border needs a positive pixel width, e.g. --border=20\n`);
    process.exit(1);
  }

  if (!(await stat(inDir).then((s) => s.isDirectory()).catch(() => false))) {
    console.error(`\n✖ Not a folder: ${inDir}\n`);
    process.exit(1);
  }

  // Single listing or a tree? runFinish decides the same way, but the CLI needs to know first:
  // the menu below and the two headers only make sense for one of the two shapes.
  const single = (await numberedImages(inDir)).length > 0;

  let metaId: string | "none" | null = null;
  if (single) {
    const auto = forcedId || cleanId(path.basename(inDir));
    // --id is the operator being explicit about both name and descriptions; don't second-guess it.
    if (!forcedId) metaId = await resolveMeta(auto);
    console.log(`\n  Finishing one listing: ${path.basename(inDir)} → ${auto}`);
  } else {
    if (forcedId) {
      console.error(`\n✖ --id only works on a single listing folder, but ${inDir}`);
      console.error(`  holds subfolders. Point --in at one listing folder to use --id.\n`);
      process.exit(1);
    }
    // No per-folder menu in batch mode — it would be one prompt per subfolder. To pick a
    // descriptions file, run --in on one listing.
    console.log(`\n  Finishing every listing found under ${path.basename(inDir)}:`);
  }

  const r = await runFinish({ inDir, outDir, id: forcedId, metaId, square, border });

  if (r.mode === "tree" && r.listings === 0) {
    console.error(`\n✖ No listing folders with numbered images found under ${inDir}\n`);
    process.exit(1);
  }

  // Report
  console.log("");
  let current = "";
  for (const row of r.rows) {
    if (row.id !== current) {
      current = row.id;
      console.log(`  ${current}`);
    }
    console.log(`    ${row.from.padEnd(12)} ->  ${row.to.padEnd(18)} ${row.size}`);
    for (const n of row.notes) {
      // Nothing in finish blocks, so this marker is the only signal these notes get.
      const flag = /^(SMALL|NOT SQUARE|MEESHO METADATA)/.test(n) ? "⚠️ " : "   ";
      console.log(`    ${flag}   ${n}`);
    }
  }

  if (r.failures.length > 0) {
    console.log(`\n  Problems:`);
    for (const f of r.failures) console.log(`    ✖ ${f}`);
  }

  console.log(`\n  ${r.rows.length} image(s) written to ${outDir}`);
  console.log(`  Your source folders were not touched.\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});

/**
 * check.ts — read the description back out of finished images, to confirm the ingestion worked.
 *
 * Finder "Get Info" and Preview do NOT show EXIF ImageDescription on macOS, so there is no way
 * to eyeball it. This prints, for every JPEG in a folder, whether a description was embedded and
 * what it says — the answer to "did the metadata actually land?".
 *
 * Run:  npm run check                     reads ~/Downloads/wishworks-ready (the finish output)
 *       npm run check -- --in="<folder>"  read a different folder
 *       npm run check -- --in="<file.jpg>" read a single file
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const TAGS: Record<number, string> = { 270: "Description", 305: "Software", 315: "Artist" };

/** ~/x → /Users/you/x. */
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
}

/**
 * Pull the ASCII EXIF fields (ImageDescription/Software/Artist) out of sharp's raw EXIF buffer
 * by walking IFD0 directly — no extra dependency. Returns {} if there's no readable EXIF.
 */
function readExifAscii(exif: Buffer): Record<string, string> {
  let buf = exif;
  if (buf.length >= 6 && buf.slice(0, 4).toString("latin1") === "Exif") buf = buf.subarray(6); // strip "Exif\0\0"
  if (buf.length < 8) return {};
  const le = buf.slice(0, 2).toString("latin1") === "II";
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const out: Record<string, string> = {};
  try {
    const ifd0 = u32(4);
    const count = u16(ifd0);
    for (let i = 0; i < count; i++) {
      const e = ifd0 + 2 + i * 12;
      const tag = u16(e);
      if (!TAGS[tag] || u16(e + 2) !== 2) continue; // type 2 = ASCII
      const num = u32(e + 4);
      const valOff = num > 4 ? u32(e + 8) : e + 8;
      if (valOff + num > buf.length) continue;
      out[TAGS[tag]] = buf.subarray(valOff, valOff + Math.max(0, num - 1)).toString("latin1").trim();
    }
  } catch {
    /* malformed EXIF — return whatever we got */
  }
  return out;
}

async function checkFile(file: string): Promise<void> {
  const name = path.basename(file);
  try {
    const meta = await sharp(file).metadata();
    const fields = meta.exif ? readExifAscii(meta.exif) : {};
    const desc = fields.Description;
    if (desc) {
      console.log(`  ✅ ${name.padEnd(16)} ${desc.slice(0, 100)}${desc.length > 100 ? "…" : ""}`);
    } else {
      console.log(`  ✖  ${name.padEnd(16)} NO description embedded`);
    }
  } catch (err) {
    console.log(`  ⚠️  ${name.padEnd(16)} could not read (${(err as Error).message})`);
  }
}

async function main() {
  const inArg = process.argv.find((a) => a.startsWith("--in="));
  const target = expandHome(inArg ? inArg.slice("--in=".length) : path.join(homedir(), "Downloads", "wishworks-ready"));

  const info = await stat(target).catch(() => null);
  if (!info) {
    console.error(`\n✖ Not found: ${target}\n`);
    process.exit(1);
  }

  console.log(`\n  Checking ${target}\n`);

  if (info.isFile()) {
    await checkFile(target);
  } else {
    const files = (await readdir(target))
      .filter((f) => !f.startsWith(".") && /\.jpe?g$/i.test(f))
      .sort();
    if (files.length === 0) {
      console.log(`  (no JPEGs here)`);
    }
    for (const f of files) await checkFile(path.join(target, f));
  }
  console.log(`\n  ✅ = description embedded   ✖ = none (make image-meta/<ID>.json and re-run finish)\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});

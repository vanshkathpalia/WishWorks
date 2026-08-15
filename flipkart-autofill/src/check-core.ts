/**
 * check-core.ts — read the description back out of finished images, as a plain function.
 *
 * Options in, structured result out, nothing printed and nothing exited. `check.ts` is the CLI
 * that prints this; the app renders the same rows.
 *
 * This step exists because Finder "Get Info" and Preview do NOT show EXIF ImageDescription on
 * macOS, so there is no way to eyeball whether the ingestion worked. Without it, "the metadata
 * landed" is an assumption, and an assumption is what WW-096 turned out to be — a step that had
 * never once been run.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const TAGS: Record<number, string> = { 270: "Description", 305: "Software", 315: "Artist" };

export interface CheckRow {
  file: string;
  /** The embedded description, or null when there is none. */
  description: string | null;
  /** Set when the file could not be read at all. */
  error?: string;
}

export interface CheckResult {
  target: string;
  rows: CheckRow[];
  /** How many carry a description. `rows.length - withDescription` is what needs re-finishing. */
  withDescription: number;
}

/** Thrown when the folder or file does not exist — the only condition that stops the run. */
export class CheckNotFound extends Error {
  constructor(readonly target: string) {
    super(`Not found: ${target}`);
  }
}

/**
 * Pull the ASCII EXIF fields (ImageDescription/Software/Artist) out of sharp's raw EXIF buffer by
 * walking IFD0 directly — no extra dependency. Returns {} if there's no readable EXIF.
 */
export function readExifAscii(exif: Buffer): Record<string, string> {
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

async function checkFile(file: string, name = path.basename(file)): Promise<CheckRow> {
  try {
    const meta = await sharp(file).metadata();
    const fields = meta.exif ? readExifAscii(meta.exif) : {};
    return { file: name, description: fields.Description || null };
  } catch (err) {
    return { file: name, description: null, error: (err as Error).message };
  }
}

/**
 * Read every JPEG under `target` (or the one file) and report what is embedded.
 *
 * **Recursive, because the ready folder has subfolders now.** `finishListing` files each listing
 * under the letters its ID starts with (`skuGroup`), so a flat read of the ready root finds zero
 * JPEGs — and "0 images" here is indistinguishable from "the finish step wrote nothing", which is
 * the worst answer this tool can give. Rows keep the path relative to `target`, so the row still
 * says which group the file is in.
 */
export async function runCheck(target: string): Promise<CheckResult> {
  const info = await stat(target).catch(() => null);
  if (!info) throw new CheckNotFound(target);

  const rows: CheckRow[] = info.isFile()
    ? [await checkFile(target)]
    : await Promise.all(
        (await readdir(target, { recursive: true }))
          .filter((f) => !path.basename(f).startsWith(".") && /\.jpe?g$/i.test(f))
          .sort()
          .map((f) => checkFile(path.join(target, f), f)),
      );

  return { target, rows, withDescription: rows.filter((r) => r.description).length };
}

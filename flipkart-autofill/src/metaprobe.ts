/**
 * metaprobe.ts — does Meesho's shipping estimator read image METADATA at all?
 *
 * Nine image-content variants (WW-056) found no steerable rule for Meesho's "Shipping (added
 * separately)" fee. Metadata is the one axis never tested, and it has something the content tests
 * could never have: a perfect control. Every file this emits carries BYTE-IDENTICAL PIXEL DATA —
 * decoded to raw once, then re-encoded through the same pipeline — so the ONLY difference between
 * M0 and M4 is the metadata block. If the fee moves, metadata is read. If it doesn't, it isn't,
 * and the question is closed for good.
 *
 * Usage:
 *   npm run metaprobe -- --in=photo/1.png [--out=photo/meta-test] [--weight=350] [--size=30x24x4]
 *
 * The variants:
 *   M0  no metadata at all (stripped baseline)
 *   M1  our normal pipeline EXIF — what `finish`/`images --final` writes today
 *   M2  high print density (300 DPI vs 72) — probes a naive pixels÷DPI physical-size estimate
 *   M3  camera scale hints (SubjectDistance + FocalLength) — probes monocular size estimation
 *   M4  truthful pack facts in the description text (real weight + real flat-pack dimensions)
 *
 * Only M4 makes any factual claim, and it must be TRUE — pass your real measured --weight and
 * --size. Do not invent smaller numbers: the courier weighs the parcel at pickup and Meesho
 * charges back the difference at settlement, so a false claim costs money instead of saving it.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BRAND } from "./image-meta.js";

type Variant = {
  id: string;
  what: string;
  /** M0 only: emit no metadata block at all. sharp strips by default, so we just skip withMetadata. */
  strip?: boolean;
  density: number;
  exif: Record<string, Record<string, string>>;
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** EXIF rationals are written as "numerator/denominator" strings. */
const rational = (n: number, d = 1) => `${n}/${d}`;

function variants(weight: string | undefined, size: string | undefined): Variant[] {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/-/g, ":");
  const base = {
    Artist: BRAND,
    Copyright: `(c) ${new Date().getUTCFullYear()} ${BRAND}. All rights reserved.`,
    Software: `${BRAND} Listing Factory`,
    DateTime: stamp,
  };
  const normal = "Annaprashan decoration kit set up as a wall backdrop with red and gold balloons, banner and printed cutouts.";

  // M4 states real, measured facts. Falls back to a neutral phrasing if not supplied.
  const facts =
    weight && size
      ? `${normal} Ships flat as a single slim packet, ${size} cm, ${weight} g packed. Lightweight party decoration, balloons supplied uninflated.`
      : `${normal} Ships flat as a single slim packet. Lightweight party decoration, balloons supplied uninflated.`;

  return [
    { id: "M0", what: "stripped — no metadata at all", strip: true, density: 72, exif: {} },
    { id: "M1", what: "current pipeline EXIF", density: 72, exif: { IFD0: { ImageDescription: normal, ...base } } },
    { id: "M2", what: "300 DPI print density", density: 300, exif: { IFD0: { ImageDescription: normal, ...base } } },
    {
      id: "M3",
      what: "camera scale hints (SubjectDistance 0.6m, FocalLength 50mm)",
      density: 72,
      exif: {
        IFD0: { ImageDescription: normal, ...base },
        // Capture-condition tags live in the Exif sub-IFD, which libvips (and therefore sharp)
        // addresses as IFD2 — NOT "ExifIFD". Naming it wrong makes sharp silently drop the whole
        // block, leaving this variant byte-identical to M1 and the probe meaningless. Verified by
        // comparing the written EXIF buffers.
        IFD2: {
          SubjectDistance: rational(6, 10),
          SubjectDistanceRange: "1", // 1 = macro / close view
          FocalLength: rational(50),
          FocalLengthIn35mmFormat: "50",
        },
      },
    },
    { id: "M4", what: "truthful pack facts in the description", density: 72, exif: { IFD0: { ImageDescription: facts, ...base } } },
  ];
}

async function main() {
  const input = arg("in");
  if (!input) {
    console.error("Usage: npm run metaprobe -- --in=photo/1.png [--out=DIR] [--weight=350] [--size=30x24x4]");
    process.exitCode = 1;
    return;
  }
  const outDir = arg("out") ?? path.join(path.dirname(input), "meta-test");
  const list = variants(arg("weight"), arg("size"));

  // Decode ONCE to raw pixels. Every variant re-encodes these exact bytes, so the images are
  // pixel-identical by construction and metadata is the only variable in the experiment.
  const src = sharp(input);
  const { width, height } = await src.metadata();
  const raw = await src.clone().removeAlpha().raw().toBuffer();
  if (!width || !height) throw new Error(`could not read dimensions from ${input}`);

  await mkdir(outDir, { recursive: true });

  for (const v of list) {
    let pipe = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
    // withMetadata() writes a small EXIF block even with nothing to say, so M0 must skip it
    // entirely to be a genuine "no metadata" baseline.
    if (!v.strip) pipe = pipe.withMetadata({ density: v.density });
    if (Object.keys(v.exif).length) pipe = pipe.withExif(v.exif as never);
    await pipe.toFile(path.join(outDir, `${v.id}.jpg`));
    console.log(`  ${v.id}.jpg  ${v.what}`);
  }

  // A log sheet to fill in as the fees come back — the whole point is the comparison.
  const sheet = [
    "# Metadata probe — does Meesho read image metadata?",
    "",
    `Source: ${input}  ·  ${width}x${height}  ·  generated ${new Date().toISOString().slice(0, 10)}`,
    "",
    "All five files are PIXEL-IDENTICAL. Metadata is the only difference.",
    "Upload each as the main image, note the shipping fee, fill in the table.",
    "",
    "| File | What differs | Shipping fee |",
    "|---|---|---|",
    ...list.map((v) => `| ${v.id}.jpg | ${v.what} | |`),
    "",
    "## Reading it",
    "",
    "- **All five identical** → metadata is not read. Question closed for good; delete this folder.",
    "- **M0 differs from M1** → metadata is read at all. Big finding.",
    "- **M2 differs** → a naive pixels/DPI physical-size estimate is in play.",
    "- **M3 differs** → camera scale hints feed the estimate.",
    "- **M4 differs** → the description TEXT is parsed. Best case: truthful pack facts lower it.",
    "",
    "Anything that only moves by a rupee or two is noise — re-upload the same file twice to see",
    "how much the number wobbles on its own before believing a small difference.",
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "RESULTS.md"), sheet);

  const made = (await readdir(outDir)).filter((f) => f.endsWith(".jpg")).length;
  console.log(`\n${made} pixel-identical variants + RESULTS.md → ${outDir}`);
  console.log("Upload each as the main image, note the fee, fill in RESULTS.md.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

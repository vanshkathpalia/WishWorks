/**
 * encode.ts — write a sharp pipeline out as a JPEG that is guaranteed to fit the marketplace
 * upload cap. ONE copy of the rule, shared by both image tools.
 *
 * images.ts always resizes to 1500x1500 first, so it never realistically hits the cap; finish.ts
 * does NOT resize — it hands your pixels through untouched — so a large source at quality 95 can
 * genuinely exceed Meesho's 5MB limit and be rejected at upload with no clue why. Same guard for
 * both: step the quality down until it fits, and say so.
 */

import type { Sharp } from "sharp";

/** Meesho's hard cap on an uploaded image. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** Below this the image starts to look visibly bad — better to report a failure than ship mush. */
const MIN_QUALITY = 60;

export interface Encoded {
  buf: Buffer;
  /** The quality actually used — lower than `startQuality` if the file had to be shrunk. */
  quality: number;
  /** One line per step-down, ready to show the operator. Empty when the first try fit. */
  notes: string[];
}

/**
 * Encode as JPEG at `startQuality`, stepping down by 10 until the result is under the cap.
 * 4:4:4 chroma throughout — party decorations are saturated reds and golds, and the default
 * 4:2:0 subsampling smears exactly those edges.
 */
export async function encodeJpeg(pipe: Sharp, startQuality: number): Promise<Encoded> {
  const notes: string[] = [];
  let quality = startQuality;
  let buf = await pipe.jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();

  while (buf.length > MAX_BYTES && quality > MIN_QUALITY) {
    quality -= 10;
    buf = await pipe.jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();
    notes.push(`re-encoded at quality ${quality} to fit under 5MB`);
  }

  if (buf.length > MAX_BYTES) {
    notes.push(
      `STILL ${(buf.length / 1024 / 1024).toFixed(1)}MB at quality ${quality} — over Meesho's 5MB cap. ` +
        `Shrink the source before uploading.`,
    );
  }

  return { buf, quality, notes };
}

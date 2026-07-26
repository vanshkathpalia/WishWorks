/**
 * square.ts — make an image 1:1. ONE copy of the rule, shared by both image tools:
 *   - images.ts   always squares (the raw→final pipeline guarantees the spec)
 *   - finish.ts   only when --square is passed (it otherwise leaves pixels untouched)
 *
 * The rule: pad with white when the edges are white (the bars are invisible), centre-crop when
 * they aren't (white bars would be glaring on a coloured background). Kept in its own module so
 * finish.ts can reuse it without importing images.ts — importing that CLI would run its main().
 */

import sharp, { type Sharp, type Region } from "sharp";

/** Mean channel value above which an edge counts as "white background". */
const WHITE_THRESHOLD = 235;

/** Mean brightness of a thin strip at each edge, used to decide pad-vs-crop. */
export async function edgesAreWhite(img: Sharp, w: number, h: number): Promise<boolean> {
  const edge = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const regions: Region[] = [
    { left: 0, top: 0, width: w, height: edge },
    { left: 0, top: h - edge, width: w, height: edge },
    { left: 0, top: 0, width: edge, height: h },
    { left: w - edge, top: 0, width: edge, height: h },
  ];

  for (const region of regions) {
    // sharp's .stats() reads the INPUT image and ignores queued ops, so the strip has to
    // be rendered to a buffer first — otherwise every edge test measures the whole image.
    const strip = await img.clone().extract(region).toBuffer();
    const stats = await sharp(strip).stats();
    const rgb = stats.channels.slice(0, 3);
    const mean = rgb.reduce((sum, c) => sum + c.mean, 0) / rgb.length;
    if (mean < WHITE_THRESHOLD) return false;
  }
  return true;
}

export type SquareMethod = "already square" | "padded white" | "centre-cropped";

/**
 * Return the image as a rendered 1:1 square (or unchanged if already square), plus which method
 * was used. The result is rendered to a buffer and re-opened because sharp runs resize BEFORE
 * extend internally — a queued pad would otherwise land on top of a later resize and the output
 * would not be square.
 */
export async function squareImage(
  img: Sharp,
  w: number,
  h: number,
): Promise<{ img: Sharp; method: SquareMethod }> {
  if (w === h) return { img, method: "already square" };

  if (await edgesAreWhite(img, w, h)) {
    const side = Math.max(w, h);
    const padded = img.extend({
      top: Math.floor((side - h) / 2),
      bottom: Math.ceil((side - h) / 2),
      left: Math.floor((side - w) / 2),
      right: Math.ceil((side - w) / 2),
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
    return { img: sharp(await padded.toBuffer(), { failOn: "none" }), method: "padded white" };
  }

  const side = Math.min(w, h);
  const cropped = img.extract({
    left: Math.floor((w - side) / 2),
    top: Math.floor((h - side) / 2),
    width: side,
    height: side,
  });
  return { img: sharp(await cropped.toBuffer(), { failOn: "none" }), method: "centre-cropped" };
}

/**
 * Inset the image inside a plain white frame of `px` on every side, keeping the OUTER
 * dimensions at `side`x`side`. The picture is scaled down to fit, so nothing is cropped.
 *
 * Why this exists: the seller's observation is that a ~20px border on the main image lowers
 * Meesho's shipping estimate. That is UNPROVEN — see docs/guides/SHIPPING-COST.md — so this
 * is opt-in (`--border=20`) and off by default. It is here so the claim can actually be
 * tested, and the estimator is deterministic enough that a clean test will settle it.
 *
 * Rendered to a buffer and re-opened for the same reason squareImage does it: sharp runs
 * resize before extend internally, so a queued pad would otherwise land in the wrong order.
 */
export async function addBorder(img: Sharp, side: number, px: number): Promise<Sharp> {
  const inner = side - px * 2;
  if (inner < 1) throw new Error(`--border=${px} leaves no room inside a ${side}px image`);
  const framed = img.resize(inner, inner, { fit: "fill" }).extend({
    top: px,
    bottom: px,
    left: px,
    right: px,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });
  return sharp(await framed.toBuffer(), { failOn: "none" });
}

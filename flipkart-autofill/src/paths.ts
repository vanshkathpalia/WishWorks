/**
 * paths.ts — where this tool's data folders live. ONE answer, used by every module.
 *
 * They used to be resolved two different ways: images.ts/image-meta.ts computed a ROOT from
 * import.meta.url, while listing.ts and scan.ts used bare relative strings ("products",
 * "categories") that only resolve when the process is started from this folder. So
 * `npm start` worked and the same functions called from anywhere else silently saw NOTHING —
 * listProducts() returns [] from any other directory, which reads as "no products" rather
 * than "wrong folder". That also blocks packaging: inside a double-clickable app the working
 * directory is "/", never the project.
 *
 * Resolving from this file's own location fixes both, and the WW_*_DIR overrides (which the
 * test suite already relied on) keep working — they are now the supported way to point the
 * tool at a different workspace.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** The flipkart-autofill folder itself, wherever it has been copied to. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Raw → clean → final image pipeline (images.ts). */
export const IMAGES_DIR = process.env.WW_IMAGES_DIR ?? path.join(ROOT, "images");

/** Per-image descriptions, marketplace-agnostic — all a Meesho listing needs. */
export const META_DIR = process.env.WW_META_DIR ?? path.join(ROOT, "image-meta");

/** Flipkart's 66-field product files. */
export const PRODUCTS_DIR = process.env.WW_PRODUCTS_DIR ?? path.join(ROOT, "products");

/** Category defaults merged into every product of that category. */
export const CATEGORIES_DIR = process.env.WW_CATEGORIES_DIR ?? path.join(ROOT, "categories");

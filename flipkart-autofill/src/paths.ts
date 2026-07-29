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

import { existsSync } from "node:fs";
import { homedir } from "node:os";
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

/**
 * The OS per-user data directory — the same place Electron's `app.getPath("userData")` returns,
 * computed by hand so the CLI and the packaged app agree on one location.
 */
export function userDataDir(platform: NodeJS.Platform = process.platform): string {
  const home = homedir();
  if (platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "WishWorks");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "WishWorks");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "WishWorks");
}

/**
 * Chrome's persistent profile — the live Flipkart seller session.
 *
 * It used to sit at `<project>/profile`, which **cannot work in a packaged app**: that folder is
 * read-only, and Chrome silently comes up with no session rather than failing loudly — the exact
 * symptom of WW-061, indistinguishable from "it logged me out". So it belongs in the OS user-data
 * directory, which is writable on every platform and survives reinstalling the app.
 *
 * **A legacy `<project>/profile` still wins if it exists.** Moving the path would otherwise throw
 * away a working login and force an OTP for no reason. New machines get the right location; this
 * one keeps its session until someone deletes that folder.
 */
export const PROFILE_DIR =
  process.env.WW_PROFILE_DIR ??
  (existsSync(path.join(ROOT, "profile")) ? path.join(ROOT, "profile") : path.join(userDataDir(), "profile"));

/**
 * A path as it should be SHOWN: short and relative when it is inside the project, absolute
 * otherwise. `path.relative` alone produces `../../../../../../var/folders/…` the moment a
 * WW_*_DIR points somewhere else — which is the normal case in a packaged app, and unreadable
 * in exactly the messages ("this folder -> this description file") whose whole job is to let
 * you check the tool picked the right file.
 */
export function showPath(file: string): string {
  const rel = path.relative(ROOT, file);
  return rel.startsWith("..") ? file : rel;
}

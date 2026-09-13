/**
 * ready-core.ts — keep `wishworks-ready/` in one shape, so the image automation has one rule.
 *
 * **The shape, taken from the folders that are already right** (`wishworks-ready/ANP/`):
 *
 *   `<THEME>/<THEME>-<n>-<slug>-<index>.jpg`  — theme folder, flat inside, number in the filename
 *
 * Two things break it, both seen on Vansh's disk on 2026-09-13:
 *
 *  - **Files left at the root.** `HBD-01.1.jpg` … `HBD-01.4.jpg` carry their theme in the name and
 *    simply never got filed; `02.1.jpg` … `02.5.jpg` carry no theme at all. The first kind can be
 *    placed with certainty. **The second kind cannot, and this file never guesses at one** — they
 *    go to `_needs-a-home/`, which is out of the way without being a decision.
 *  - **The hierarchy disagreeing with itself.** `Whatsapp DW/HBD-T/` holds `dore`, `jungle`,
 *    `peppa`, `space`…; in `wishworks-ready/` those same themes had been promoted to the top level.
 *    Vansh, 2026-09-13: *"the HBD-T ones should have a parent folder."*
 *
 * **Nothing here moves a file.** `planTidy` returns what it WOULD do and why; applying is a separate
 * step with a human between them. That is not ceremony — a bulk move of somebody's product photos
 * is not undoable by pressing Ctrl+Z, and a rule that is subtly wrong is worth seeing as a list
 * before it is a filesystem.
 */

import path from "node:path";

export interface Move {
  /** Path relative to the root, as it is now. */
  from: string;
  /** Path relative to the root, as it would be. */
  to: string;
  /** In words, for the list a human reads before agreeing to any of it. */
  why: string;
}

export interface TidyPlan {
  moves: Move[];
  /** Files nothing can place, and the reason. They are moved out of the way, never renamed. */
  stuck: { file: string; why: string }[];
  /** Destinations already occupied — skipped, because a tidy-up must not overwrite a photo. */
  clashes: Move[];
}

/**
 * The theme a filename declares, or null when it declares none.
 *
 * The leading run of letters before the first separator: `HBD-01.1.jpg` is `HBD`,
 * `ANP-12-annaprasan-…-1.jpg` is `ANP`. `02.1.jpg` has no letters to lead with and is null —
 * which is the honest answer and the whole reason `_needs-a-home/` exists.
 */
export function themeOf(file: string): string | null {
  const m = /^([A-Za-z]+)(?:[-_ .]|$)/.exec(path.basename(file));
  return m ? m[1].toUpperCase() : null;
}

/** Where files with no theme are parked. Out of the root, out of the way, and not a decision. */
export const LIMBO = "_needs-a-home";

/**
 * What tidying this folder would do.
 *
 * `subThemes` maps a parent to the themes that belong under it — `{ "HBD-T": ["DORE", "JUNGLE", …] }`
 * — and is passed in rather than guessed, because which themes are variants of which is a fact
 * about the business, not about the filenames.
 */
export function planTidy(input: {
  /** Loose files at the root, basenames only. */
  looseFiles: string[];
  /** Top-level folder names. */
  folders: string[];
  /** Parent theme -> the themes that belong under it. Compared case-insensitively. */
  subThemes?: Record<string, string[]>;
  /** Files already inside each top-level folder, so a clash can be spotted without touching disk. */
  existing?: Record<string, string[]>;
}): TidyPlan {
  const { looseFiles, folders, subThemes = {}, existing = {} } = input;
  const moves: Move[] = [];
  const stuck: { file: string; why: string }[] = [];
  const clashes: Move[] = [];

  // Where a theme's folder actually is, allowing for it already living under a parent.
  const parentOf = new Map<string, string>();
  for (const [parent, children] of Object.entries(subThemes)) {
    for (const c of children) parentOf.set(c.toUpperCase(), parent);
  }
  const folderFor = (theme: string) => {
    const parent = parentOf.get(theme.toUpperCase());
    const real = folders.find((f) => f.toUpperCase() === theme.toUpperCase()) ?? theme.toUpperCase();
    return parent ? `${parent}/${real}` : real;
  };

  for (const file of looseFiles) {
    const theme = themeOf(file);
    if (!theme) {
      stuck.push({ file, why: "no theme in the name — nothing can place it without being told" });
      moves.push({ from: file, to: `${LIMBO}/${file}`, why: "out of the root until somebody names its theme" });
      continue;
    }
    const dest = folderFor(theme);
    const move = { from: file, to: `${dest}/${file}`, why: `its name says ${theme}` };
    // Never overwrite a photo. A clash is reported and skipped, not resolved by renaming.
    if ((existing[dest] ?? []).includes(file)) clashes.push(move);
    else moves.push(move);
  }

  // Folders that are a variant of another theme and are sitting at the top level.
  for (const folder of folders) {
    const parent = parentOf.get(folder.toUpperCase());
    if (!parent || folder === parent) continue;
    if (folders.some((f) => f === parent && folder.startsWith(`${parent}/`))) continue;
    moves.push({
      from: folder,
      to: `${parent}/${folder}`,
      why: `${folder} is a ${parent} theme, and the other folder already files it that way`,
    });
  }

  return { moves, stuck, clashes };
}

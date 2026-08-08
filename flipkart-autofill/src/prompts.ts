/**
 * prompts.ts — read, edit and version the AI prompt files.
 *
 * The prompts are the product. They get tuned constantly (WW-070, WW-072, WW-082, WW-095, WW-096
 * were all prompt edits), and every one of those was a change somebody made blind — edit the
 * file, hope, find out on the next listing. Keeping the previous version with a date makes
 * "the copy got worse after Tuesday" answerable instead of a feeling.
 *
 * **Editing is a development-only thing, and that is the fix for a real trap.** In development the
 * repo file is the source of truth — CLAUDE.md is explicit that each prompt lives in its own file
 * and is edited there — so saving writes straight back to `docs/guides/`, where git can see it and
 * a release carries it to everyone.
 *
 * Inside a packaged app the prompts are **read-only**. They used to be editable, landing in
 * `userData/prompts/` and winning over the shipped copy **for ever after**: every later fix was
 * then silently ignored on that machine, for that file, with nothing on screen to say so — and the
 * person it would happen to is the one who cannot read a diff to find out why the copy got worse.
 * The prompts ship with the app because they ARE the app, so changing one is a release.
 *
 * An override left by an older build is **ignored, not obeyed** — honouring it would keep the bug
 * alive on exactly the machines that already have one — and named on screen, because silently
 * dropping someone's edit is its own surprise. History still lives in `userData`; it is
 * per-machine working state and has no business in the repo.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PromptVersion {
  /** ISO timestamp, also the filename. */
  saved: string;
  file: string;
  /** How long the prompt was at that point — enough to see a big cut at a glance. */
  length: number;
}

export interface PromptFile {
  name: string;
  text: string;
  /** True when this machine has an edited copy overriding the shipped one. */
  edited: boolean;
  /** Where a save would land, shown so it is never a mystery. Null when editing is off. */
  savesTo: string | null;
  /**
   * True in a packaged app: the prompts are read-only there, and this is deliberate.
   *
   * A prompt edited inside a package used to land in `userData/prompts/` and win over the shipped
   * copy **from then on, for ever**. Every later fix Vansh released was then silently ignored on
   * that machine, for that file, with nothing on screen to say so — and the person it would happen
   * to is the one who cannot read a diff to find out. The prompts ship with the app because they
   * ARE the app; changing one is a release, not a local setting.
   */
  readOnly: boolean;
  /**
   * An override file left on this machine by a version that allowed editing. It is NO LONGER
   * READ — `text` above is the shipped copy — but saying nothing would be its own silent
   * surprise, so the screen names it.
   */
  ignoredOverride: string | null;
  versions: PromptVersion[];
}

export interface PromptDirs {
  /** Where the prompts ship — `docs/guides/`. */
  shipped: string;
  /** Writable per-machine root, normally Electron's `userData`. */
  userData: string;
  /** False when the shipped folder is read-only (a packaged app). */
  canEditShipped: boolean;
}

const overrideDir = (d: PromptDirs) => path.join(d.userData, "prompts");
const versionsDir = (d: PromptDirs, name: string) =>
  path.join(d.userData, "prompt-versions", path.basename(name, ".md"));

/**
 * The file actually read.
 *
 * **Where editing is off, the shipped copy always wins** — an override left behind by an older
 * build is ignored rather than obeyed. That is the whole point: the failure being fixed is a local
 * edit quietly outranking every future release, and honouring the leftovers would keep it alive on
 * exactly the machines that already have one.
 */
async function activeFile(dirs: PromptDirs, name: string): Promise<string> {
  const shipped = path.join(dirs.shipped, name);
  if (!dirs.canEditShipped) return shipped;
  const mine = path.join(overrideDir(dirs), name);
  return (await stat(mine).catch(() => null)) ? mine : shipped;
}

/** An override this machine still has on disk but no longer reads. Null when there is none. */
async function leftoverOverride(dirs: PromptDirs, name: string): Promise<string | null> {
  if (dirs.canEditShipped) return null;
  const mine = path.join(overrideDir(dirs), name);
  return (await stat(mine).catch(() => null)) ? mine : null;
}

export async function listVersions(dirs: PromptDirs, name: string): Promise<PromptVersion[]> {
  const dir = versionsDir(dirs, name);
  const files = await readdir(dir).catch(() => []);
  const out = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => {
        const full = path.join(dir, f);
        const s = await stat(full).catch(() => null);
        return { saved: path.basename(f, ".md").replace(/_/g, ":"), file: full, length: s?.size ?? 0 };
      }),
  );
  // Newest first — the version you want to compare against is almost always the last one.
  return out.sort((a, b) => b.saved.localeCompare(a.saved));
}

export async function readPrompt(dirs: PromptDirs, name: string): Promise<PromptFile> {
  const file = await activeFile(dirs, name);
  return {
    name,
    text: await readFile(file, "utf8"),
    edited: file.startsWith(overrideDir(dirs)),
    savesTo: dirs.canEditShipped ? path.join(dirs.shipped, name) : null,
    readOnly: !dirs.canEditShipped,
    ignoredOverride: await leftoverOverride(dirs, name),
    versions: await listVersions(dirs, name),
  };
}

/**
 * Save an edit, keeping what was there before.
 *
 * The version is written from the text being *replaced*, not the new text, so the history is
 * "what it used to say" — which is the question anyone actually asks. Nothing is ever deleted
 * here; a prompt is a few kilobytes and the whole point is that a bad edit is recoverable.
 */
export async function savePrompt(dirs: PromptDirs, name: string, text: string): Promise<PromptFile> {
  // Refused rather than quietly written somewhere harmless: a save that appears to work and
  // changes nothing is the worse of the two failures, and the UI already hides the button.
  if (!dirs.canEditShipped) {
    throw new Error(
      "Prompts are read-only in the installed app. They ship with it, so a change to one goes out as a new version — edit it in the project and release.",
    );
  }

  const current = await activeFile(dirs, name);
  const before = await readFile(current, "utf8").catch(() => null);

  if (before !== null && before !== text) {
    const dir = versionsDir(dirs, name);
    await mkdir(dir, { recursive: true });
    // ":" is illegal in a Windows filename, so the timestamp is stored with underscores and
    // put back on read. Getting this wrong makes history silently stop working on one platform.
    await writeFile(path.join(dir, `${new Date().toISOString().replace(/:/g, "_")}.md`), before);
  }

  const target = path.join(dirs.shipped, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);

  return readPrompt(dirs, name);
}

/** The text of one saved version, for looking at or restoring. */
export async function readVersion(file: string): Promise<string> {
  return readFile(file, "utf8");
}

/**
 * new-listing-flow.ts — where each kit is in the one-button new listing, kept on disk.
 *
 * Vansh, 2026-09-27: *"only my work will be the first chat for inventory image and inventory json…
 * after that press one button and automation starts"*, with his check in between: *"maybe I don't
 * like any image"*. So the flow has exactly two places it stops for a person, and everything else runs:
 *
 *   images  → ChatGPT makes 1, 2 (and asks about sizes for 3)          automatic
 *   review  → he looks, redoes any image with a note, answers sizes     HIS CHECK
 *   listing → text chat, files filed, finish, Flipkart draft filled     automatic, after one press
 *   done    → the draft waits for him to read it and press Send to QC   HIS CHECK
 *
 * **One file, one row per kit, written after every stage.** A run of ten kits takes an hour and the
 * app can be closed in the middle; the row says what is done and what is next, so nothing is redone and
 * nothing is skipped. The screen reads this file and nothing else, so what it shows is what happened.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Stage =
  | "queued" // picked, not started
  | "images" // ChatGPT is making them
  | "review" // waiting for Vansh
  | "listing" // text, finish, Flipkart — running
  | "done" // draft filled; Send to QC is his
  | "failed"; // stopped; `error` says where and `stage` before it is in `failedAt`

export interface Job {
  sku: string;
  stage: Stage;
  /** The stage it stopped in, when `stage` is failed — what a retry resumes from. */
  failedAt?: Stage;
  /** The inventory photo the images were made from. */
  photo?: string;
  /** The ChatGPT chat that made the images. A redo goes back into THIS chat, where the kit list is. */
  chatUrl?: string;
  /** Image number → file. 1 is the hero. */
  images: Record<string, string>;
  /** ChatGPT's sizes table and question, when the sizes sheet stopped to ask. */
  sizesQuestion?: string;
  /** The Flipkart draft id, once one exists — how it is found in Listings in progress. */
  draftId?: string;
  /** What happened, one line each, newest last. The screen shows these. */
  log: string[];
  error?: string;
  updatedAt: string;
}

export interface JobBook {
  jobs: Job[];
}

export const jobsFile = (workspace: string): string => path.join(workspace, "new-listings.json");

export async function readJobs(file: string): Promise<JobBook> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? { jobs: [] } : (JSON.parse(text) as JobBook);
}

/** Temp file then rename: a crash mid-write never leaves half a book. */
export async function writeJobs(file: string, book: JobBook): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(book, null, 1));
  await rename(tmp, file);
}

/** The job for `sku`, changed by `patch` and a log line, as a new book. Adds the row when missing. */
export function update(book: JobBook, sku: string, patch: Partial<Job>, line?: string, now = new Date()): JobBook {
  const at = now.toISOString();
  const old = book.jobs.find((j) => j.sku === sku) ?? { sku, stage: "queued" as Stage, images: {}, log: [], updatedAt: at };
  const log = line ? [...old.log, `${at.slice(0, 16).replace("T", " ")} ${line}`] : old.log;
  const job = { ...old, ...patch, log, updatedAt: at };
  return { jobs: [...book.jobs.filter((j) => j.sku !== sku), job] };
}

/** Mark a job failed, keeping where it was so the retry knows what to redo. */
export const fail = (book: JobBook, sku: string, error: string): JobBook => {
  const was = book.jobs.find((j) => j.sku === sku)?.stage;
  return update(book, sku, { stage: "failed", failedAt: was === "failed" ? undefined : was, error }, `stopped: ${error}`);
};

export interface Candidate {
  sku: string;
  /** The inventory photo in the kit's folder, or null — then only "ChatGPT reads the photo" is impossible too. */
  photo: string | null;
  /** Already live on Flipkart at the last sync. Shown, but not offered — it is listed. */
  live: boolean;
  job: Job | null;
}

/**
 * Every saved kit, and whether it can go through the flow. Not-yet-listed first, then by SKU.
 * Kits that cannot start are listed with the reason rather than hidden (the WW-191 rule).
 */
export function candidates(
  kits: string[],
  isLive: (sku: string) => boolean,
  photoOf: (sku: string) => string | null,
  book: JobBook,
): Candidate[] {
  return kits
    .map((sku) => ({ sku, photo: photoOf(sku), live: isLive(sku), job: book.jobs.find((j) => j.sku === sku) ?? null }))
    .sort((a, b) => Number(a.live) - Number(b.live) || Number(!a.photo) - Number(!b.photo) || a.sku.localeCompare(b.sku));
}

/** Why this kit cannot start, or null when it can. */
export function blockedBy(c: Candidate): string | null {
  if (c.live) return "already live on Flipkart";
  if (!c.photo) return "no inventory photo (2.png or contents.jpg) in its folder";
  if (c.job && ["images", "listing"].includes(c.job.stage)) return "running now";
  return null;
}

/**
 * The one thing a person should press next for this kit — the screen lights this button up.
 * Null while the machine is working or when nothing is left.
 */
export function nextPress(job: Job | null): "start" | "review" | "continue" | "open-draft" | "retry" | null {
  if (!job || job.stage === "queued") return "start";
  if (job.stage === "review") return job.images["1"] && job.images["2"] ? "continue" : "review";
  if (job.stage === "done") return "open-draft";
  if (job.stage === "failed") return "retry";
  return null;
}

/** The images to list, in upload order: 1 (hero), 2, then 3 if it was made. Flipkart takes five. */
export const listingImages = (job: Job): string[] =>
  ["1", "2", "3", "4", "5"].map((n) => job.images[n]).filter((f): f is string => !!f);

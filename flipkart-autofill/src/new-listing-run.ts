/**
 * new-listing-run.ts — the two automatic stages of the one-button new listing, callable from anywhere.
 *
 *   makeImages  — the kit's counted image chat, ending in `review`
 *   toFlipkart  — text chat, files, parcel, finish, new Flipkart draft, images, three tabs; `done`
 *
 * Options in, progress out through `save`, nothing Electron-shaped — the same split as `images-core` and
 * `finish-core`, and for the same reason: the app's buttons call these, and so does a live test script,
 * so a test proves the code the button runs rather than a copy of it. **Never presses Send to QC.**
 */

import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { Job } from "./new-listing-flow.js";

export interface RunDeps {
  sku: string;
  /** Record progress: merge `patch` into the kit's row and add a log line. */
  save: (patch: Partial<Job>, line?: string) => Promise<void>;
  /** The kit's row as it is now. */
  job: () => Promise<Job | null>;
  readPrompt: (name: string) => Promise<string>;
  kitsDir: string;
  imagesDir: string;
  productsDir: string;
  /** Where `image-meta-<ID>.json` is filed — what finish reads the descriptions from. */
  metaDir: string;
  /** Scratch space for the meta download and the finish staging. */
  tempDir: string;
  /** A ChatGPT tab on `url`, or a fresh chat when absent. */
  chat: (url?: string) => Promise<Page>;
}

/** The kit, counted — the same numbers the image prompts quote. */
export async function loadKit(kitsDir: string, sku: string) {
  const { findById } = await import("./id.js");
  const { readKit, loadMaterials } = await import("./inventory-core.js");
  const { countKit } = await import("./kit-prompt.js");
  const file = await findById(kitsDir, sku);
  if (!file) throw new Error(`No kit saved for ${sku} — cost it first.`);
  const saved = readKit(file.file);
  const materials = loadMaterials();
  const sizes = new Map(materials.map((m) => [m.material, m.size]));
  return { file: file.file, saved, materials, kit: countKit(saved.lines, saved.resolved ?? {}, (m) => sizes.get(m)) };
}

/** Stage 1: the images, in one chat. Ends in `review`; throws with the reason otherwise. */
export async function makeImages(d: RunDeps, photo: string): Promise<void> {
  const { runImageChat, KIT_RUN, chatTitle, lastReplyLines } = await import("./chat-core.js");
  const { kitBlock, withKit, checkReady, countCheck, isHeroPrompt } = await import("./kit-prompt.js");
  const { rawFileFor } = await import("./sku-core.js");
  const { kit } = await loadKit(d.kitsDir, d.sku);
  await d.save({ stage: "images", photo, images: {}, sizesQuestion: undefined, error: undefined }, `making images from ${path.basename(photo)}`);
  const block = kitBlock(d.sku, kit);
  const tab = await d.chat();
  // Saved one at a time, in order: two writes racing would drop an image from the row.
  let writes = Promise.resolve();
  const done = await runImageChat(tab, {
    contentsPhoto: photo,
    steps: KIT_RUN,
    readPrompt: d.readPrompt,
    fill: (text, name) => withKit(text, block) + (isHeroPrompt(name) ? countCheck(kit) : ""),
    verify: (reply) => checkReady(reply, kit),
    fileFor: (n) => rawFileFor(d.imagesDir, d.sku, n),
    onStep: (r) => {
      const n = r.file ? /(\d+)\.\w+$/.exec(r.file)?.[1] : null;
      const line = r.error ?? (r.file ? `image ${n} made (${r.seconds}s)` : r.awaiting ? "sizes: ChatGPT is asking" : r.missing ? `${r.prompt}: no image came back` : `${r.prompt}: done`);
      writes = writes.then(async () => {
        const j = await d.job();
        await d.save(n ? { images: { ...(j?.images ?? {}), [n]: r.file! } } : {}, line);
      });
    },
    title: chatTitle("images", d.sku),
  });
  await writes;
  const stopped = done.find((x) => x.error)?.error;
  if (stopped) throw new Error(stopped);
  const asks = done.some((x) => x.awaiting) ? await lastReplyLines(tab) : undefined;
  await d.save({ stage: "review", chatUrl: tab.url(), sizesQuestion: asks }, "ready for your check");
}

/**
 * Stage 2, after his check: text chat → files → parcel → finish → Flipkart draft, filled. Ends in `done`.
 *
 * `flipkart` is the Chrome side, passed in so the caller owns the session: `newTab` for a page, `fill`
 * for one tab of the form, `brand` and `over` from the account's settings.
 */
export async function toFlipkart(
  d: RunDeps,
  flipkart: {
    newTab: () => Promise<Page>;
    fill: (page: Page, tab: "" | "pricing" | "description") => Promise<{ rows: unknown[]; needsEyes: number }>;
    brand: string;
  },
): Promise<void> {
  const { runMetaChat, chatTitle } = await import("./chat-core.js");
  const { listingImages } = await import("./new-listing-flow.js");
  const { findById } = await import("./id.js");
  const job = await d.job();
  if (!job) throw new Error("No such kit in the flow.");
  const images = listingImages(job);
  if (images.length < 2) throw new Error("Images 1 and 2 are needed before the listing.");
  const { file: kitFile, saved, materials } = await loadKit(d.kitsDir, d.sku);
  await d.save({ stage: "listing", error: undefined }, "writing the listing text");

  // The text: PROMPT-meta then PROMPT-product, one chat, filed by the same importer as a hand download.
  const saveDir = path.join(d.tempDir, `ww-meta-${d.sku}`);
  await rm(saveDir, { recursive: true, force: true });
  const meta = await runMetaChat(await d.chat(), {
    images,
    kit: { sku: d.sku, json: await readFile(kitFile, "utf8") },
    readPrompt: d.readPrompt,
    saveDir,
    title: chatTitle("meta", d.sku),
  });
  const missed = meta.filter((m) => !m.file).map((m) => m.prompt);
  if (missed.length) throw new Error(`Nothing readable came back from ${missed.join(" and ")} — the chat is still open.`);
  const { importInbox } = await import("./inbox.js");
  await importInbox(saveDir, { move: true, products: d.productsDir, meta: d.metaDir });
  if (!(await findById(d.productsDir, d.sku))) throw new Error(`The Flipkart fields did not land in products/ for ${d.sku}.`);
  await d.save({}, "listing text filed (image-meta + products)");

  // The parcel, measured from the kit — the one source for Package Details (C-049).
  const { loadPackaging, parcelFor, flipkartFields } = await import("./packaging.js");
  const spec = loadPackaging();
  if (spec) {
    const f = flipkartFields(parcelFor(saved.lines, materials, spec, (saved.parcel as never) ?? {}));
    const { applyParcelToListing } = await import("./paste-core.js");
    await applyParcelToListing(d.sku, { ...f.dimensions, packageDetails: f.packageDetails }, { products: d.productsDir });
    await d.save({}, "parcel size put on the listing");
  }

  // Finish from a folder holding EXACTLY the kept images, in order: finish takes every image file it
  // finds, so finishing 1-raw/<SKU>/ directly would also upload a dropped or leftover one.
  const staged = path.join(d.tempDir, `ww-finish-${d.sku}`);
  const outDir = path.join(d.imagesDir, "3-final", d.sku);
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  for (const [i, f] of images.entries()) await copyFile(f, path.join(staged, `${i + 1}${path.extname(f)}`));
  await rm(outDir, { recursive: true, force: true });
  const { runFinish } = await import("./finish-core.js");
  const fin = await runFinish({ inDir: staged, outDir, id: d.sku, metaId: d.sku });
  if (fin.failures.length) throw new Error(`Finishing failed: ${fin.failures.join("; ")}`);
  const pos = (f: string) => Number(/(\d+)\.jpg$/.exec(f)?.[1]);
  const finals = fin.rows.map((r) => r.to).sort((a, b) => pos(a) - pos(b));
  await d.save({}, `finished ${finals.length} images into images/3-final/${d.sku}`);

  // Flipkart: a new draft, the images, then the three tabs. Never Send to QC.
  const { openNewListing, uploadImages } = await import("./new-listing.js");
  const page = await flipkart.newTab();
  const draftId = await openNewListing(page, flipkart.brand).catch((err) => {
    throw new Error(/referral_url|seller\.flipkart\.com\/\?/.test(page.url()) ? "Flipkart is logged out — log in once in the app's Chrome." : String(err instanceof Error ? err.message : err));
  });
  await d.save({ draftId }, `Flipkart draft ${draftId} opened`);
  const up = await uploadImages(page, finals);
  const bad = up.find((r) => !r.ok);
  if (bad) throw new Error(`Image upload: ${bad.why}`);
  await d.save({}, `${finals.length} images uploaded`);
  let eyes = 0;
  for (const [label, tab] of [["Price, Stock and Shipping", "pricing"], ["Product Description", "description"], ["Additional Description", ""]] as const) {
    await page.getByText(new RegExp(label)).first().click();
    await page.waitForTimeout(2500);
    const r = await flipkart.fill(page, tab);
    eyes += r.needsEyes;
    await d.save({}, `${label}: ${r.rows.length} fields, ${r.needsEyes} need your eyes`);
  }
  // Leaving the last tab is what saves it.
  await page.getByText(/Image addition \(/).first().click();
  await page.waitForTimeout(3000);
  await d.save({ stage: "done" }, eyes ? `draft filled — ${eyes} fields to check before Send to QC` : "draft filled — read it, then Send to QC yourself");
}

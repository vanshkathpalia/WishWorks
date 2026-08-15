/**
 * main.ts — the Electron main process. This is where the engine actually runs.
 *
 * Two things happen here before anything else, in this order, and the order matters:
 *
 *   1. `app.setName("WishWorks")` — Electron derives `userData` from the package name, which is
 *      "flipkart-autofill". `paths.ts` computes the same directory by hand and spells it
 *      "WishWorks" (WW-094, so the CLI and the app share one Chrome profile). Without this line
 *      they would disagree and the packaged app would come up logged out.
 *   2. The WW_*_DIR overrides are pointed at a workspace under `userData`, BEFORE the engine is
 *      imported. `paths.ts` resolves its defaults from `import.meta.url`, which inside a packaged
 *      app lands in `app.asar` — read-only. The overrides already existed for the test suite;
 *      they are how a packaged app gets a writable home. This is why images-core is loaded with
 *      `await import()` rather than a top-level import: a static import would be hoisted above
 *      the assignments and read the defaults.
 *
 * The renderer never sees any of this. It gets paths and small JSON over the channels in
 * shared.ts and nothing else.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readFile, writeFile, mkdir, readdir, rm, copyFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Attempt, CleanUp, ConvertResult, DefaultsTab, Row, StepId } from "./shared.js";

app.setName("WishWorks");

const USER_DATA = app.getPath("userData");
const SETTINGS_FILE = path.join(USER_DATA, "settings.json");

/**
 * Everything the engine reads or writes. Defaults beside the Chrome profile — never inside the
 * app, which is read-only once packaged — and changeable from Settings.
 *
 * Read synchronously because the env vars below must be set before the engine is imported, and
 * `paths.ts` resolves them at module load. That is also why changing it relaunches the app
 * rather than taking effect immediately: `IMAGES_DIR` and friends are consts, and a fresh
 * `import()` would not re-evaluate `paths.ts` (only the cache-busted URL reloads, not its
 * static imports). One restart is honest; a setting that silently half-applies is not.
 */
interface Settings {
  workspace?: string;
  /**
   * Let this machine edit the prompt files even though the app is packaged.
   *
   * OFF by default and that is the safe default, because an edit made in a package lands in
   * `userData` and never reaches the repo — so it cannot ship to anyone, and it then outranks
   * every future release on this machine for that file (WW-125). Vansh runs the .dmg as well as
   * the source, so he asked for the switch; the Settings panel says what it costs.
   */
  editPrompts?: boolean;
  /** Pages worth returning to, saved by the user from whatever they navigated to. */
  shortcuts?: { name: string; url: string }[];
  /**
   * Where costed kits live, when it should NOT be inside the workspace.
   *
   * The point is a synced folder holding the kits and nothing else — see KITS_DIR. Unset, they sit
   * in the workspace like every other piece of user state.
   */
  kits?: string;
  /**
   * Where the AI's Flipkart files (`products-<ID>.json`) are read from, when it should NOT be
   * inside the workspace.
   *
   * Every other step names its own folder in a dialog; this one silently used
   * `<workspace>/products` and said so nowhere, so "no file matches" was indistinguishable from
   * "the app is looking in a folder you have never seen". Pointing it straight at Downloads is a
   * legitimate answer — it is where the downloads already are.
   */
  products?: string;
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {}; // no settings yet, or unreadable — every default is valid
  }
}

/** Always merge. An earlier version wrote `{workspace}` flat and would have eaten the shortcuts. */
async function writeSettings(patch: Settings): Promise<void> {
  await writeFile(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

/**
 * Where images, image-meta/ and products/ live. Settings wins; otherwise it depends on who is
 * running it, the same split `DOCS` below makes for the prompt files.
 *
 * **In development: the repo itself.** Anything else gives one machine two `image-meta/` folders
 * with the same name and different contents — the app writing to `Application Support` while
 * `npm run …` reads `flipkart-autofill/`. That cost an afternoon: files were deleted from the
 * repo copy and the app went on listing them, correctly, from the other one. Same folder means
 * the app and the terminal can never disagree.
 *
 * **Packaged: Electron's per-app folder.** The app bundle is read-only and there is no repo on
 * the partner's machine, so it gets a folder of its own — and `chooseWorkspace` moves it
 * anywhere he likes, which is stored in settings.json and survives updates.
 */
function storedWorkspace(): string {
  const w = readSettings().workspace;
  if (typeof w === "string" && w.length > 0) return w;
  return app.isPackaged
    ? path.join(USER_DATA, "workspace")
    : path.join(import.meta.dirname, "..", "..");
}

const WORKSPACE = storedWorkspace();

process.env.WW_IMAGES_DIR ??= path.join(WORKSPACE, "images");
process.env.WW_META_DIR ??= path.join(WORKSPACE, "image-meta");
/** Settable on its own, like the kits — see Settings.products for why. */
const PRODUCTS_DIR = readSettings().products || path.join(WORKSPACE, "products");
process.env.WW_PRODUCTS_DIR ??= PRODUCTS_DIR;
/**
 * Costed kits are user state, like products/ — NOT categories/, which ships read-only inside the
 * app and would lose every saved kit on the next update.
 *
 * **It has a setting of its own, separate from the workspace, and that separation is the point.**
 * Sharing kits between two machines means a Drive or Dropbox folder, and pointing the whole
 * workspace at one drags the images along: megabytes per listing, and worse, every sync service
 * can evict a file and leave a placeholder behind, which `sharp` then reads as a broken image.
 * Kits are a few kilobytes of JSON and nothing streams them, so they sync safely on their own
 * while the images stay local. Nothing here syncs by itself and nothing should — a folder they
 * already trust beats a sync mechanism this app would have to own.
 */
const KITS_DIR = readSettings().kits || path.join(WORKSPACE, "inventory");
process.env.WW_KITS_DIR ??= KITS_DIR;

/**
 * Categories are the one WW_* dir that is NOT user state — they ship with the app.
 * `balloon-decoration.defaults.json` holds the shared answers `loadProduct()` merges under every
 * product, so pointed at an empty workspace folder it does not fail, it silently fills a form
 * with the defaults missing. Packaged it therefore reads the shipped copy (extraResources) and
 * updates with the app; only `npm run scan` writes here, and that is a CLI on Vansh's Mac.
 */
process.env.WW_CATEGORIES_DIR ??= app.isPackaged
  ? path.join(process.resourcesPath, "categories")
  : path.join(WORKSPACE, "categories");

/**
 * The Chrome profile — the live Flipkart login — pinned to the SAME folder the CLI uses.
 *
 * `paths.ts` prefers a legacy `<project>/profile` so nobody re-does an OTP (WW-094), and it finds
 * it by resolving `ROOT` from its own file location. That works from `src/`, but this app's
 * bundle lives in `out/main/`, so `ROOT` came out as `flipkart-autofill/out`, `out/profile` did
 * not exist, and the app quietly created a SECOND profile under `userData` — with no session in
 * it. The symptom is "I have to log in again", which is WW-061's symptom yet again from a third
 * cause, and it is why that check has to be made from a root the bundler cannot move.
 *
 * Packaged there is no project folder, so this correctly falls through to `userData`.
 */
const DEV_PACKAGE_ROOT = path.join(import.meta.dirname, "..", "..");
const LEGACY_PROFILE = path.join(DEV_PACKAGE_ROOT, "profile");
process.env.WW_PROFILE_DIR ??=
  !app.isPackaged && existsSync(LEGACY_PROFILE) ? LEGACY_PROFILE : path.join(USER_DATA, "profile");

/** The engine, loaded after the env above is set. Same reason for every one of these. */
const engine = () => import("../src/images-core.js");
const finishEngine = () => import("../src/finish-core.js");
const pasteEngine = () => import("../src/paste-core.js");
const inboxEngine = () => import("../src/inbox.js");
const listingsEngine = () => import("../src/listings.js");
const checkEngine = () => import("../src/check-core.js");

/** The repo the prompt files live in. In dev that is two levels up; packaged, it ships inside. */
const DOCS = app.isPackaged
  ? path.join(process.resourcesPath, "docs", "guides")
  : path.join(import.meta.dirname, "..", "..", "..", "docs", "guides");

// ---------------------------------------------------------------- folder memory

/**
 * Which folder each step last used. A convenience cache and nothing more: delete this file and
 * every step falls back to ~/Downloads and the app works exactly as well. Never put anything in
 * here the app needs to function.
 */
const MEMORY_FILE = path.join(USER_DATA, "folders.json");

async function remembered(): Promise<Partial<Record<StepId, string>>> {
  try {
    return JSON.parse(await readFile(MEMORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function remember(step: StepId, dir: string): Promise<void> {
  await writeFile(MEMORY_FILE, JSON.stringify({ ...(await remembered()), [step]: dir }, null, 2));
}

// ---------------------------------------------------------------- staging

const INPUT_EXT = new Set([
  ".avif", ".webp", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".bmp", ".heic", ".heif",
]);

/**
 * Copy the chosen photos into `images/1-raw/<name>/`.
 *
 * The engine's source folder is fixed (`<WW_IMAGES_DIR>/1-raw/<product>/`) — `runImages()` takes
 * no input path — so whatever the user picked has to be staged rather than read in place. Copying
 * is the better half of the trade anyway: the originals are never touched, which is the same
 * one-direction-of-travel rule the three-folder pipeline already follows.
 *
 * Accepts a folder OR loose image files, because both are how photos actually arrive: a whole
 * download folder, or four images picked out of a bigger one. Loose files take the product name
 * from the folder they were sitting in, which is the same answer the folder case gives.
 *
 * File names are kept as they are. The engine sorts numerically and renumbers on output, so
 * renaming here would only add a second naming convention.
 */
async function stage(input: string[]): Promise<{ product: string; count: number }> {
  const first = input[0];
  const isFolder = input.length === 1 && (await stat(first)).isDirectory();

  const product = path.basename(isFolder ? first : path.dirname(first));
  const sources = isFolder
    ? (await readdir(first, { withFileTypes: true }))
        .filter((d) => d.isFile() && !d.name.startsWith("."))
        .map((d) => path.join(first, d.name))
    : input;

  // Every image format sharp can open is welcome; anything else in the folder is skipped rather
  // than failing the run, because a stray .txt or Thumbs.db is not the user's mistake.
  const images = sources.filter((f) => INPUT_EXT.has(path.extname(f).toLowerCase()));

  const dest = path.join(process.env.WW_IMAGES_DIR!, "1-raw", product);
  // Re-running replaces the folder rather than merging, so a photo you removed actually goes.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const f of images) await copyFile(f, path.join(dest, path.basename(f)));
  return { product, count: images.length };
}

// ---------------------------------------------------------------- ipc

/**
 * One picker, two modes. They are separate calls rather than one dialog because **Windows cannot
 * combine `openFile` and `openDirectory`** — it silently honours whichever came first — so a
 * single "choose" button would behave differently on the two machines this app runs on.
 */
ipcMain.handle("pick", async (e, step: StepId, mode: "folder" | "files"): Promise<string[]> => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: mode === "folder" ? ["openDirectory"] : ["openFile", "multiSelections"],
    filters:
      mode === "files"
        ? [{ name: "Images", extensions: [...INPUT_EXT].map((x) => x.slice(1)) }]
        : undefined,
    defaultPath: (await remembered())[step] ?? app.getPath("downloads"),
  });
  if (canceled || filePaths.length === 0) return [];
  await remember(step, mode === "folder" ? filePaths[0] : path.dirname(filePaths[0]));
  return filePaths;
});

ipcMain.handle("convert", async (e, input: string[], cleanUp: CleanUp): Promise<ConvertResult> => {
  const { product, count } = await stage(input);
  const outDir = path.join(process.env.WW_IMAGES_DIR!, "2-clean", product);
  if (count === 0) return { product, outDir, rows: [], failures: [], empty: true };

  const { runImages } = await engine();
  // The tag clean-up is part of THIS call — stage 1 is where the engine crops and paints. An
  // empty position list means "every image", which is what `runImages` reads `null` as.
  const result = await runImages(
    {
      cropBottom: cleanUp.cropBottom,
      cropImages: cleanUp.cropImages.length ? cleanUp.cropImages : null,
      eraseTag: cleanUp.eraseTag,
      eraseImages: cleanUp.eraseImages.length ? cleanUp.eraseImages : null,
    },
    (row: Row) => e.sender.send("row", row),
  );
  return {
    product,
    outDir,
    // The workspace can hold other products from earlier runs; show only this one.
    rows: result.rows.filter((r) => r.product === product),
    failures: result.failures.filter((f) => f.includes(product)),
    empty: false,
  };
});

// ---------------------------------------------------------------- listings, prompts, inbox

ipcMain.handle("listings", async () => (await listingsEngine()).listListings());

const promptsEngine = () => import("../src/prompts.js");
const photoEngine = () => import("../src/photo-inbox.js");

/**
 * Where prompts live and where an edit may be written. In development the repo file is the
 * source of truth (CLAUDE.md is explicit that each prompt is edited in its own file), so saving
 * goes there and git can see it. Packaged, that folder is inside the app and read-only, so the
 * edit lands in `userData` and is read in preference from then on.
 */
const promptDirs = () => ({
  shipped: DOCS,
  userData: USER_DATA,
  // In development the repo file is writable and an edit is a real change git can carry. Packaged,
  // it is off unless this machine has explicitly asked for it — see the Settings comment.
  canEditShipped: !app.isPackaged || readSettings().editPrompts === true,
});

/**
 * A prompt file's entire text, for the one-click copy. The prompt files are "nothing but the
 * prompt" for exactly this reason, so this is a file read and no parsing — anything that tried to
 * pull sections out would drift from the file the moment someone edited it.
 */
ipcMain.handle("promptText", async (_e, file: string) =>
  (await (await promptsEngine()).readPrompt(promptDirs(), file)).text,
);

ipcMain.handle("readPrompt", async (_e, file: string) =>
  (await promptsEngine()).readPrompt(promptDirs(), file),
);
ipcMain.handle("savePrompt", async (_e, file: string, text: string) =>
  (await promptsEngine()).savePrompt(promptDirs(), file, text),
);
ipcMain.handle("editPrompts", () => promptDirs().canEditShipped);
ipcMain.handle("setEditPrompts", async (_e, on: boolean) => writeSettings({ editPrompts: on }));

ipcMain.handle("readVersion", async (_e, file: string) =>
  (await promptsEngine()).readVersion(file),
);

// ---------------------------------------------------------------- inventory costing

const inventoryEngine = () => import("../src/inventory-core.js");

ipcMain.handle("materials", async () => (await inventoryEngine()).loadMaterials());

ipcMain.handle("materialGaps", async () => {
  const { gaps, loadMaterials } = await inventoryEngine();
  const materials = loadMaterials();
  return { ...gaps(materials), total: materials.length };
});

/**
 * One code path for both ways the reply arrives — a saved `.json`, or the code block pasted
 * straight out of the chat. `extractJson` copes with the fence and any prose around it, so a file
 * is just text that came from disk and neither route can behave differently from the other.
 */
async function costFromText(
  text: string,
  overrides: Record<number, string>,
  what: string,
): Promise<Attempt<unknown>> {
  const { costKit, extractJson, loadMaterials, readKitFile } = await inventoryEngine();
  const json = extractJson(text);
  if (json === null) {
    return {
      ok: false,
      message: `Could not find any JSON in ${what}. Copy the whole reply from the chat — the \`\`\`json fence and any words around it are fine, but it has to contain the { … } block.`,
    };
  }
  const { sku, lines } = readKitFile(json);
  if (lines.length === 0) {
    return {
      ok: false,
      message: `There are no item lines in ${what}. The reply should be a JSON object with a "lines" list in it.`,
    };
  }
  return { ok: true, result: costKit(lines, loadMaterials(), overrides ?? {}, sku) };
}

ipcMain.handle(
  "costInventory",
  async (_e, file: string, overrides: Record<number, string>): Promise<Attempt<unknown>> => {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) return { ok: false, message: `Could not read ${path.basename(file)}.` };
    return costFromText(text, overrides, path.basename(file));
  },
);

ipcMain.handle(
  "costPasted",
  async (_e, text: string, overrides: Record<number, string>): Promise<Attempt<unknown>> =>
    costFromText(text, overrides, "what you pasted"),
);

ipcMain.handle(
  "costLines",
  async (
    _e,
    lines: unknown,
    overrides: Record<number, string>,
    sku: string,
    prices: Record<string, number>,
    counts: Record<number, number>,
  ) => {
    const { costKit, loadMaterials } = await inventoryEngine();
    return costKit(lines as never, loadMaterials(), overrides ?? {}, sku, prices ?? {}, counts ?? {});
  },
);

/**
 * Change a price in the list itself — for every kit, and for the other machine on the next release.
 *
 * Refused where `categories/` is inside the app bundle, because a silent no-op there would look
 * exactly like a saved change right up until the next kit disagreed with this one.
 */
ipcMain.handle(
  "setMaterialPrice",
  async (_e, key: string, paise: number | null): Promise<Attempt<unknown>> => {
    if (app.isPackaged) {
      return {
        ok: false,
        message:
          "The price list ships inside the app, so it cannot be changed here — a change has to go out as a new version, or the two machines would disagree about what a kit costs. Use the price for this kit only, and ask for the list to be corrected.",
      };
    }
    try {
      return { ok: true, result: (await inventoryEngine()).setMaterialPrice(key, paise) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle("parcelFor", async (_e, lines: unknown, chosen: unknown) => {
  const { loadMaterials } = await inventoryEngine();
  const { flipkartFields, loadPackaging, parcelFor } = await import("../src/packaging.js");
  const spec = loadPackaging();
  if (!spec) return null; // no rules shipped — say nothing rather than invent a box
  const parcel = parcelFor(lines as never, loadMaterials(), spec, (chosen as never) ?? {});
  return { parcel, boxes: spec.boxes, ...flipkartFields(parcel) };
});

/**
 * Every kit as one spreadsheet. The JSON is the right thing to STORE and the wrong thing to READ —
 * the partner has never opened a `.json` and should not have to start.
 */
ipcMain.handle("exportKits", async (_e, only: string | null) => {
  const { listKits, loadMaterials, readKit } = await inventoryEngine();
  const { loadPackaging } = await import("../src/packaging.js");
  const { kitsToCsv } = await import("../src/kit-csv.js");

  const rows = listKits();
  const kits = (only ? rows.filter((k) => k.file === only) : rows).map((k) => readKit(k.file));
  if (kits.length === 0) return null;

  const suggested = only && kits[0].sku ? `${kits[0].sku}.csv` : "wishworks-kits.csv";
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Save the costing sheet",
    defaultPath: path.join(app.getPath("downloads"), suggested),
    filters: [{ name: "Spreadsheet", extensions: ["csv"] }],
  });
  if (canceled || !filePath) return null;

  await writeFile(filePath, kitsToCsv(kits, { materials: loadMaterials(), packaging: loadPackaging() }));
  return filePath;
});

ipcMain.handle("saveKit", async (_e, kit: unknown) => (await inventoryEngine()).saveKit(kit as never));
/**
 * Reveal where the saved kits live — for looking at, backing up, or pointing at a shared drive.
 *
 * Created if it does not exist yet: "open the folder" failing on a fresh install because nothing
 * has been saved is a worse answer than an empty window.
 */
ipcMain.handle("openKitsFolder", async () => {
  const dir = KITS_DIR;
  await mkdir(dir, { recursive: true });
  await shell.openPath(dir);
});

/** With the price list, so each kit can say what it leaves — the panel colours the list by it. */
ipcMain.handle("listKits", async () => {
  const { listKits, loadMaterials, KITS_DIR } = await inventoryEngine();
  return listKits(KITS_DIR, loadMaterials());
});
ipcMain.handle("openKit", async (_e, file: string) => (await inventoryEngine()).readKit(file));

// ---------------------------------------------------------------- the AI's pictures

ipcMain.handle("scanPhotos", async (_e, from: string, root: string) =>
  (await photoEngine()).scanPhotos(from, root),
);
ipcMain.handle(
  "importPhoto",
  async (_e, item: unknown, position: number, opts: { move?: boolean }) =>
    (await photoEngine()).importPhoto(item as never, position, opts),
);
ipcMain.handle("listingFolders", async (_e, root: string) =>
  (await photoEngine()).findListingFolders(root),
);

/** Put a listing's copy where the marketplace form can take it. */
ipcMain.handle("paste", async (_e, id: string) => {
  const { runPaste, PasteNotFound } = await pasteEngine();
  try {
    return { ok: true as const, result: await runPaste(id) };
  } catch (e) {
    if (e instanceof PasteNotFound) return { ok: false as const, message: e.message };
    throw e;
  }
});

/** Repair a listing written before the emoji rule existed — see stripFlipkartEmoji. */
ipcMain.handle("stripEmoji", async (_e, id: string) => {
  const { stripFlipkartEmoji } = await pasteEngine();
  return stripFlipkartEmoji(id);
});

/**
 * The listing file as text, for editing in the app.
 *
 * Vansh, 2026-08-12: *"we should have the freedom to open that json in the app UI also."* Until
 * now a `TODO_MRP` could only be filled by finding the file on disk and opening a code editor —
 * which is exactly the thing the app exists to remove for the partner.
 */
ipcMain.handle("readProduct", async (_e, id: string) => {
  const { findById, whyNoMatch } = await import("../src/id.js");
  const { PRODUCTS_DIR } = await import("../src/paths.js");
  const match = await findById(PRODUCTS_DIR, id);
  if (!match) return { ok: false as const, message: await whyNoMatch(PRODUCTS_DIR, id) };
  return { ok: true as const, result: { file: match.file, text: await readFile(match.file, "utf8") } };
});

/** Save it back. Refused unless it parses — a half-typed file would break every later step. */
ipcMain.handle("saveProduct", async (_e, file: string, text: string) => {
  try {
    JSON.parse(text);
  } catch (e) {
    return { ok: false as const, message: `Not valid JSON, so nothing was saved — ${(e as Error).message}` };
  }
  await writeFile(file, text.endsWith("\n") ? text : `${text}\n`);
  return { ok: true as const, result: file };
});

/** Write the costed kit's parcel into the listing the bot fills, so the two cannot disagree. */
ipcMain.handle("applyParcel", async (_e, id: string, dimensions: Record<string, string>) => {
  const { applyParcelToListing, PasteNotFound } = await pasteEngine();
  try {
    return { ok: true as const, result: await applyParcelToListing(id, dimensions) };
  } catch (e) {
    if (e instanceof PasteNotFound) return { ok: false as const, message: e.message };
    throw e;
  }
});

ipcMain.handle("scanInbox", async (_e, from: string) => (await inboxEngine()).scanInbox(from));

ipcMain.handle("importInbox", async (_e, from: string, opts: { move?: boolean; only?: string[] }) =>
  (await inboxEngine()).importInbox(from, opts),
);

/** Where the AI's downloads land. Remembered per step like every other folder. */
ipcMain.handle("downloadsDir", async () => (await remembered()).inbox ?? app.getPath("downloads"));

/** Drop a returned .json straight into image-meta/ or products/, deciding which by its content. */
ipcMain.handle("fileOne", async (_e, files: string[]) => {
  const { importInbox } = await inboxEngine();
  // importInbox works on a folder, so hand it the folder these came from and name the files.
  const dir = path.dirname(files[0]);
  return importInbox(dir, { only: files });
});

/**
 * `id` renames the output; `metaId` picks the descriptions. They are separate options because
 * WW-078 was one variable doing both — a descriptions answer silently renamed the listing and
 * wrote Annaprashan copy into Groom-To-Be photos. Passing them separately makes that
 * unrepresentable, so the UI must never derive one from the other.
 */
ipcMain.handle(
  "finish",
  async (e, o: { inDir: string; outDir: string; id?: string | null; metaId?: string | null }) => {
    const { runFinish } = await finishEngine();
    return runFinish(o, (row) => e.sender.send("row", row));
  },
);

ipcMain.handle("check", async (_e, target: string) => {
  const { runCheck, CheckNotFound } = await checkEngine();
  try {
    return { ok: true as const, result: await runCheck(target) };
  } catch (err) {
    if (err instanceof CheckNotFound) return { ok: false as const, message: err.message };
    throw err;
  }
});

/** The clean folder for a listing, by its REAL folder name — never the normalised key. */
ipcMain.handle("cleanFolder", (_e, folder: string) =>
  path.join(process.env.WW_IMAGES_DIR!, "2-clean", folder),
);

// ---------------------------------------------------------------- the browser

/**
 * The one live fill, kept here so `save` can consult it. The ⚠️ guard is enforced in the engine
 * as well; this is the value it checks, not the guard itself.
 */
let lastFill: { needsEyes: number } | null = null;

const browserEngine = () => import("../src/browser-core.js");

/** Everything below reports a failure as `{ ok: false }` rather than throwing, because a browser
 *  that will not start is an ordinary Tuesday and must never look like a crash. */
async function guarded<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, result: await fn() };
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
  }
}

ipcMain.handle("openChrome", (_e, url?: string) =>
  guarded(async () => (await browserEngine()).openSession(url)),
);

/**
 * Saved pages.
 *
 * Deliberately **not** a hardcoded list of Flipkart routes. The seller panel is a hash-routed
 * single-page app and nobody here has verified what `#listings` or a category form actually
 * resolves to — a guessed route that silently lands on the dashboard is worse than no button,
 * because it looks like it worked. So the user navigates once and presses Remember, which works
 * for every page including ones this code has never heard of.
 */
ipcMain.handle("shortcuts", () => readSettings().shortcuts ?? []);

ipcMain.handle("rememberPage", async (_e, name: string) => {
  const { sessionStatus } = await browserEngine();
  const { url } = await sessionStatus();
  if (!url || url === "about:blank") return null;
  const shortcuts = (readSettings().shortcuts ?? []).filter((s) => s.name !== name);
  shortcuts.unshift({ name, url });
  await writeSettings({ shortcuts });
  return { name, url };
});

ipcMain.handle("forgetPage", async (_e, name: string) => {
  const shortcuts = (readSettings().shortcuts ?? []).filter((s) => s.name !== name);
  await writeSettings({ shortcuts });
  return shortcuts;
});
ipcMain.handle("chromeStatus", async () => (await browserEngine()).sessionStatus());
ipcMain.handle("closeChrome", async () => {
  lastFill = null;
  return (await browserEngine()).closeSession();
});

ipcMain.handle("fillListing", (e, id: string, tab?: DefaultsTab) =>
  guarded(async () => {
    const { fillListing } = await browserEngine();
    const result = await fillListing(id, (row) => e.sender.send("field", row), tab);
    lastFill = { needsEyes: result.needsEyes };
    return result;
  }),
);

ipcMain.handle("saveListing", () =>
  guarded(async () => (await browserEngine()).saveListing(lastFill)),
);

// Calibration, and safe enough to hand to anyone: it only ADDS labels to the category file,
// and `mergeScan`'s junk guard refuses a page that is not a form (WW-110).
ipcMain.handle("scanTab", (_e, id: string) =>
  guarded(async () => (await browserEngine()).scanTab(id)),
);

ipcMain.handle("rememberedFolders", remembered);
ipcMain.handle("clearFolders", () => rm(MEMORY_FILE, { force: true }));
// Created first: `shell.openPath` on a folder that does not exist yet does NOTHING, silently —
// and the folders most worth looking at (products/, a workspace just moved) are exactly the ones
// nothing has written to yet. A button that opens an empty folder is an answer; one that appears
// broken is not.
ipcMain.handle("showFolder", async (_e, dir: string) => {
  await mkdir(dir, { recursive: true }).catch(() => {});
  await shell.openPath(dir);
});
ipcMain.handle("workspaceDir", () => WORKSPACE);

/**
 * Move where everything is kept. Existing files are NOT moved — the old folder is left exactly
 * as it was, so a wrong choice costs nothing and is undone by choosing again.
 */
/**
 * Point the kits at a folder of their own — normally a shared Drive/Dropbox folder, so two
 * machines see the same costings.
 *
 * Relaunches for the same reason `chooseWorkspace` does: the engine reads `WW_KITS_DIR` once, at
 * module load, so a setting that took effect "sort of, until you restart" would be worse than one
 * that is honest about needing to.
 */
ipcMain.handle("chooseKitsFolder", async (e): Promise<boolean> => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: KITS_DIR,
    message: "Where should the costed kits be kept? Pick a shared folder to share them.",
  });
  if (canceled || filePaths.length === 0) return false;
  await writeSettings({ kits: filePaths[0] });
  app.relaunch();
  app.quit();
  return true;
});

ipcMain.handle("kitsFolder", () => KITS_DIR);

ipcMain.handle("productsFolder", () => PRODUCTS_DIR);

/**
 * Point the Fill Flipkart step at the folder the `products-<ID>.json` files are actually in.
 *
 * Relaunches for the same reason `chooseKitsFolder` does: `paths.ts` reads `WW_PRODUCTS_DIR` once,
 * at module load. Nothing is moved, so a wrong choice is undone by choosing again.
 */
ipcMain.handle("chooseProductsFolder", async (e): Promise<boolean> => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: PRODUCTS_DIR,
    message: "Where are the AI's Flipkart listing files (products-<ID>.json) kept?",
  });
  if (canceled || filePaths.length === 0) return false;
  await writeSettings({ products: filePaths[0] });
  app.relaunch();
  app.quit();
  return true;
});

ipcMain.handle("chooseWorkspace", async (e): Promise<boolean> => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: WORKSPACE,
    message: "Where should WishWorks keep its images and listing files?",
  });
  if (canceled || filePaths.length === 0) return false;
  await writeSettings({ workspace: filePaths[0] });
  app.relaunch();
  app.quit();
  return true;
});

// ---------------------------------------------------------------- window

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: "WishWorks",
    backgroundColor: "#12100f",
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // An ES-module preload cannot load in a sandboxed renderer, and this project is
      // "type": "module" throughout. contextIsolation still stands between the page and Node,
      // which is the boundary that matters — the renderer sees `window.ww` and nothing else.
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
}

/**
 * Auto-update, so shipping a fix stops being a courier job.
 *
 * Without this every fix is: download the CI artifact, upload it somewhere WhatsApp will accept,
 * talk somebody through SmartScreen again. With it, the app checks GitHub Releases on launch,
 * downloads in the background and installs on quit — the partner just has a current app.
 *
 * `checkForUpdatesAndNotify` is a no-op in development and in an unpackaged build, so there is
 * nothing to guard. It is also deliberately silent on failure: no releases yet, no network, or a
 * private repo all reject, and none of those are worth a dialog in front of somebody trying to
 * list a product. The update is a convenience — the app must work exactly as well without it.
 */
async function checkForUpdates(): Promise<void> {
  try {
    const { autoUpdater } = await import("electron-updater");
    await autoUpdater.checkForUpdatesAndNotify();
  } catch {
    /* offline, no release published yet, or no access — carry on */
  }
}

app.whenReady().then(() => {
  createWindow();
  void checkForUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

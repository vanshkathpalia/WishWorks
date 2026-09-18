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

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { readFile, writeFile, appendFile, mkdir, readdir, rename, rm, copyFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { filePathFromUrl } from "./shared.js";
import type { KitHealth as LatchKitHealth } from "../src/latch-core.js";
import type {
  Account, Attempt, CleanUp, ConvertResult, DefaultsTab, FolderKey, Row, StepId,
} from "./shared.js";

app.setName("WishWorks");

/**
 * `ww-file://` — how the renderer shows a picture that lives on this disk.
 *
 * **`file://` does not work and never did in development.** The renderer is served from
 * `http://localhost:5173` by the dev server, and a page on an http origin is not allowed to load
 * `file:///Users/…` — Chromium blocks it with *Not allowed to load local resource*. Every
 * thumbnail in the app was a broken-image icon and nothing said why (WW-177). Packaged it happens
 * to work, because there the page itself is a `file://` one, so the bug was invisible on exactly
 * the build nobody develops against.
 *
 * A scheme of our own is the fix Electron intends: registered as privileged and standard so an
 * `<img>` treats it like any other URL, and answered below by handing the real path to `net.fetch`.
 * It is no more powerful than what the renderer already has — every panel can already read and
 * write files through the channels in shared.ts — it just makes showing one possible.
 *
 * Must be called before `app.whenReady()`, which is why it sits at the top of the file.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: "ww-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const USER_DATA = app.getPath("userData");

/**
 * **Where the app hangs, written down instead of guessed.** Vansh, 2026-09-17: *"wishwork app hangs a
 * lot."* A sample of the main process showed seconds of our own JavaScript on the main thread — which
 * freezes the whole window — but JIT frames carry no names. This logs every freeze over 250ms to
 * `<userData>/slow.log` with the requests that started inside it, and any request over 2s.
 * ponytail: a diagnostic; take it out once the slow handlers are moved off the main thread.
 */
const SLOW_LOG = path.join(USER_DATA, "slow.log");
const slow = (line: string) =>
  void appendFile(SLOW_LOG, `${new Date().toISOString()} ${line}\n`).catch(() => {});
const started: { channel: string; at: number }[] = [];
const rawHandle = ipcMain.handle.bind(ipcMain);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron's own signature
ipcMain.handle = ((channel: string, fn: (...a: any[]) => unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawHandle(channel, async (...args: any[]) => {
    const at = performance.now();
    started.push({ channel, at });
    if (started.length > 50) started.shift();
    try {
      return await fn(...args);
    } finally {
      const ms = performance.now() - at;
      if (ms > 2000) slow(`request ${channel} took ${Math.round(ms)}ms`);
    }
  })) as typeof ipcMain.handle;
let tick = performance.now();
setInterval(() => {
  const now = performance.now();
  const lag = now - tick - 500;
  tick = now;
  if (lag < 250) return;
  const during = started.filter((s) => s.at >= now - lag - 600).map((s) => s.channel);
  slow(`main thread FROZEN ${Math.round(lag)}ms — started then: ${during.join(", ") || "(no request)"}`);
}, 500).unref();
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
  /** The people who pack, for ticking off a day's orders. Names only; no other state. */
  workers?: string[];
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
  /**
   * Where the converted images live, when it should NOT be inside the workspace.
   *
   * Same reasoning as `products` and `kits`: every folder the app writes to should be one the
   * user can point somewhere, because a folder nobody chose is a folder nobody can check.
   * This one is the big one — megabytes per listing — so it is also the one most likely to
   * belong on a different disk.
   */
  images?: string;
  /** Where the AI's Meesho copy (`<ID>.json`) is kept, when not inside the workspace. */
  meta?: string;
  /** Where the day's orders and the packer list are kept. Worth pointing at a synced folder. */
  orders?: string;
  /** Where finished images are written. The one folder meant to live in a shared Drive folder. */
  ready?: string;
  /**
   * The seller accounts this machine can work, and which one it is working (WW-154).
   *
   * An account's `workspace` outranks `workspace` above — it IS the workspace, for that account.
   * Empty or absent and nothing changes: the app behaves exactly as it did before accounts
   * existed, which is what every machine that never sets one up gets.
   */
  accounts?: Account[];
  activeAccount?: number;
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
/** The account being worked, or null when this machine has never set one up. */
function activeAccount(): Account | null {
  const s = readSettings();
  return s.accounts?.[s.activeAccount ?? 0] ?? null;
}

function storedWorkspace(): string {
  // An account's folder IS its workspace — that is the whole of the Drive integration (WW-154).
  const account = activeAccount();
  if (account?.workspace) return account.workspace;
  const w = readSettings().workspace;
  if (typeof w === "string" && w.length > 0) return w;
  return app.isPackaged
    ? path.join(USER_DATA, "workspace")
    : path.join(import.meta.dirname, "..", "..");
}

const WORKSPACE = storedWorkspace();

/**
 * The four folders the app writes to, each movable on its own.
 *
 * They all default inside the workspace, which is the right default — one folder to back up, one
 * to point at a new disk. But **every one of them has to be nameable and changeable**, because a
 * folder nobody chose is a folder nobody can check: that is exactly what WW-153 was, where
 * `<workspace>/products` was printed on no screen and "no file matches" could not be told apart
 * from "it is looking somewhere you have never seen". Vansh, 2026-08-15: *"for each saving either
 * it is about the ai gen images or json or final images or inventory json, we should be able to
 * select the folder where they get saved."*
 *
 * The finished images are the fifth, and they are already a per-step folder on the Finish panel.
 */
/**
 * One folder's path: **this account's own choice first**, then the machine-wide one, then the
 * default beside the workspace.
 *
 * The account comes first because two accounts on one machine do not share data — Vansh:
 * *"after logging in for my account, my folder details should stay diff then my partner's one"*.
 * The machine-wide layer is kept because it is what every existing settings file already holds,
 * and a machine with no accounts at all must keep behaving exactly as it did.
 */
function folderPath(key: FolderKey, fallback: string): string {
  const st = readSettings();
  return activeAccount()?.folders?.[key] || st[key] || fallback;
}

const IMAGES_DIR = folderPath("images", path.join(WORKSPACE, "images"));
process.env.WW_IMAGES_DIR ??= IMAGES_DIR;
const META_DIR = folderPath("meta", path.join(WORKSPACE, "image-meta"));
process.env.WW_META_DIR ??= META_DIR;
/** Settable on its own, like the kits — see Settings.products for why. */
const PRODUCTS_DIR = folderPath("products", path.join(WORKSPACE, "products"));
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
const KITS_DIR = folderPath("kits", path.join(WORKSPACE, "inventory"));
process.env.WW_KITS_DIR ??= KITS_DIR;


/**
 * A file per day of orders, plus the list of people who pack.
 *
 * **Settable, and it should usually be pointed at a synced folder.** Vansh, 2026-08-20: *"we will
 * maintain the data for that in our backend, that excel or whatever should be saved having backup
 * at Drive maybe — data should not be lost on app uninstall or delete."* Right, and it is the one
 * folder here that holds something no one can reconstruct: how many packets each person did, which
 * is what they are PAID on. A costed kit can be costed again and a listing can be written again;
 * a month of packing cannot be remembered.
 *
 * The packer list lives here too rather than in `settings.json`, for the same reason — settings
 * are machine state and go with the machine.
 */
const ORDERS_DIR = folderPath("orders", path.join(WORKSPACE, "orders"));
process.env.WW_ORDERS_DIR ??= ORDERS_DIR;
// Deliveries sit beside the packing, for the reason the rates and packers do: both are records of
// something that happened in the real world on a date, and both belong on the synced drive.
const STOCK_DIR = path.join(path.dirname(ORDERS_DIR), "stock");
// The latch record sits beside them for the same reason: it is what happened on a date, not
// machine state, and next month's label pack is only useful if this month's is still there.
process.env.WW_LATCH_DIR ??= path.join(path.dirname(ORDERS_DIR), "latch");
process.env.WW_STOCK_DIR ??= STOCK_DIR;

/**
 * Categories are the one WW_* dir that is NOT user state — they ship with the app.
 * `balloon-decoration.defaults.json` holds the shared answers `loadProduct()` merges under every
 * product, so pointed at an empty workspace folder it does not fail, it silently fills a form
 * with the defaults missing. Packaged it therefore reads the shipped copy (extraResources) and
 * updates with the app; only `npm run scan` writes here, and that is a CLI on Vansh's Mac.
 */
process.env.WW_CATEGORIES_DIR ??= app.isPackaged
  ? path.join(process.resourcesPath, "categories")
  // In development: the REPO's copy, never the workspace's. They are the same folder right up
  // until somebody signs in — an account gets a workspace of its own, which has no `categories/`
  // in it, and the price list then reads as 0 materials with every kit silently uncosted. That is
  // the failure this comment warned about, arriving the day logins landed (WW-177).
  : path.join(import.meta.dirname, "..", "..", "categories");

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
      mode !== "files"
        ? undefined
        : step === "orders"
          ? [{ name: "Manifest or orders export", extensions: ["pdf", "csv"] }]
          : step === "labels"
            ? [{ name: "Flipkart label pack", extensions: ["pdf"] }]
          : step === "orders-report"
            // Whatever the marketplace exports. Nothing here reads their columns — the ids are
            // found in the text — so the list is about what they hand out, not what we parse.
            ? [{ name: "Returns or RTO report", extensions: ["csv", "xlsx", "xls", "pdf", "txt"] }]
          : [{ name: "Images", extensions: [...INPUT_EXT].map((x) => x.slice(1)) }],
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
  const { costKit, extractJson, loadMaterials, readKitFile, resolvePicks } = await inventoryEngine();
  const json = extractJson(text);
  if (json === null) {
    return {
      ok: false,
      message: `Could not find any JSON in ${what}. Copy the whole reply from the chat — the \`\`\`json fence and any words around it are fine, but it has to contain the { … } block.`,
    };
  }
  const { sku, lines, picks } = readKitFile(json);
  if (lines.length === 0) {
    return {
      ok: false,
      message: `There are no item lines in ${what}. The reply should be a JSON object with a "lines" list in it.`,
    };
  }
  // A `pick` in the text is a correction someone already made, so it outranks nothing and is
  // outranked by nothing — there is only ever one of the two, because the panel passes no
  // overrides through this route. Merged rather than chosen between, so that stays true if it
  // ever does.
  const materials = loadMaterials();
  const corrections = { ...resolvePicks(picks, materials), ...(overrides ?? {}) };
  return { ok: true, result: costKit(lines, materials, corrections, sku) };
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
 * Correct a row in the price list — price, size, or both — for every kit costed from here on.
 *
 * **No longer refused on a packaged app.** It used to be, because `categories/` lives inside the
 * bundle and a silent no-op would look exactly like a saved change; the answer was to make the
 * write real rather than to keep saying no. The engine puts the correction in the list itself
 * where that is writable and beside the app's own data where it is not, and applies it either way
 * — so the partner can fix a size without it going out as a release (WW-179).
 */
ipcMain.handle(
  "editMaterial",
  async (
    _e,
    key: string,
    patch: {
      paise?: number | null; size?: string; material?: string;
      piecesPerPack?: number; category?: string; sellsAs?: string;
    },
  ): Promise<Attempt<unknown>> => {
    try {
      const result = (await inventoryEngine()).editMaterial(key, patch);
      await followTheKey(key, patch);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
);

/**
 * A renamed or moved material takes its KEY with it — so every saved kit has to follow.
 *
 * **This is the bug behind the worst hour of 2026-09-04.** A material's key is
 * `category|material`, and a saved kit's `overrides` and `prices` are keyed by it. Renaming a row
 * changed the key and left every kit that had picked that row pointing at a key nothing answers
 * to: the line stopped costing, which on screen looks *exactly* like the material having been
 * deleted — Vansh: *"the Age 2 got removed."* It was not removed; the pointer to it was.
 *
 * It surfaced as `No material called "2 age foil|Age Foil "Age 1"" in the price list`, which is a
 * dangling key being handed back to the engine. That message is now unreachable from this path.
 *
 * Renaming has kept the old name as an `aka` since WW-179, which is the same idea one level down —
 * the WORDS keep matching. Nobody had done it for the KEY, which is the half that machines use.
 */
async function followTheKey(oldKey: string, patch: { material?: string; category?: string }): Promise<void> {
  if (patch.material === undefined && patch.category === undefined) return;
  const [oldCategory, oldMaterial] = [oldKey.slice(0, oldKey.indexOf("|")), oldKey.slice(oldKey.indexOf("|") + 1)];
  const newKey = `${(patch.category ?? oldCategory).trim()}|${(patch.material ?? oldMaterial).trim()}`;
  if (newKey === oldKey) return;

  const { KITS_DIR } = await inventoryEngine();
  const files = await readdir(KITS_DIR).catch(() => [] as string[]);
  for (const name of files.filter((f) => f.endsWith(".json"))) {
    const file = path.join(KITS_DIR, name);
    const kit = JSON.parse(await readFile(file, "utf8")) as {
      overrides?: Record<string, string>;
      resolved?: Record<string, string>;
      prices?: Record<string, number>;
    };
    let moved = false;
    for (const [line, k] of Object.entries(kit.overrides ?? {})) {
      if (k === oldKey) { kit.overrides![line] = newKey; moved = true; }
    }
    // The saved resolution follows a rename exactly as a hand pick does — it is the same kind of
    // pointer, and freezing one that cannot follow would rot on the first rename.
    for (const [line, k] of Object.entries(kit.resolved ?? {})) {
      if (k === oldKey) { kit.resolved![line] = newKey; moved = true; }
    }
    if (kit.prices?.[oldKey] !== undefined) {
      kit.prices[newKey] = kit.prices[oldKey];
      delete kit.prices[oldKey];
      moved = true;
    }
    if (moved) await writeFile(file, `${JSON.stringify(kit, null, 2)}\n`);
  }
}

/** Add a material the list has never had. Writable everywhere now, same as `editMaterial`. */
/** Another colour of a row already on the list — a sibling, never a rename. See `addColour`. */
ipcMain.handle(
  "addColour",
  async (_e, key: string, colour: string): Promise<Attempt<unknown>> => {
    try {
      const { materials, name } = (await inventoryEngine()).addColour(key, colour);
      await followTheKey(key, {}); // no-op unless a future caller renames; kept for symmetry
      return { ok: true, result: materials, note: `${name} added beside it. Nothing was renamed.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
);

/** Another SIZE — price and pack size deliberately left blank, because size moves both. */
ipcMain.handle(
  "addSize",
  async (_e, key: string, size: string): Promise<Attempt<unknown>> => {
    try {
      const { materials, name } = (await inventoryEngine()).addSize(key, size);
      return {
        ok: true,
        result: materials,
        note: `${name} added with NO price — a bigger one costs more, so type what it costs.`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  "addMaterial",
  async (
    _e,
    row: {
      category: string;
      material: string;
      paise: number | null;
      size?: string;
      piecesPerPack?: number;
      /**
       * What the SUPPLIER called it, when that differs from the name being created.
       *
       * Vansh, 2026-09-14: *"I want to select its category and rename it to full Ring Foil."* The
       * new row should read `Ring Foil`; his note says `ring`, and unless that wording is kept as
       * an old name the very next note fails to match the row he just made.
       */
      says?: string;
    },
  ): Promise<Attempt<unknown>> => {
    try {
      const inv = await inventoryEngine();
      const result = inv.addMaterial(row);
      if (row.says && row.says.trim().toLowerCase() !== row.material.trim().toLowerCase()) {
        return { ok: true, result: inv.addAliases([{ material: row.material.trim(), says: row.says.trim() }]) };
      }
      return { ok: true, result };
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

/**
 * Save a kit — and when its SKU changed, MOVE it rather than leave the old file behind.
 *
 * The filename comes from the SKU, so renaming used to write a second kit and ask, in one line at the
 * bottom of a long screen, which was meant. Vansh, 2026-09-18, after renaming two: *"I saved those
 * kits… but when I opened them again they came with the previous name only."* He had reopened the old
 * copy, which was still in the list. A rename is a rename; `replace` is the file it came from.
 */
ipcMain.handle("saveKit", async (_e, kit: unknown, replace: string | null) => {
  const file = (await inventoryEngine()).saveKit(kit as never);
  if (replace && path.resolve(replace) !== path.resolve(file)) await rm(replace, { force: true }).catch(() => {});
  return file;
});
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
/**
 * Delete one saved kit — the second half of a rename, which writes the new name and then drops the
 * old one. Confined to a `.json` directly inside the kits folder: the renderer hands over a path,
 * and a path from the renderer is the one thing that must never be able to point at anything else.
 */
ipcMain.handle("deleteKit", async (_e, file: string) => {
  const { KITS_DIR } = await inventoryEngine();
  const target = path.resolve(file);
  if (path.dirname(target) !== path.resolve(KITS_DIR) || path.extname(target) !== ".json") return;
  await rm(target, { force: true });
});

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
// ---------------------------------------------------------------- the day's orders

const ordersEngine = () => import("../src/orders-core.js");

/**
 * Today, as this business counts it — the local calendar day, not UTC.
 *
 * Everything else here is UTC on purpose, but a packing day is a working day: before 5:30am in
 * India the UTC date is still yesterday, and crediting a morning's work to the day before is the
 * kind of error nobody spots until pay day.
 */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Everything the packing screen draws, computed here in one place.
 *
 * The renderer gets answers, not records: it has no business re-implementing what "outstanding"
 * or "this month's packets" mean, and one shape means one place for those definitions to live.
 * Every action below returns this same view, so the screen never has to ask twice.
 */
async function ordersView(on = today()) {
  const { listLedgers, listDays, outstanding, parcelCredit, daySummary, workerCredit } = await ordersEngine();
  const ledgers = await listLedgers();
  const month = on.slice(0, 7);

  // Pay counts the old per-day files too. They are the fortnight before the ledger existed, they
  // are somebody's actual work, and dropping them from a month's total would be a silent pay cut.
  const days = (await listDays()).filter((d) => d.date.startsWith(month));
  const credit = { ...parcelCredit(ledgers, month) };
  for (const [who, n] of Object.entries(workerCredit(days))) credit[who] = (credit[who] ?? 0) + n;

  return {
    today: on,
    outstanding: outstanding(ledgers.flatMap((l) => l.subOrders))
      .map(({ sku, qty, byMarket, byDay, oldest }) => ({ sku, qty, byMarket, byDay, oldest })),
    summary: daySummary(ledgers, on),
    monthPay: Object.entries(credit)
      .map(([name, qty]) => ({ name, qty: Number(qty.toFixed(2)) }))
      .sort((a, b) => b.qty - a.qty),
    sources: ledgers.flatMap((l) => l.sources),
    /** Days with something packed, newest first — for looking back at a summary. */
    packedDays: [...new Set(ledgers.flatMap((l) => l.subOrders.map((p) => p.packedOn).filter(Boolean)))]
      .sort()
      .reverse() as string[],
  };
}

/**
 * Read a manifest PDF into the month it belongs to.
 *
 * **Parcels, not totals.** Every parcel carries Meesho's own sub-order number, so a manifest
 * re-downloaded an hour later — which lists everything still to ship, including what was already
 * there — adds only what is genuinely new. See `mergeShipments`.
 */
ipcMain.handle("addManifest", async (_e, file: string): Promise<Attempt<unknown>> => {
  const engine = await ordersEngine();
  const { parseManifest, mergeShipments, readLedger, writeLedger } = engine;

  /**
   * An ORDERS EXPORT rather than a manifest — the same drop zone, because to the person holding
   * the file they are the same errand: *tell the app what went out.*
   *
   * It is the way back from missed days, and it says more than a manifest can: which parcels were
   * DELIVERED, which came back, which the marketplace CANCELLED, and what each one actually paid.
   * A cancelled row does not arrive, it LEAVES — see `mergeOrdersCsv`.
   *
   * Rows are split by month because a ledger is a month, and an export spans whatever range was
   * asked for; a single file crossing a month boundary would otherwise land entirely in the first.
   */
  if (file.toLowerCase().endsWith(".csv")) {
    const rows = engine.readOrdersCsv(await readFile(file, "utf8"));
    if (rows.length === 0) return { ok: false, message: `No orders found in ${path.basename(file)}.` };
    const months = [...new Set(rows.map((r) => r.on.slice(0, 7)))].filter(Boolean).sort();
    let added = 0, packed = 0, back = 0, cancelled = 0;
    for (const month of months) {
      const mine = rows.filter((r) => r.on.slice(0, 7) === month);
      const r = engine.mergeOrdersCsv(await readLedger(month), mine, path.basename(file));
      await writeLedger(r.ledger);
      added += r.added; packed += r.packed; back += r.back; cancelled += r.cancelled;
    }
    return {
      ok: true,
      result: await ordersView(),
      note:
        `${added} new parcel${added === 1 ? "" : "s"} from ${path.basename(file)}` +
        `${packed ? `, ${packed} marked packed` : ""}` +
        `${back ? `, ${back} marked RTO` : ""}` +
        `${cancelled ? `, ${cancelled} cancelled and removed` : ""}.`,
    };
  }


  const parsed = parseManifest(await readFile(file));
  if (parsed.shipments.length === 0) {
    return {
      ok: false,
      message: parsed.rows.length > 0
        ? `${path.basename(file)} has the SKU totals but not the parcel pages, so there is no way to tell its orders from ones already read. Download the full manifest.`
        : `No orders found in ${path.basename(file)} — is that the supplier manifest?`,
    };
  }
  const seen = parsed.date ?? today();
  const month = seen.slice(0, 7);
  await writeLedger(mergeShipments(await readLedger(month), parsed.shipments, seen, path.basename(file)));
  return { ok: true, result: await ordersView() };
});

ipcMain.handle("orders", () => ordersView());

// ---------------------------------------------------------------- latching

const latchEngine = () => import("../src/latch-core.js");

/**
 * A tab in the seller app, but only when a tab ALREADY OPEN shows the logged-in dashboard.
 *
 * **Asking must not load anything.** Three versions of this evening's fix loaded the dashboard to
 * find out, and a logged-out dashboard does not sit on a login page — it bounces between
 * `#dashboard/home-page` and `/?referral_url=…` every few seconds, which is the flicker and the
 * CPU (C-080, C-082). Vansh: *"don't make my computer sick dude."* So this only reads the URLs of
 * tabs that are open anyway, twice 3s apart (a bouncing tab reads logged in half the time), and
 * refuses before a single tab is opened. Logging in is the Flipkart button's job, where a person
 * is watching.
 */
async function sellerTab(): Promise<Attempt<import("playwright").Page>> {
  const { newTab, openTabs } = await import("../src/browser-core.js");
  const { looksLoggedIn } = await import("../src/connect.js");
  const signedIn = () => {
    const seller = openTabs().filter((p) => p.url().includes("seller.flipkart.com"));
    return seller.some(looksLoggedIn) && !seller.some((p) => p.url().includes("referral_url"));
  };
  const refuse = {
    ok: false as const,
    message:
      "Not logged in to Flipkart Seller, so nothing was opened. Press \"Log in to Flipkart\" (bottom left), " +
      "wait until the dashboard shows in Chrome, then press this again.",
  };
  if (!signedIn()) return refuse;
  await new Promise((r) => setTimeout(r, 3000));
  if (!signedIn()) return refuse;
  try {
    return { ok: true, result: await newTab() };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read a label pack into the latch list.
 *
 * The same pack twice changes nothing and next month's adds only what is new — the SKU is the
 * identity, so an FSN already found and a latch already done both survive a re-read.
 */
ipcMain.handle("addLabels", async (_e, file: string): Promise<Attempt<unknown>> => {
  const { readLabels, readLatches, writeLatches, mergeLabels } = await latchEngine();
  let items;
  try {
    items = readLabels([file]);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (items.length === 0) {
    return { ok: false, message: `No SKUs found in ${path.basename(file)} — is that a Flipkart label pack?` };
  }
  const { book, added } = mergeLabels(await readLatches(), items, path.basename(file));
  await writeLatches(book);
  return {
    ok: true,
    result: book,
    note:
      `${items.length} product${items.length === 1 ? "" : "s"} in ${path.basename(file)}` +
      `, ${added} of them new. Check them against Flipkart to see which can still be latched.`,
  };
});

/**
 * The costing JSON out of this kit's own ChatGPT chat, with OUR SKU written into it.
 *
 * Vansh, 2026-09-18, on the Costing screen's paste box: *"this redirect will be really useful only
 * when it would fill this session… from the automated ChatGPT's JSON, and storing that SKU name at
 * the appropriate place at top of this JSON."* The chat is opened by the address saved when it was
 * sent — no searching the sidebar — and nothing is sent or changed in it.
 */
ipcMain.handle("costingReply", async (_e, sku: string): Promise<Attempt<string>> => {
  const { readLatches } = await latchEngine();
  const { normalizeId } = await import("../src/id.js");
  const row = (await readLatches()).rows.find(
    (r) => r.ourSku && normalizeId(r.ourSku) === normalizeId(sku) && r.costingChatUrl,
  );
  if (!row?.costingChatUrl) return { ok: false, message: "" }; // no chat for it; the box stays empty
  const { chatTab } = await import("../src/browser-core.js");
  const { lastReply, jsonFromReply } = await import("../src/chat-core.js");
  let tab;
  try {
    tab = await chatTab();
    await tab.goto(row.costingChatUrl, { waitUntil: "domcontentloaded" });
    await tab.waitForTimeout(6000);
    const data = jsonFromReply(await lastReply(tab));
    if (data === null) return { ok: false, message: "That chat has no JSON reply yet — send it, then try again." };
    // Our SKU goes in at the top, where the Costing screen reads it from.
    const kit = { ...(data as Record<string, unknown>), sku: row.ourSku };
    return { ok: true, result: JSON.stringify(kit, null, 2), note: `Read from ${row.ourSku}'s costing chat.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await tab?.close().catch(() => {});
  }
});

/** Put a turned-down product back in the queue — it was a wrong shortlist, not a decision. */
ipcMain.handle("showAgain", async (_e, fsn: string): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches } = await latchEngine();
  const book = await readLatches();
  const row = book.rows.find((r) => r.fsn === fsn);
  if (!row) return { ok: false, message: "That product is not in your latch list." };
  delete row.turnedDownOn;
  await writeLatches(book);
  return { ok: true, result: book, note: `${row.title?.slice(0, 60) ?? fsn} is back in the queue.` };
});

ipcMain.handle("latches", async () => {
  // A kit that became final since last time takes its photos with it, quietly.
  await graduateFolders().catch(() => 0);
  return (await latchEngine()).readLatches();
});

/**
 * Park EVERY product page open in Chrome until its stock arrives — or, with `fsn`, un-park that one.
 *
 * Every open page, not the one in front: Vansh, 2026-09-17, *"these can be many — all of the present
 * open ones I want in the list; otherwise for a single one I can just copy the link somewhere."* It
 * also cannot hit "more than one window is showing a product", which the front-tab version did.
 * Products opened by hand join the list first; one already latched is left alone.
 */
ipcMain.handle("saveForLater", async (_e, unpark: string | null): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, adoptOpened, todayStamp } = await latchEngine();
  const book = await readLatches();
  if (unpark) {
    const row = book.rows.find((r) => r.fsn === unpark);
    if (!row) return { ok: false, message: "That product is not in your latch list." };
    delete row.laterOn;
    await writeLatches(book);
    return { ok: true, result: book, note: `${row.title?.slice(0, 60) ?? unpark} is back in the list.` };
  }
  const pages = await openProducts();
  if (pages.length === 0) return { ok: false, message: "No Flipkart product page is open in Chrome." };
  const { book: next, added } = adoptOpened(book, pages);
  const open = new Set(pages.map((p) => p.fsn));
  let saved = 0;
  let latched = 0;
  for (const row of next.rows) {
    if (!row.fsn || !open.has(row.fsn)) continue;
    if (row.latchedOn) latched++;
    else if (!row.laterOn) {
      row.laterOn = todayStamp();
      saved++;
    }
  }
  await writeLatches(next);
  return {
    ok: true,
    result: next,
    note:
      `Saved ${saved} of ${pages.length} open product page${pages.length === 1 ? "" : "s"} for later` +
      (added ? ` (${added} new to the list)` : "") +
      (latched ? `; ${latched} already latched, left alone` : "") +
      `. You can close those tabs now.`,
  };
});

/**
 * Record the approval form for one product — a pasted link or FSN, or the product tab in front.
 * LOOKING ONLY: see `recordApprovalForm`. Writes `latch/approval/<FSN>.json` and screenshots, and leaves
 * the tab open for a person to look at too.
 */
ipcMain.handle("recordApproval", async (_e, pasted: string): Promise<Attempt<unknown>> => {
  const { recordApprovalForm, frontLatchTab, latchDir } = await latchEngine();
  let fsn = /[?&](?:pid|fsn)=([A-Z0-9]+)/i.exec(pasted)?.[1] ?? (/^[A-Z0-9]{16}$/i.test(pasted.trim()) ? pasted.trim() : null);
  if (!fsn) {
    const { openTabs } = await import("../src/browser-core.js");
    const tabs = await Promise.all(
      openTabs().map(async (page) => ({
        page,
        url: page.url(),
        visible: await page.evaluate(() => document.visibilityState === "visible").catch(() => false),
      })),
    );
    const front = frontLatchTab(tabs);
    if (!front.ok) return { ok: false, message: pasted.trim() ? "No product code in that link." : front.message };
    fsn = front.fsn;
  }
  const tab = await sellerTab();
  if (!tab.ok) return tab;
  const dir = path.join(latchDir(), "approval");
  await mkdir(dir, { recursive: true });
  const found = await recordApprovalForm(tab.result, fsn.toUpperCase(), (n) => path.join(dir, `${fsn!.toUpperCase()}-${n}.png`));
  const file = path.join(dir, `${found.fsn}.json`);
  await writeFile(file, `${JSON.stringify(found, null, 2)}\n`);
  if (found.card !== "approval") {
    return { ok: false, message: `Not an approval product — Flipkart's card says "${found.card}". Recorded anyway: ${file}` };
  }
  return {
    ok: true,
    result: found,
    note:
      `Recorded ${found.fsn}: ${found.documentOptions.length ? `document choices — ${found.documentOptions.join(" · ")}` : "no document dropdown options read"}; ` +
      `${found.selects.length} dropdown(s), ${found.checkboxes.length} tick box(es). Nothing was submitted. Saved to ${file}`,
  };
});

/**
 * Open the approval form of every approval product still open in Chrome — or of `only` — for a person
 * to press Apply. The approval twin of "Latch the ones still open".
 *
 * Reads each form's document choices on the way (`recordApprovalForm`, never selecting or submitting),
 * **closes the forms that only take a trademark or brand letter**, and leaves the rest open. Opening a
 * form creates a Draft in Track Approval, which is why this only runs on products a person kept open.
 */
ipcMain.handle("approvalOpen", async (e, pack: string | null, only: string[] | null): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, recordApprovalForm, approvalEase, survivors, adoptOpened, latchDir, todayStamp } =
    await latchEngine();
  const { openTabs, newTab } = await import("../src/browser-core.js");
  let book = await readLatches();
  let keep: string[];
  if (only) keep = only;
  else if (approvalBatch.length) {
    keep = survivors(approvalBatch, openTabs().map((t) => t.url()));
    await turnDown(approvalBatch.filter((f) => !keep.includes(f)));
  } else {
    book = adoptOpened(book, await openProducts()).book;
    const candidates = book.rows.filter((r) => r.state === "approval" && r.fsn && !r.approvalOpenedOn).map((r) => r.fsn!);
    keep = survivors(candidates, openTabs().map((t) => t.url()));
  }
  void pack; // the batch was already drawn from the selected pack
  if (keep.length === 0) {
    approvalBatch = [];
    return { ok: false, message: 'No approval product page is open — press "Show me the next 10 approval products" first.' };
  }
  const probe = await sellerTab();
  if (!probe.ok) return probe;
  await probe.result.close().catch(() => {});

  const dir = path.join(latchDir(), "approval");
  await mkdir(dir, { recursive: true });
  const tally = { easy: 0, hard: 0, unknown: 0 };
  let done = 0;
  for (const fsn of keep) {
    const row = book.rows.find((r) => r.fsn === fsn);
    if (!row) continue;
    const tab = await newTab();
    const before = new Set(tab.context().pages());
    const found = await recordApprovalForm(tab, fsn, (n) => path.join(dir, `${fsn}-${n}.png`)).catch(() => null);
    done++;
    if (found) {
      await writeFile(path.join(dir, `${fsn}.json`), `${JSON.stringify(found, null, 2)}\n`);
      if (found.card === "approval") {
        row.approvalDocs = found.documentOptions;
        row.approvalAsksDocument = found.asksForDocument;
        row.approvalUrl = found.url;
        row.approvalOpenedOn = todayStamp();
        row.laterOn = undefined;
        tally[approvalEase(found.documentOptions, found.asksForDocument)]++;
      } else row.state = found.card; // Flipkart's answer changed since the last check.
    }
    // Every form is closed once read. Applying is by hand and one at a time, from the list — Vansh:
    // *"I don't want any automation there, just searching these types of listings."*
    for (const p of tab.context().pages()) if (p === tab || !before.has(p)) await p.close().catch(() => {});
    e.sender.send("latchRow", { done, of: keep.length, row });
    await writeLatches(book);
  }
  approvalBatch = [];
  return {
    ok: true,
    result: book,
    note:
      `Read ${done}: ${tally.easy} you can apply for — listed under "Approval — you can apply"; ` +
      `${tally.hard} take only a trademark or brand letter` +
      (tally.unknown ? `; ${tally.unknown} whose document choices could not be read (see latch/approval/)` : "") +
      `. All forms closed; each is a Draft in Track Approval until you apply.`,
  };
});

/** Open ONE product's approval form, for a person to fill in and apply. Nothing is filled. */
ipcMain.handle("openApprovalForm", async (_e, fsn: string): Promise<Attempt<unknown>> => {
  const { readLatches, startSellingUrl } = await latchEngine();
  const row = (await readLatches()).rows.find((r) => r.fsn === fsn);
  if (!row) return { ok: false, message: "That product is not in your latch list." };
  const { newTab } = await import("../src/browser-core.js");
  const tab = await newTab();
  await tab.goto(row.approvalUrl ?? startSellingUrl(fsn), { waitUntil: "domcontentloaded" }).catch(() => {});
  return {
    ok: true,
    result: null,
    note: row.approvalUrl
      ? "Approval form open in Chrome. Pick the document, upload, Apply — then press \"I applied\" here."
      : "Its Start Selling page is open — press APPLY FOR APPROVAL there, then \"I applied\" here when done.",
  };
});

/**
 * Record that a person applied for this approval, give the product its SKU, and open its costing chat.
 *
 * The kit is costed now rather than when the approval is accepted, so that on acceptance the price and
 * the listing are ready — the inventory JSON is the slow half. The SKU is chosen the same way latching
 * chooses one and never replaced if the product already has one.
 */
ipcMain.handle("markApplied", async (_e, fsn: string, withCosting: boolean): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, todayStamp } = await latchEngine();
  const { nextSku } = await import("../src/sku-core.js");
  const book = await readLatches();
  const row = book.rows.find((r) => r.fsn === fsn);
  if (!row) return { ok: false, message: "That product is not in your latch list." };
  row.appliedOn = todayStamp();
  row.ourSku ??= nextSku(row.title ?? row.description, await skusInUse().catch(() => [])) ?? undefined;
  await writeLatches(book);
  let chat = "";
  if (withCosting) {
    const prompt = await (await promptsEngine()).readPrompt(promptDirs(), "PROMPT-inventory.md").then((p) => p.text, () => null);
    if (prompt) {
      const { newTab } = await import("../src/browser-core.js");
      const shelf = await newTab();
      row.costingChat = await costingChatFor(row, shelf, prompt, true);
      await shelf.close().catch(() => {});
      await writeLatches(book);
      chat = row.costingChat === "ready" ? " Its costing chat is open in ChatGPT — check the photo, press Enter." : ` No costing chat: ${row.costingChat}.`;
    }
  }
  return {
    ok: true,
    result: book,
    note: `Marked applied: ${row.title?.slice(0, 50) ?? fsn}${row.ourSku ? `, SKU ${row.ourSku}` : " — no SKU could be worked out, type one"}.${chat}`,
  };
});

/** Open a product's shopper page in the app's Chrome — for a parked product whose stock has come. */
ipcMain.handle("openProduct", async (_e, fsn: string): Promise<Attempt<string>> => {
  const { readLatches, productPage } = await latchEngine();
  const row = (await readLatches()).rows.find((r) => r.fsn === fsn);
  const url = row ? productPage(row) : null;
  if (!url) return { ok: false, message: "No product page for that one." };
  const { newTab } = await import("../src/browser-core.js");
  const tab = await newTab();
  await tab.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  return { ok: true, result: url };
});

/** Put a product's shopper link on the clipboard. */
ipcMain.handle("copyProductLink", async (_e, fsn: string): Promise<string | null> => {
  const { readLatches, productPage } = await latchEngine();
  const row = (await readLatches()).rows.find((r) => r.fsn === fsn);
  const url = row ? productPage(row) : null;
  if (url) clipboard.writeText(url);
  return url;
});

/** Latch one product from the list — the parked one whose stock has arrived. */
ipcMain.handle("latchOne", (e, fsn: string, withCosting: boolean) => latchThese(e, [fsn], withCosting, ""));

/**
 * Sweep a search term for latchable products, for up to `minutes`.
 *
 * The stop flag is a module-level boolean rather than anything cleverer because there is exactly
 * one sweep at a time — it drives the one Chrome session, so a second would be fighting it for the
 * same tab.
 */
let stopSweep = false;
ipcMain.handle("stopCrawl", () => void (stopSweep = true));

/**
 * Read a list somebody sent us back in.
 *
 * The receiving end of `shareLatches`. Nothing is checked here: the products land as "not checked
 * yet" and the ordinary Check button asks Flipkart about them **on this machine's account**, which
 * is the entire point — the sender's answers were about the sender's account.
 */
ipcMain.handle("importShared", async (_e, text: string): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, parseSharedList, mergeShared } = await latchEngine();
  const items = parseSharedList(text ?? "");
  if (items.length === 0) {
    return {
      ok: false,
      message: "No products in that. Paste the whole message — each line needs its [FSN] code.",
    };
  }
  const { book, added } = mergeShared(await readLatches(), items);
  await writeLatches(book);
  return {
    ok: true,
    result: book,
    note:
      `${items.length} product${items.length === 1 ? "" : "s"} read, ${added} new to you. ` +
      `Now press Check — their answers were about their account, not yours.`,
  };
});

/**
 * Lift our own SKUs out of the latch tabs still open in Chrome, and say what is still unpriced.
 *
 * One call because they are one errand: the SKUs are what make the pending list possible at all,
 * and reading them is free while the tabs are there. Nothing fails if they are closed — those rows
 * simply stay "SKU not known yet", which is a state the screen shows rather than an error.
 */
/**
 * Pieces left on the shelf, by material, for anything that can be answered honestly.
 *
 * The same arithmetic the Raw stock panel shows, reduced to the one question the latch queue asks:
 * *is there any of this in the room?* Rows the note counted in packets with no known pack size are
 * LEFT OUT rather than guessed at — `onHand` refuses to compute `left` for those, and a missing
 * answer must not read as zero when the queue's whole job is to flag zeroes.
 */
async function shelfLeft(): Promise<Map<string, number>> {
  const stock = await stockEngine();
  const orders = await ordersEngine();
  const { listKits, loadMaterials, KITS_DIR: KD } = await inventoryEngine();

  const deliveries = await stock.listDeliveries();
  const from = stock.firstDelivery(deliveries);
  const materials = loadMaterials();
  const names = new Map(materials.map((m) => [`${m.category}|${m.material}`, m.material]));
  const perPack = new Map(
    materials.filter((m) => m.packOf).map((m) => [`${m.category}|${m.material}`, m.packOf!]),
  );
  const used = new Map<string, { pieces: number; perWeek: number }>();
  if (from !== null) {
    const ledgers = await orders.listLedgers();
    const day = new Date().toISOString().slice(0, 10);
    for (const b of orders.howItSells(ledgers, listKits(KD, materials), from, day).burn) {
      used.set(b.key, { pieces: b.pieces, perWeek: b.piecesPerWeek });
    }
  }
  const out = new Map<string, number>();
  for (const row of stock.onHand(deliveries, used, names, perPack)) {
    if (!row.needsPackSize) out.set(row.key, row.left);
  }
  return out;
}

ipcMain.handle("latchPending", async (): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, readOurSkus, pendingPrices, toPause, blocking } =
    await latchEngine();
  const { openTabs } = await import("../src/browser-core.js");
  const book = await readLatches();

  const found = await readOurSkus(openTabs()).catch(() => ({}) as Record<string, string>);
  let picked = 0;
  for (const [fsn, sku] of Object.entries(found)) {
    const row = book.rows.find((r) => r.fsn === fsn);
    if (row && row.ourSku !== sku) {
      row.ourSku = sku;
      picked++;
    }
  }
  if (picked) await writeLatches(book);

  /**
   * Where the three engines meet, and the only place they do.
   *
   * A latch row knows the other seller's SKU; a costing knows ours; the shelf knows materials.
   * Joining them here keeps `latch-core` ignorant of kits and `inventory-core` ignorant of
   * latching — each stays testable alone, and the join is one function with a name.
   *
   * **The shelf is why this is worth the trouble.** A latched listing is live and can take an
   * order tonight; if its kit needs a material we have none of, the choice is a cancellation —
   * which costs account health — or a scramble. That belongs at the top of the queue, above
   * anything that merely needs a price signed off.
   */
  const inv = await inventoryEngine();
  const materials = inv.loadMaterials();
  const kits = inv.listKits(KITS_DIR, materials);
  const shelf = await shelfLeft().catch(() => new Map<string, number>());

  const health = new Map<string, LatchKitHealth>();
  for (const row of kits) {
    const saved = inv.readKit(row.file);
    const costed = inv.costKit(
      saved.lines, materials, saved.overrides, saved.sku, saved.prices, saved.counts, saved.resolved,
    );
    health.set(row.sku, {
      costed: true,
      confirmed: !!saved.confirmedAt,
      unmatched: costed.unmatched,
      flagged: costed.flagged,
      lines: costed.lines.length,
      // None on the shelf, or never seen there at all. To somebody packing an order tonight those
      // are the same fact: it is not in the room.
      short: (row.materials ?? [])
        .filter((m) => {
          const on = shelf.get(m.key);
          return on === undefined || on <= 0;
        })
        .map((m) => m.name),
    });
  }

  const rows = pendingPrices(book, health);
  return {
    ok: true,
    result: { rows, book, pause: toPause(rows), blocking: blocking(rows) },
    note: picked ? `Picked up ${picked} SKU${picked === 1 ? "" : "s"} from the open tabs.` : undefined,
  };
});

/**
 * The batch currently under review: the FSNs whose shopper pages were opened for a look.
 *
 * Module-level because there is exactly one batch at a time — it is a person looking at ten tabs in
 * one Chrome window, and a second batch would be fighting the first for the same window. Also
 * Turning one down is written to the LIST (`turnedDownOn`), not kept here: the app restarts and a
 * memory of what was rejected would be lost, so the same products came back around (2026-09-18).
 */
let batch: string[] = [];
/** Write "turned down today" onto these products, so no later batch offers them again. */
async function turnDown(fsns: string[]): Promise<void> {
  if (fsns.length === 0) return;
  const { readLatches, writeLatches, todayStamp } = await latchEngine();
  const book = await readLatches();
  let touched = 0;
  for (const row of book.rows) {
    if (row.fsn && fsns.includes(row.fsn) && !row.turnedDownOn) {
      row.turnedDownOn = todayStamp();
      touched++;
    }
  }
  if (touched) await writeLatches(book);
}
/** The same, for approval products under review — a separate batch, so the two flows never mix. */
let approvalBatch: string[] = [];

/**
 * Open the next ten as ORDINARY shopper pages, for a look before anything is listed.
 *
 * Not the start-selling form: the point is to see the product the way a buyer does — photos,
 * price, ratings — and decide whether it is worth selling at all. The form comes after, and only
 * for the ones whose tab is still open.
 */
ipcMain.handle("showBatch", async (_e, size: number, pack: string | null, kind: "form" | "approval" = "form"): Promise<Attempt<unknown>> => {
  const { readLatches, nextBatch, productPage } = await latchEngine();
  const { newTab, openTabs } = await import("../src/browser-core.js");
  /**
   * **Asking again means none of these.** Vansh, 2026-09-17, on approval products: *"keep it 3 for them,
   * and another next 3 button if none was liked."* The batch still under review is turned down and its
   * pages closed, so the next press shows three new ones instead of the same three.
   */
  const current = kind === "form" ? batch : approvalBatch;
  if (current.length) {
    await turnDown(current);
    for (const t of openTabs()) if (current.some((f) => t.url().includes(`pid=${f}`))) await t.close().catch(() => {});
  }
  const rows = nextBatch(await readLatches(), size || 10, new Set(), pack ?? null, kind);
  if (rows.length === 0) {
    return {
      ok: false,
      message: pack
        ? `Nothing left to look at in ${pack} — check it against Flipkart first, or pick another list.`
        : "Nothing left to look at — sweep for more, or read a label pack.",
    };
  }
  for (const r of rows) {
    const tab = await newTab();
    // The shopper's page, never the latch form — see `productPage`.
    await tab.goto(productPage(r)!, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  if (kind === "form") batch = rows.map((r) => r.fsn!);
  else approvalBatch = rows.map((r) => r.fsn!);
  return {
    ok: true,
    result: rows.map((r) => ({ fsn: r.fsn, title: r.title ?? r.description, listed: r.listed ?? null })),
    note:
      `${rows.length} open in Chrome. Close the tabs for the ones you do not want, then press ` +
      (kind === "form" ? `"Latch the ones still open".` : `"Open approval forms for the ones still open".`),
  };
});

/**
 * Latch whichever of the batch is still open, and remember the rest as turned down.
 *
 * The tabs are read BEFORE anything is opened, because latching opens tabs of its own and they
 * would otherwise count themselves as survivors.
 */
ipcMain.handle("latchOpen", async (e, withCosting: boolean): Promise<Attempt<unknown>> => {
  const { survivors, readLatches } = await latchEngine();
  const { openTabs } = await import("../src/browser-core.js");
  /**
   * **The batch is only a memory, and memories get lost** — an app restart, or the last latch run
   * finishing, empties it while the product pages are still open in Chrome. Then the button
   * flipped back to "Show me the next 10" and the open pages could not be latched at all. Without
   * a batch, every open product page of something still latchable counts instead.
   */
  if (batch.length === 0) {
    // Products opened by hand join the list first, so a page from no pack or hunt can be latched.
    const { writeLatches, adoptOpened } = await latchEngine();
    const adopted = adoptOpened(await readLatches(), await openProducts());
    if (adopted.added) await writeLatches(adopted.book);
    const latchable = adopted.book.rows
      .filter((r) => (r.state === "form" || r.state === "unknown") && r.fsn && !r.latchedOn)
      .map((r) => r.fsn!);
    const open = survivors(latchable, openTabs().map((t) => t.url()));
    if (open.length === 0) {
      return { ok: false, message: 'No latchable product page is open in Chrome — open one, or press "Show me the next 10".' };
    }
    return latchThese(e, open, withCosting, `${open.length} open${adopted.added ? `, ${adopted.added} new to the list` : ""}.`);
  }
  const keep = survivors(batch, openTabs().map((t) => t.url()));
  // Shown and closed is a decision: do not offer them again when he asks for the next ten.
  await turnDown(batch.filter((f) => !keep.includes(f)));
  const reviewed = batch.length;
  if (keep.length === 0) {
    batch = [];
    return { ok: true, result: await readLatches(), note: `All ${reviewed} closed — none latched. Ask for the next ten.` };
  }
  const r = await latchThese(e, keep, withCosting, `${keep.length} of ${reviewed} kept.`);
  // A refused run (logged out) keeps the batch, so pressing again after logging in still works.
  if (r.ok) batch = [];
  return r;
});

/** Every approval request on the account, read off Flipkart's own Track Approval page. */
ipcMain.handle("approvals", async (): Promise<Attempt<unknown>> => {
  const { readApprovals } = await latchEngine();
  const tab = await sellerTab();
  if (!tab.ok) return tab;
  const page = tab.result;
  const rows = await readApprovals(page).catch(() => []);
  await page.close().catch(() => {});
  return rows.length
    ? { ok: true, result: rows }
    : { ok: false, message: "No approval requests found — are you logged in to Flipkart?" };
});

/**
 * Sweep every brand we have been approved for, so the approval turns into listable products.
 *
 * This is the answer to "one click for all the approved ones". Flipkart's own `Add Listings`
 * button cannot do it — it drops the brand filter on the first re-render (see `approvedBrands`) —
 * and the page it aims at is our own drafts rather than the catalog. What an approval unlocks is
 * every catalog product of that brand, and those are reached by searching the brand name, which is
 * the sweep that already exists.
 *
 * The clock is split evenly across the brands so twelve of them cannot spend the whole budget on
 * the first.
 */
ipcMain.handle("sweepApproved", async (e, minutes: number): Promise<Attempt<unknown>> => {
  const { readApprovals, approvedBrands } = await latchEngine();
  const tab = await sellerTab();
  if (!tab.ok) return tab;
  const brands = approvedBrands(await readApprovals(tab.result).catch(() => [])).map((a) => a.brand);
  await tab.result.close().catch(() => {});
  if (brands.length === 0) return { ok: false, message: "Nothing is approved yet, or Flipkart did not answer." };
  return sweepBrands(e, brands, minutes, "approved brand");
});

/**
 * Sweep brands typed by hand — sellers whose products show START SELLING with no approval at all.
 * Vansh, 2026-09-17: *"I would like to see these for all those sellers that don't want any approval
 * from me — like Dream Aura, Partyfox, and some of Fundots."*
 */
ipcMain.handle("sweepBrandsTyped", async (e, typed: string, minutes: number): Promise<Attempt<unknown>> => {
  const { neverSweep } = await latchEngine();
  const brands = [...new Set(typed.split(/[,\n]/).map((b) => b.trim()).filter(Boolean))];
  const skipped = brands.filter(neverSweep);
  const todo = brands.filter((b) => !neverSweep(b));
  if (todo.length === 0) {
    return { ok: false, message: skipped.length ? `${skipped.join(", ")} is never swept.` : "Type one or more brand names, separated by commas." };
  }
  const tab = await sellerTab();
  if (!tab.ok) return tab;
  await tab.result.close().catch(() => {});
  return sweepBrands(e, todo, minutes, "brand");
});

/**
 * One sweep over several brands: each in a FRESH tab, kept to that brand's own products, and one
 * crashed tab costs one brand's remaining pages — not the run.
 *
 * All three were learnt on 2026-09-17's approved-brand sweep: a single tab reused for half an hour
 * crashed ("Aw, Snap!") on Anita Enterprises' page 3 and the whole run stopped, losing that brand and
 * never reaching three more; and without the brand filter a brand's search pulled in other brands'
 * products (BEST WISHES: 112 of 134 "needs approval"). The progress line counts the WHOLE run — it
 * used to show one brand's "looked at" beside every brand's "can be latched".
 */
async function sweepBrands(
  e: Electron.IpcMainInvokeEvent,
  brands: string[],
  minutes: number,
  kind: string,
): Promise<Attempt<unknown>> {
  const { readLatches, writeLatches, crawlSearch, mergeFound, LoggedOut } = await latchEngine();
  const { newTab } = await import("../src/browser-core.js");
  stopSweep = false;
  const each = (Math.max(1, minutes) * 60_000) / brands.length;
  let book = await readLatches();
  let total = 0;
  let canLatch = 0;
  let loggedOut = false;
  const crashed: string[] = [];
  for (const brand of brands) {
    if (stopSweep || loggedOut) break;
    const page = await newTab();
    const base = total;
    const found = await crawlSearch(page, brand, {
      until: Date.now() + each,
      brand,
      known: new Set(book.rows.map((r) => r.fsn).filter((f): f is string => !!f)),
      stopped: () => stopSweep,
      onFound: (f, seen) => e.sender.send("crawlRow", { seen: base + seen, found: f }),
      onLoggedOut: () => (loggedOut = true),
      onCrashed: () => crashed.push(brand),
    });
    await page.close().catch(() => {});
    book = mergeFound(book, found, brand).book;
    // Written per brand: a long run closed halfway through must keep what it found.
    await writeLatches(book);
    total += found.length;
    canLatch += found.filter((f) => f.state === "form").length;
  }
  if (loggedOut) return { ok: false, message: `${new LoggedOut().message} (${total} looked at before it.)` };
  return {
    ok: true,
    result: book,
    note:
      `Swept ${brands.length} ${kind}${brands.length === 1 ? "" : "s"} — ${total} product${total === 1 ? "" : "s"} looked at, ` +
      `${canLatch} can be latched now.` +
      (crashed.length ? ` Chrome's tab crashed during ${crashed.join(", ")}; what it found before that is kept — sweep ${crashed.length === 1 ? "it" : "them"} again to finish.` : ""),
  };
}


/**
 * Which latched products could have their listing images made, and what is stopping the rest.
 *
 * Reads the disk for two things the book does not know: whether the contents photo was ever
 * downloaded, and how many images already sit in `1-raw`. Both are the difference between a run
 * that works and four prompts spent finding out it could not.
 */
ipcMain.handle("imageQueue", async (): Promise<Attempt<unknown>> => {
  const { readLatches, imageJobs, imageFor } = await latchEngine();
  const book = await readLatches();
  const rows = imageJobs(book, {
    photoFor: (sku) => {
      const f = imageFor(sku);
      return existsSync(f) ? f : null;
    },
    haveFor: (ourSku) => {
      try {
        return readdirSync(path.join(IMAGES_DIR, "1-raw", ourSku)).filter((n) => !n.startsWith(".")).length;
      } catch {
        return 0;
      }
    },
  });
  return { ok: true, result: rows };
});

/**
 * Make the listing images for ONE product: four prompts, one chat, three pictures.
 *
 * One at a time on purpose. Each run is minutes of somebody else's compute and produces work a
 * person then looks at; queueing ten would mean thirty images arriving together with nobody having
 * checked the first. Vansh asked to be ASKED which one goes next, and this is the call that answers
 * that question one product at a time.
 */
ipcMain.handle("runImages", async (e, sku: string): Promise<Attempt<unknown>> => {
  const { readLatches, imageJobs, imageFor } = await latchEngine();
  const { runImageChat, STANDARD_RUN, chatTitle } = await import("../src/chat-core.js");
  const { rawFileFor } = await import("../src/sku-core.js");
  const { chatTab } = await import("../src/browser-core.js");

  const book = await readLatches();
  const job = imageJobs(book, {
    photoFor: (s) => {
      const f = imageFor(s);
      return existsSync(f) ? f : null;
    },
    haveFor: () => 0,
  }).find((j) => j.sku === sku);
  if (!job) return { ok: false, message: "That product is not in the list any more." };
  if (job.blockedBy.length) return { ok: false, message: job.blockedBy.join("; ") };

  const prompts = await promptsEngine();
  let tab;
  try {
    tab = await chatTab();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  await tab.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await tab.waitForTimeout(6000);

  const done = await runImageChat(tab, {
    contentsPhoto: job.contentsPhoto ?? undefined,
    steps: STANDARD_RUN,
    readPrompt: async (name) => (await prompts.readPrompt(promptDirs(), name)).text,
    fileFor: (n) => rawFileFor(IMAGES_DIR, job.ourSku, n),
    onStep: (r) => e.sender.send("imageStep", { sku, ...r }),
    // So the sidebar says `ANP018 — images` rather than "Generate Balloon Image", and the chat
    // behind a price can be found again a week later.
    title: chatTitle("images", job.ourSku),
  });

  const made = done.filter((d) => d.file).length;
  const missed = done.filter((d) => d.missing).map((d) => d.prompt);
  return {
    ok: true,
    result: done,
    note:
      `${job.ourSku}: ${made} image${made === 1 ? "" : "s"} in images/1-raw/${job.ourSku}/` +
      (missed.length ? `. Nothing came back from ${missed.join(", ")} — the chat is still open.` : "."),
  };
});

/**
 * Write the listing text for ONE product: `PROMPT-meta` then `PROMPT-product`, in one chat, from
 * the images `runImages` made and the kit the Inventory panel saved.
 *
 * Saved to a scratch folder and filed by `importInbox`, the same code that files a hand download —
 * so the no-overwrite-with-older rule and the ID matching are the ones already trusted.
 */
ipcMain.handle("runMeta", async (e, sku: string): Promise<Attempt<unknown>> => {
  const { readLatches, imageJobs } = await latchEngine();
  const { runMetaChat, chatTitle } = await import("../src/chat-core.js");
  const { findById } = await import("../src/id.js");
  const { chatTab } = await import("../src/browser-core.js");

  const job = imageJobs(await readLatches(), { photoFor: () => null, haveFor: () => 0 }).find((j) => j.sku === sku);
  if (!job?.ourSku) return { ok: false, message: "That product has no SKU of ours yet." };

  const rawDir = path.join(IMAGES_DIR, "1-raw", job.ourSku);
  // 1.png, 2.png, 3.png, 4.png — numbered, because IMAGE 1 has to be the hero.
  const images = readdirSync(rawDir)
    .filter((n) => /^\d+\.(png|jpe?g|webp)$/i.test(n))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((n) => path.join(rawDir, n));
  if (images.length < 2) return { ok: false, message: `Make the images first — images/1-raw/${job.ourSku}/ has ${images.length}.` };
  const kit = await findById(KITS_DIR, job.ourSku);
  if (!kit) return { ok: false, message: `No kit saved for ${job.ourSku} — cost it in the Inventory panel first.` };

  const prompts = await promptsEngine();
  let tab;
  try {
    tab = await chatTab();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  await tab.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await tab.waitForTimeout(6000);

  const saveDir = path.join(app.getPath("temp"), `ww-meta-${job.ourSku}`);
  let done;
  try {
    done = await runMetaChat(tab, {
      images,
      kit: { sku: job.ourSku, json: await readFile(kit.file, "utf8") },
      readPrompt: async (name) => (await prompts.readPrompt(promptDirs(), name)).text,
      saveDir,
      onStep: (r) => e.sender.send("imageStep", { sku, ...r, missing: !r.file }),
      title: chatTitle("meta", job.ourSku),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const { imported } = await (await inboxEngine()).importInbox(saveDir, { move: true });
  const missed = done.filter((d) => !d.file).map((d) => d.prompt);
  return {
    ok: true,
    result: { done, imported },
    note:
      `${job.ourSku}: filed ${imported.map((i) => path.relative(WORKSPACE, i.to)).join(" and ") || "nothing"}` +
      (missed.length ? `. Nothing readable came back from ${missed.join(", ")} — the chat is still open.` : "."),
  };
});

/** Latched, with our SKU, not yet on Meesho — oldest first. See `forMeesho`. */
ipcMain.handle("meeshoQueue", async (): Promise<Attempt<unknown>> => {
  const { readLatches, forMeesho } = await latchEngine();
  const { findById } = await import("../src/id.js");
  const rows = await Promise.all(
    forMeesho(await readLatches()).map(async (r) => ({
      ourSku: r.ourSku!,
      title: r.title,
      latchedOn: r.latchedOn!,
      costed: !!(await findById(KITS_DIR, r.ourSku!)),
    })),
  );
  return { ok: true, result: rows };
});

/**
 * One Meesho bulk sheet for these SKUs: a ChatGPT chat per kit for the copy and dropdowns, the price
 * and weight from the costed kit, the rest from `meesho-sheet.json` — written into Meesho's own
 * template in Downloads. Image links stay blank: they come from the supplier panel's uploader.
 * Marks nothing; "I uploaded these" does, once the sheet has actually gone in.
 */
ipcMain.handle("meeshoSheet", async (e, skus: string[]): Promise<Attempt<unknown>> => {
  const { findById } = await import("../src/id.js");
  const { readKit, costKit, loadMaterials } = await inventoryEngine();
  const { loadPackaging, parcelFor } = await import("../src/packaging.js");
  const { runMeeshoChat, chatTitle } = await import("../src/chat-core.js");
  const { chatTab } = await import("../src/browser-core.js");
  const m = await import("../src/meesho-core.js");
  const { CATEGORIES_DIR } = await import("../src/paths.js");

  const fixed = Object.fromEntries(
    Object.entries(JSON.parse(await readFile(path.join(CATEGORIES_DIR, "meesho-sheet.json"), "utf8"))).filter(([k]) => !k.startsWith("_")),
  ) as import("../src/meesho-core.js").SheetRow;
  const prompts = await promptsEngine();
  const [copyPrompt, sheetPrompt] = await Promise.all(
    ["PROMPT-meesho-only.md", "PROMPT-meesho-sheet.md"].map(async (n) => (await prompts.readPrompt(promptDirs(), n)).text),
  );
  const materials = loadMaterials();
  const spec = loadPackaging();

  const rows: import("../src/meesho-core.js").SheetRow[] = [];
  const done: string[] = [];
  const notes: string[] = [];
  for (const sku of skus) {
    const found = await findById(KITS_DIR, sku);
    if (!found) {
      notes.push(`${sku}: not costed — skipped`);
      continue;
    }
    const kit = readKit(found.file);
    const lines = kit.lines.map((l, i) => ({ ...l, qty: kit.counts?.[i] ?? l.qty }));
    const costed = costKit(kit.lines, materials, kit.overrides, kit.sku, kit.prices, kit.counts, kit.resolved);
    const pieces = lines.reduce((n, l) => n + l.qty, 0);
    const started = Date.now();
    e.sender.send("imageStep", { sku, prompt: "Meesho copy", file: null, seconds: 0, missing: false });

    let chat;
    try {
      chat = await runMeeshoChat(await chatTab(), {
        copyPrompt: m.withPack(copyPrompt, m.packText(lines)),
        sheetPrompt,
        title: chatTitle("meesho", sku),
      });
    } catch (err) {
      notes.push(`${sku}: the chat failed (${err instanceof Error ? err.message : String(err)}) — skipped`);
      continue;
    }
    const copy = m.parseCopy(chat.copyReply);
    const row = m.sheetRow({
      fixed,
      sku,
      copy,
      picks: m.parsePicks(chat.sheetReply),
      pricePaise: m.meeshoPrice(costed.totalPaise, kit.flatPaise ?? 60_00) * 100,
      pieces,
      grams: spec ? parcelFor(lines, materials, spec, kit.parcel ?? {}).grams : null,
    });
    rows.push(row);
    done.push(sku);

    const problems = [
      ...(copy ? m.checkCopy(copy, pieces) : ["the copy did not come back in its three blocks"]),
      ...(costed.uncosted ? [`${costed.uncosted} line${costed.uncosted === 1 ? "" : "s"} unpriced, so ₹${row["Meesho Price"]} is too low`] : []),
      ...(Number(row["Meesho Price"]) >= Number(row.MRP) ? [`price ₹${row["Meesho Price"]} is not under the MRP`] : []),
      ...(chat.timedOut ? ["ChatGPT was still writing when it timed out"] : []),
    ];
    const gaps = m.missing(row);
    if (gaps.length) problems.push(`fill by hand: ${gaps.join(", ")}`);
    notes.push(`${sku}: ₹${row["Meesho Price"]}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
    e.sender.send("imageStep", { sku, prompt: "Meesho copy", file: null, seconds: Math.round((Date.now() - started) / 1000), missing: !copy });
  }
  if (!rows.length) return { ok: false, message: notes.join("\n") || "Nothing to write." };

  const template = await readFile(path.join(CATEGORIES_DIR, "meesho-party-items.xlsx"));
  const out = path.join(app.getPath("downloads"), `meesho-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.xlsx`);
  await writeFile(out, m.fillSheet(template, rows));
  shell.showItemInFolder(out);
  return {
    ok: true,
    result: done,
    note: `${path.basename(out)} in Downloads, ${rows.length} row${rows.length === 1 ? "" : "s"}. Image links are blank — upload the photos in the supplier panel and paste its links in.\n${notes.join("\n")}`,
  };
});

/** Take these off the Meesho list — pressed once the sheet has been uploaded. */
ipcMain.handle("meeshoDone", async (_e, skus: string[]): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, markMeesho } = await latchEngine();
  await writeLatches(markMeesho(await readLatches(), skus));
  return { ok: true, result: skus.length };
});

/** The latchable list as a message for a partner, put straight on the clipboard. */
ipcMain.handle("shareLatches", async (_e, pack: string | null): Promise<string> => {
  const { readLatches, shareText } = await latchEngine();
  const text = shareText(await readLatches(), pack, 220_00);
  clipboard.writeText(text);
  return text;
});
ipcMain.handle("crawlSearch", async (e, term: string, minutes: number): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, crawlSearch, mergeFound, LoggedOut } = await latchEngine();
  if (!term.trim()) return { ok: false, message: "Type something to search for." };

  const book = await readLatches();
  stopSweep = false;
  const tab = await sellerTab();
  if (!tab.ok) return tab;
  const page = tab.result;
  let loggedOut = false;
  let crashedTab = false;

  const found = await crawlSearch(page, term.trim(), {
    until: Date.now() + Math.max(1, minutes) * 60_000,
    // Products already judged are skipped, so a second sweep of the same term is spent on what is
    // NEW rather than on re-confirming a hundred things we checked yesterday.
    known: new Set(book.rows.map((r) => r.fsn).filter((f): f is string => !!f)),
    stopped: () => stopSweep,
    onFound: (f, seen) => e.sender.send("crawlRow", { seen, found: f }),
    onLoggedOut: () => (loggedOut = true),
    onCrashed: () => (crashedTab = true),
  });
  await page.close().catch(() => {});

  const merged = mergeFound(book, found, term.trim());
  await writeLatches(merged.book);
  if (loggedOut) return { ok: false, message: `${new LoggedOut().message} (${found.length} looked at before it.)` };
  const canLatch = found.filter((f) => f.state === "form").length;
  return {
    ok: true,
    result: merged.book,
    note:
      `Looked at ${found.length} product${found.length === 1 ? "" : "s"} for "${term.trim()}" — ` +
      `${canLatch} can be latched, ${found.filter((f) => f.state === "selling").length} you already sell, ` +
      `${found.filter((f) => f.state === "approval").length} need approval.` +
      (crashedTab ? " Chrome's tab crashed partway; what it found before that is kept — sweep again to finish." : ""),
  };
});

/**
 * Ask Flipkart where each product stands, through ONE reused tab.
 *
 * Only rows that have never been checked, by default — the answer costs about fifteen seconds a
 * product and does not change on its own. `all` re-asks everything, which is what a month later
 * or a rejected approval calls for.
 */
ipcMain.handle("checkLatches", async (e, all: boolean, pack: string | null): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, resolveProduct, LoggedOut, inPack } = await latchEngine();
  const book = await readLatches();
  const rows = book.rows;
  // Only the selected pack — the count on the button is the count that gets checked.
  const todo = inPack(book, pack ?? null).filter((r) => all || r.state === "unknown");
  if (todo.length === 0) return { ok: true, result: book, note: "Everything has been checked already." };

  const tab = await sellerTab();
  if (!tab.ok) return tab;
  let page = tab.result;
  const { newTab } = await import("../src/browser-core.js");
  let done = 0;
  let crashes = 0;
  for (const row of todo) {
    let next;
    // One retry in a fresh tab when Chrome's tab crashed — a long Re-check (592 products) loads
    // hundreds of heavy pages in one tab, which is what crashed the 2026-09-17 sweep.
    for (let attempt = 0; ; attempt++) {
      try {
        next = await resolveProduct(page, row);
        break;
      } catch (err) {
        if (err instanceof LoggedOut) {
          await page.close().catch(() => {});
          return { ok: false, message: `${err.message} (${done} of ${todo.length} done.)` };
        }
        if (attempt === 0 && /crash|closed/i.test(String((err as Error)?.message ?? err))) {
          crashes++;
          await page.close().catch(() => {});
          page = await newTab();
          continue;
        }
        next = { ...row, state: "stuck" as const };
        break;
      }
    }
    const at = rows.findIndex((r) => r.sku === row.sku);
    rows[at] = next;
    done++;
    e.sender.send("latchRow", { done, of: todo.length, row: next });
    // Written every time, not at the end: a check of forty products is minutes long, and closing
    // the window halfway through must not throw away the thirty answers already paid for.
    await writeLatches(book);
  }
  await page.close().catch(() => {});
  return {
    ok: true,
    result: book,
    note:
      `Checked ${done} product${done === 1 ? "" : "s"} against Flipkart.` +
      (crashes ? ` Chrome's tab crashed ${crashes} time${crashes === 1 ? "" : "s"}; a fresh one carried on.` : ""),
  };
});

/**
 * Open a filled latch form for every product that can still be latched. One button, one tab each.
 *
 * Nothing is saved and no tab is closed — the SKU is still Vansh's to type, and he asked for the
 * tabs to stay open so he can do them in his own order.
 */
/**
 * Every SKU already in use, from the three places they live.
 *
 * Costed kits, the Flipkart 66-field files and the Meesho description files — a product can exist
 * in any one of them without the others yet, so all three count as "taken". Missing one would hand
 * a live SKU out twice, and the second listing would quietly inherit the first one's costing.
 */
async function skusInUse(): Promise<string[]> {
  const inv = await inventoryEngine();
  const out = new Set<string>();
  try {
    for (const k of inv.listKits(KITS_DIR)) if (k.sku) out.add(k.sku);
  } catch {
    /* no kits folder yet */
  }
  for (const dir of [PRODUCTS_DIR, META_DIR]) {
    try {
      for (const f of await readdir(dir)) {
        if (!f.endsWith(".json") || f.startsWith("EXAMPLE")) continue;
        out.add(path.basename(f, ".json").replace(/^image-meta-/, ""));
      }
    } catch {
      /* folder may not exist on a fresh machine */
    }
  }
  /**
   * **And every SKU a latch has already handed out.** A latched product has no kit or listing file
   * until it is costed, so a second latch run did not see the first one's SKUs: on 2026-09-17 the
   * 19:16 run gave HBD102 to one kit and the 19:26 run gave HBD102 to another.
   */
  try {
    for (const r of (await (await latchEngine()).readLatches()).rows) if (r.ourSku) out.add(r.ourSku);
  } catch {
    /* no latch list yet */
  }
  return [...out];
}

/**
 * Copy a latched kit's contents photo into its folder in `Downloads/Whatsapp DW`, as `contents.jpg`.
 *
 * Where Vansh keeps every kit's pictures, sorted by hand (see `photoFolder`). Skipped silently on a
 * machine without that folder — the partner's — and for a product with no SKU of ours yet. The app's
 * own copy stays where it is; the image queue reads that one.
 * ponytail: the folder name is his; make it a Settings folder if anyone else sorts photos this way.
 */
/**
 * **Two folders, because a product is at one of two stages.** `Whatsapp DW` is the finished version —
 * a kit listed on Meesho AND Flipkart, priced, sorted by hand over months. A product just latched has
 * none of that, and Vansh does not want it landing among the finished ones: *"Whatsapp DW is the one
 * that is the final version… but this is only going to be on Flipkart."* So a fresh latch files its
 * photos under `Flipkart only`, and `graduateFolders` moves the kit's folder across once the kit is
 * costed (confirmed) and has a price — his answer to when it becomes final.
 */
const PHOTO_ROOTS = {
  final: () => path.join(app.getPath("downloads"), "Whatsapp DW"),
  latchedOnly: () => path.join(app.getPath("downloads"), "Flipkart only"),
};

async function photoPath(sku: string, as: string, root: string, make = false): Promise<string | null> {
  const { photoFolder } = await latchEngine();
  if (!existsSync(root)) {
    if (!make) return null;
    await mkdir(root, { recursive: true });
  }
  const dirs: string[] = [];
  const walk = async (rel: string, depth: number) => {
    for (const d of await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory()) continue;
      const child = rel ? `${rel}/${d.name}` : d.name;
      dirs.push(child);
      if (depth < 3) await walk(child, depth + 1);
    }
  };
  await walk("", 1);
  const rel = photoFolder(sku, dirs);
  return rel ? path.join(root, ...rel.split("/"), as) : null;
}

/**
 * A kit is final once it is **costed and priced** — Vansh's rule, taken literally: the kit file exists
 * (so it has been costed) and a marketplace carries a price. *Confirmed* is deliberately NOT required:
 * measured 2026-09-18, 0 of his 67 kits have ever been confirmed and 54 are priced, so requiring it
 * would mean nothing ever left `Flipkart only`.
 */
async function kitIsFinal(sku: string): Promise<boolean> {
  const { findById } = await import("../src/id.js");
  const hit = await findById(KITS_DIR, sku).catch(() => null);
  if (!hit) return false;
  try {
    const kit = JSON.parse(await readFile(hit.file, "utf8")) as {
      marketplaces?: Record<string, { pricePaise?: number; settlementPaise?: number }>;
    };
    return Object.values(kit.marketplaces ?? {}).some((m) => (m?.pricePaise ?? m?.settlementPaise ?? 0) > 0);
  } catch {
    return false;
  }
}

/** File a photo under the kit's folder in the right root, creating it when there is none yet. */
async function fileInWhatsappFolder(sku: string, photo: string, as = "contents.jpg"): Promise<string | null> {
  /**
   * A kit that ALREADY has a folder in `Whatsapp DW` is filed there whatever its costing says: those
   * folders were sorted by hand over months, and most of the old kits were never marked confirmed.
   * Only a kit with no folder there yet starts life under `Flipkart only`.
   */
  const already = await photoPath(sku, as, PHOTO_ROOTS.final()).catch(() => null);
  const root = already && existsSync(path.dirname(already)) ? PHOTO_ROOTS.final()
    : (await kitIsFinal(sku)) ? PHOTO_ROOTS.final()
      : PHOTO_ROOTS.latchedOnly();
  const to = await photoPath(sku, as, root, true);
  if (!to) return null;
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(photo, to);
  return to;
}

/**
 * Move every kit that has become final out of `Flipkart only` and into `Whatsapp DW`, folder and all.
 * Cheap and silent: nothing to do when the folder does not exist. Run when the Latch screen loads.
 */
async function graduateFolders(): Promise<number> {
  const from = PHOTO_ROOTS.latchedOnly();
  if (!existsSync(from)) return 0;
  const inv = await inventoryEngine();
  let moved = 0;
  for (const kit of inv.listKits(KITS_DIR)) {
    if (!kit.sku || !(await kitIsFinal(kit.sku))) continue;
    const here = await photoPath(kit.sku, "", from);
    if (!here || !existsSync(path.dirname(here))) continue;
    const there = await photoPath(kit.sku, "", PHOTO_ROOTS.final(), true);
    if (!there) continue;
    await mkdir(path.dirname(there), { recursive: true });
    for (const f of await readdir(path.dirname(here)).catch(() => [])) {
      await copyFile(path.join(path.dirname(here), f), path.join(path.dirname(there), f)).catch(() => {});
      await rm(path.join(path.dirname(here), f)).catch(() => {});
    }
    await rm(path.dirname(here), { recursive: true }).catch(() => {});
    moved++;
  }
  return moved;
}

/**
 * Every Flipkart PRODUCT page open in the app's Chrome — the shopper's page, not the seller form —
 * with the full name read off `document.title`. What `adoptOpened` takes.
 */
async function openProducts(): Promise<{ fsn: string; title: string; url: string }[]> {
  const { productTitle } = await latchEngine();
  const { openTabs } = await import("../src/browser-core.js");
  const out: { fsn: string; title: string; url: string }[] = [];
  for (const page of openTabs()) {
    const url = page.url();
    const pid = /\/\/(www\.)?flipkart\.com\//.test(url) && /[?&]pid=([^&#]+)/.exec(url)?.[1];
    if (!pid) continue;
    const title = productTitle(await page.evaluate(() => document.title).catch(() => ""));
    out.push({ fsn: decodeURIComponent(pid), url, title: title || decodeURIComponent(pid) });
  }
  return out;
}

/**
 * Set up one product's costing chat: the contents photo attached, the prompt typed, NOT sent.
 *
 * One implementation for the latch run and the "Costing chat for the tab I'm looking at" button.
 * `reusePhoto` takes a photo already saved for this product instead of fetching again — the redo
 * case, where the fetch worked and the chat did not. Returns what happened, in words; `ready` is the
 * only success. Never throws: a picture is a nice-to-have beside the latch itself.
 */
async function costingChatFor(
  row: import("../src/latch-core.js").LatchRecord,
  shelf: import("playwright").Page,
  prompt: string,
  reusePhoto: boolean,
): Promise<string> {
  const { galleryImages, saveImage, imageFor, askChatGpt, productPage } = await latchEngine();
  const { chatTab } = await import("../src/browser-core.js");
  try {
    let file = imageFor(row.sku);
    /**
     * **Both slides to the folder, only the contents one to ChatGPT.** Vansh, 2026-09-18: *"when you
     * save the image of the inventory slide, save the main image of that listing too — only the
     * inventory image goes to ChatGPT with the cost-a-kit prompt; the folder on our computer will
     * have both."* The main shot is what a person recognises the kit by; the costing prompt must not
     * see it, or it would cost a styled photo instead of the contents laid out.
     */
    let main: string | null = null;
    if (!(reusePhoto && existsSync(file))) {
      const page = productPage(row);
      if (!page) return "no product page to take the photo from";
      await shelf.goto(page, { waitUntil: "domcontentloaded" });
      await shelf.waitForTimeout(6000);
      const gallery = await galleryImages(shelf);
      if (gallery.length < 2) return gallery.length ? "the listing has only one photo" : "no photos found on the product page";
      file = await saveImage(shelf, gallery[1], imageFor(row.sku));
      main = await saveImage(shelf, gallery[0], imageFor(`${row.sku}-main`)).catch(() => null);
    } else {
      if (existsSync(imageFor(`${row.sku}-main`))) main = imageFor(`${row.sku}-main`);
      /**
       * **A photo put in the kit's folder by hand wins.** The second gallery slide is not always the
       * contents — Vansh, 2026-09-18: *"sometimes the 2nd image is not the contents image; for that I
       * will add those images in the folder manually."* So a newer `contents.jpg` there is the one
       * the chat gets.
       */
      const theirs = row.ourSku
        ? await photoPath(row.ourSku, "contents.jpg", PHOTO_ROOTS.latchedOnly()).catch(() => null) ??
          (await photoPath(row.ourSku, "contents.jpg", PHOTO_ROOTS.final()).catch(() => null))
        : null;
      if (theirs && existsSync(theirs)) {
        const [mine, hand] = [statSync(file).mtimeMs, statSync(theirs).mtimeMs];
        if (hand > mine) file = theirs;
      }
    }
    if (row.ourSku) {
      await fileInWhatsappFolder(row.ourSku, file).catch(() => null);
      if (main) await fileInWhatsappFolder(row.ourSku, main, "main.jpg").catch(() => null);
    }
    const chat = await chatTab();
    const answer = await askChatGpt(chat, file, prompt);
    if (answer === "ready") {
      // The chat's address is written onto the row the moment it is sent, so "cost this kit" can
      // fetch the reply back instead of asking a person to copy it out of ChatGPT.
      (await import("../src/chat-core.js")).nameWhenSent(chat, `${row.ourSku ?? row.sku} — costing`, 5000, 4000, (url) => {
        void (async () => {
          const { readLatches, writeLatches } = await latchEngine();
          const book = await readLatches();
          const mine = book.rows.find((r) => r.sku === row.sku);
          if (!mine || mine.costingChatUrl === url) return;
          mine.costingChatUrl = url;
          await writeLatches(book);
        })();
      });
    }
    return { ready: "ready", login: "ChatGPT signed out", manual: "the prompt did not go in — the tab is open, paste it by hand" }[answer];
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message.split("\n")[0].slice(0, 80) : String(err)}`;
  }
}

/**
 * Redo the costing chat for the product showing in Chrome — nothing else about its latch.
 *
 * Vansh, 2026-09-17, after two kits got no chat: *"there should be a button at latching page to
 * redo the chatgpt json making if any of such case come later too."* Works from the product page or
 * its Start Selling page, reuses the contents photo already saved, and leaves the chat unsent.
 */
ipcMain.handle("costingFront", async (): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, frontLatchTab } = await latchEngine();
  const { openTabs, newTab } = await import("../src/browser-core.js");
  const tabs = await Promise.all(
    openTabs().map(async (page) => ({
      page,
      url: page.url(),
      visible: await page.evaluate(() => document.visibilityState === "visible").catch(() => false),
    })),
  );
  const front = frontLatchTab(tabs);
  if (!front.ok) return { ok: false, message: front.message.replace("latched", "costed") };
  const book = await readLatches();
  const row = book.rows.find((r) => r.fsn === front.fsn);
  if (!row) return { ok: false, message: "That product is not in your latch list, so there is no kit to cost." };
  const prompt = await (await promptsEngine()).readPrompt(promptDirs(), "PROMPT-inventory.md").then((p) => p.text, () => null);
  if (!prompt) return { ok: false, message: "PROMPT-inventory.md could not be read." };

  const shelf = await newTab();
  const outcome = await costingChatFor(row, shelf, prompt, true);
  await shelf.close().catch(() => {});
  row.costingChat = outcome;
  await writeLatches(book);
  const name = row.ourSku ?? row.title?.slice(0, 50) ?? row.sku;
  return outcome === "ready"
    ? { ok: true, result: book, note: `Costing chat for ${name} is open in ChatGPT with the photo attached. Check the photo, then press Enter.` }
    : { ok: false, message: `No costing chat for ${name}: ${outcome}.` };
});

/**
 * Fill a latch form for each of these products. Saves nothing, closes nothing.
 *
 * Takes an explicit list rather than working one out, because it serves two callers that choose
 * differently: *latch everything new*, and *latch the ones whose tab is still open after I looked
 * at them*. The choosing is the interesting part and it does not belong in here.
 */
async function latchThese(
  e: Electron.IpcMainInvokeEvent,
  only: string[] | null,
  withCosting: boolean,
  prefix = "",
): Promise<Attempt<unknown>> {
  const {
    readLatches, writeLatches, latchValues, openLatchForm, startSellingUrl, todayStamp, productPage,
  } = await latchEngine();
  const { nextSku } = await import("../src/sku-core.js");
  const { newTab, chatTab } = await import("../src/browser-core.js");
  const book = await readLatches();
  const rows = book.rows;
  const todo = only
    ? // Kept in the order given, which is the order they were reviewed in.
      only.map((f) => rows.find((r) => r.fsn === f)).filter((r): r is NonNullable<typeof r> => !!r)
    : rows.filter((r) => r.state === "form" && r.fsn);
  if (todo.length === 0) return { ok: false, message: "Nothing is waiting to be latched." };

  /**
   * **Logged in to the seller app, and STAYING logged in — before a single form tab opens.**
   *
   * Without this a logged-out session opened one tab per product, and each one bounced between
   * `#dashboard/home-page` and `/?referral_url=…` for ever: Chrome flickering, the machine slowing,
   * no form appearing. Vansh, 2026-09-16: *"making the chrome to blink back and fro and making
   * computer slow and showing nothing new."* Checked twice because a bouncing tab reads logged in
   * half the time; one look is a coin toss.
   */
  const probe = await sellerTab();
  if (!probe.ok) return { ok: false, message: `${probe.message} The tabs you kept are still counted.` };
  await probe.result.close().catch(() => {});

  const values = latchValues(LATCH_PRICES);
  /**
   * SKUs handed out as we go, so ten annaprashan kits in one batch get ten different numbers.
   * Seeded with everything already on disk; each one assigned is added before the next is chosen.
   */
  const taken = await skusInUse().catch(() => [] as string[]);
  const prompt = withCosting
    ? await (await promptsEngine()).readPrompt(promptDirs(), "PROMPT-inventory.md").then((p) => p.text, () => null)
    : null;
  // ONE tab for every product page, reused. The pictures are fetched and the tab moves on, so the
  // windows left open are the ones with work in them: a latch form and its costing chat.
  const shelf = prompt ? await newTab() : null;
  let opened = 0;
  let costing = 0;
  /** Products whose costing chat was not set up, with why — said in the note, kept on the row. */
  const missed: string[] = [];
  /** Set once ChatGPT says it is signed out. Asking forty times over would open forty dead tabs. */
  let loggedOut = false;

  for (const row of todo) {
    const tab = await newTab();
    await tab.goto(startSellingUrl(row.fsn!), { waitUntil: "domcontentloaded" }).catch(() => {});
    /**
     * Our own SKU, worked out from the catalog title.
     *
     * Null when the title names no line we sell — and then the field is left EMPTY, exactly as it
     * was before this existed. A blank asks; a wrong SKU files the listing under another product's
     * costing and says nothing.
     */
    /**
     * **Reuse the SKU the product already has.** An approval product gets its SKU (and its costed kit)
     * at "I applied", days before the approval is accepted and it is latched; a fresh one here would
     * list it under a SKU its costing is not filed under, and the later price change would miss it.
     */
    const mine = row.ourSku ?? nextSku(row.title ?? row.description, taken);
    if (mine && !taken.includes(mine)) taken.push(mine);
    const state = await openLatchForm(tab, values, mine ?? undefined).catch(() => "stuck" as const);
    const at = rows.findIndex((r) => r.sku === row.sku);
    // A tab that opened is a latch STARTED, so the day is recorded now rather than on save —
    // nothing here can see the save, and a form filled and abandoned is still worth knowing about.
    rows[at] = {
      ...rows[at],
      state,
      checkedOn: todayStamp(),
      // Latched is no longer waiting: `laterOn: undefined` drops out when the list is written.
      ...(state === "form" ? { latchedOn: todayStamp(), laterOn: undefined, ...(mine ? { ourSku: mine } : {}) } : {}),
    };
    if (state === "form") opened++;
    e.sender.send("latchRow", { done: opened, of: todo.length, row: rows[at] });
    await writeLatches(book);
  }

  /**
   * The costing chats, AFTER every form is open — never interleaved with them.
   *
   * The ChatGPT window is a second Chrome. Opening a form, then a chat, then the next form made the
   * two windows steal focus from each other once per product, with two heavy pages loading at a
   * time and the progress line frozen for the ~30s each chat takes. Vansh, 2026-09-16: *"making the
   * chrome to blink back and fro and making computer slow and showing nothing new."* Forms first
   * means the work he types into is ready in seconds, and the chats come after in one window.
   *
   * **The SECOND gallery photo**, because on a party kit that is the contents laid out — which is
   * what the costing prompt reads. A listing with only one photo gets no chat rather than the styled
   * shot, which would cost a kit from a picture that does not show its contents.
   */
  if (shelf && prompt) {
    for (const row of todo) {
      const now = rows.find((r) => r.sku === row.sku)!;
      // `productPage`, not `row.url`: a label-pack row has no stored URL and silently got no chat.
      const page = productPage(row);
      if (now.state !== "form" || !page) continue;
      const outcome = loggedOut ? "ChatGPT signed out" : await costingChatFor(now, shelf, prompt, false);
      now.costingChat = outcome;
      if (outcome === "ready") costing++;
      else missed.push(`${now.ourSku || row.title?.slice(0, 40) || row.sku} (${outcome})`);
      if (outcome === "ChatGPT signed out") loggedOut = true;
    }
    await writeLatches(book);
  }
  await shelf?.close().catch(() => {});
  return {
    ok: true,
    result: book,
    note:
      `${prefix ? prefix + " " : ""}${opened} form${opened === 1 ? "" : "s"} open in Chrome, ` +
      `everything filled but the SKU. ` +
      (costing ? `${costing} costing chat${costing === 1 ? "" : "s"} ready to send. ` : "") +
      (missed.length ? `No costing chat for: ${missed.join("; ")}. ` : "") +
      (loggedOut
        ? "ChatGPT is signed out — log in once in that tab and the session sticks, like Flipkart's. "
        : "") +
      `Type your SKU in each and save it. Nothing was closed.`,
  };
}

/** What every latch form is filled with, until prices are set per kit. One place for both callers. */
const LATCH_PRICES = { MRP: "999", "Your selling price": "220" };

/**
 * Fill the latch form in the Start Selling tab showing in Chrome — and only that one. See
 * `frontLatchTab`. Uses the SKU already recorded for the product, so a refill never invents a
 * second one. Saves nothing, like every other latch path.
 */
ipcMain.handle("fillFrontLatch", async (e, withCosting: boolean): Promise<Attempt<unknown>> => {
  const { readLatches, writeLatches, latchValues, openLatchForm, todayStamp, frontLatchTab } = await latchEngine();
  const { openTabs } = await import("../src/browser-core.js");
  const { nextSku } = await import("../src/sku-core.js");
  const tabs = await Promise.all(
    openTabs().map(async (page) => ({
      page,
      url: page.url(),
      visible: await page.evaluate(() => document.visibilityState === "visible").catch(() => false),
    })),
  );
  const front = frontLatchTab(tabs);
  if (!front.ok) return { ok: false, message: front.message };

  // A product page, not a form: latch it properly — its own form tab, and its costing chat.
  if (front.kind === "shopper") {
    // A product opened by hand, in no pack or hunt, is added to the list rather than refused.
    const { adoptOpened } = await latchEngine();
    const title = await front.tab.page.evaluate(() => document.title).catch(() => "");
    const adopted = adoptOpened(await readLatches(), [{ fsn: front.fsn, url: front.tab.url, title: (await latchEngine()).productTitle(title) || front.fsn }]);
    if (adopted.added) await writeLatches(adopted.book);
    return latchThese(e, [front.fsn], withCosting, adopted.added ? "Added to the list." : "");
  }

  const book = await readLatches();
  const at = book.rows.findIndex((r) => r.fsn === front.fsn);
  const row = at === -1 ? null : book.rows[at];
  const sku = row?.ourSku ?? (row ? nextSku(row.title ?? row.description, await skusInUse().catch(() => [])) : null);
  const state = await openLatchForm(front.tab.page, latchValues(LATCH_PRICES), sku ?? undefined).catch(() => "stuck" as const);
  if (state !== "form") {
    const why = { selling: "Flipkart says you already sell it.", approval: "it needs brand approval first.", stuck: "the form did not open — is the page loaded and are you logged in?" }[state];
    return { ok: false, message: `Could not fill that tab: ${why}` };
  }
  if (row) {
    book.rows[at] = { ...row, state, checkedOn: todayStamp(), latchedOn: row.latchedOn ?? todayStamp(), ...(sku ? { ourSku: sku } : {}) };
    await writeLatches(book);
  }
  return {
    ok: true,
    result: book,
    note:
      `Filled ${row?.title?.slice(0, 60) ?? front.fsn}${sku ? ` with SKU ${sku}` : " — type the SKU, none could be worked out"}. ` +
      `Check it and press Save in Chrome.`,
  };
});

// There is deliberately NO "latch everything" handler. It existed, and the look-first flow
// replaced it: ten shopper pages, close what you do not want, latch what survives. A button that
// lists sixty products unseen is the thing that flow exists to prevent, so the door is shut rather
// than left ajar. `latchThese` still takes null for its own tests.

/** Where each packer's rate per packet is kept — beside the days it is paid on, not in settings. */
const RATES_FILE = () => path.join(ORDERS_DIR, "rates.json");

async function readRates(): Promise<Record<string, number>> {
  try {
    return JSON.parse(await readFile(RATES_FILE(), "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * What a stretch of days was worth, and what it owes the people who packed it.
 *
 * One handler for both because they answer the same question from two sides and read the same two
 * files; splitting them would mean two round trips for one screen. Costed kits come from the
 * inventory engine, so the money here is the same arithmetic the costing panel shows — there is
 * no second definition of what a kit earns.
 */
ipcMain.handle("money", async (_e, from: string, to: string, market?: string) => {
  const orders = await ordersEngine();
  const { listKits, loadMaterials, KITS_DIR } = await inventoryEngine();
  const ledgers = await orders.listLedgers();
  return {
    money: orders.money(ledgers, listKits(KITS_DIR, loadMaterials()), from, to, market, await readAds()),
    pay: orders.packerPay(ledgers, from, to, await readRates(), market),
  };
});

/**
 * What comes back, what has stopped selling, and what is being used up.
 *
 * One handler and one round trip, like `money`, because the screen draws all three at once and
 * they read the same two things: the parcel ledger and the costed kits.
 */
ipcMain.handle("howItSells", async (_e, from: string, to: string, market?: string) => {
  const orders = await ordersEngine();
  const { listKits, loadMaterials, KITS_DIR } = await inventoryEngine();
  return orders.howItSells(await orders.listLedgers(), listKits(KITS_DIR, loadMaterials()), from, to, market);
});

/**
 * Raw stock — the material actually in the building, not the material a listing is made of.
 *
 * `stock/<date>.json` is one checked delivery. **`stock/aliases.json` is what makes it survive
 * week two**: the supplier's price list and ours are different vocabularies — of Vansh's real
 * 19 Aug note, 61 lines matched only 7 rows confidently — so the first tally is a lot of picking.
 * Every pick is remembered against the wording it was made for, and the next delivery matches
 * itself. Without it he re-picks three dozen rows every week and stops using the screen.
 *
 * Aliases live here rather than as `aka` on the material, deliberately: `categories/materials.json`
 * is a PRICE list that ships with the app, and one supplier's spelling is not a fact about a
 * material's price. Keeping them apart means an app update cannot lose his vocabulary and his
 * vocabulary cannot bloat the shipped list.
 */
const stockEngine = () => import("../src/stock-core.js");
const ALIASES_FILE = () => path.join(STOCK_DIR, "aliases.json");

async function readAliases(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(ALIASES_FILE(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The supplier's claim against our count, matched to the price list. Nothing is written. */
ipcMain.handle("tallyNotes", async (_e, claimedNote: string, countedNote: string) => {
  (await inventoryEngine()).useLearnedWords(await readLearned());
  const { readNote, tally } = await stockEngine();
  const { loadMaterials } = await inventoryEngine();
  const materials = loadMaterials();
  return {
    rows: tally(readNote(claimedNote), readNote(countedNote), materials, await readAliases()),
    // Every row on the price list, so the dropdown can offer more than the top five guesses.
    materials: materials.map((m) => ({ key: `${m.category}|${m.material}`, name: m.material, category: m.category })),
  };
});

/** Remember a pick, so next week's delivery matches itself. Null forgets one. */
ipcMain.handle("setAlias", async (_e, name: string, key: string | null) => {
  const aliases = await readAliases();
  if (key === null) delete aliases[name];
  else aliases[name] = key;
  await mkdir(STOCK_DIR, { recursive: true });
  await writeFile(ALIASES_FILE(), `${JSON.stringify(aliases, null, 2)}\n`);
  return aliases;
});

/**
 * Take a saved delivery off the record.
 *
 * The shelf moves the moment it goes, because on-hand is deliveries minus packing and no level is
 * stored. Deleting the EARLIEST one moves more than its own quantities — usage is counted from the
 * first delivery on record, so the window the packing is measured over changes with it.
 */
ipcMain.handle("removeDelivery", async (_e, date: string) => {
  await (await stockEngine()).removeDelivery(date);
  return true;
});

ipcMain.handle("saveDelivery", async (_e, d: unknown) => {
  await (await stockEngine()).writeDelivery(d as never);
  return true;
});

/**
 * What is on the shelf: deliveries in, packing out.
 *
 * Usage comes from the SAME arithmetic the How it sells screen shows — the parcel ledger times
 * each kit's own material lines — rather than a second count kept here. It is measured from the
 * first delivery on record, because before that there was no stock figure for it to come off.
 */
/**
 * How far back the selling rate is measured, and how far forward it is projected.
 *
 * Four weeks back is long enough that one busy Saturday is not the rate and short enough to notice
 * a change. A fortnight forward is the supplier's lead time plus a week of slack — Vansh, 2026-09-13:
 * *"how much should I order for next 2 weeks."*
 */
const FORECAST_WINDOW_DAYS = 28;
const FORECAST_HORIZON_DAYS = 14;

ipcMain.handle("stock", async () => {
  const stock = await stockEngine();
  // Taught words are loaded here rather than at boot: this is the first handler that needs them,
  // and reading them on every call keeps a second window's teaching from going unnoticed.
  (await inventoryEngine()).useLearnedWords(await readLearned());
  const orders = await ordersEngine();
  const { listKits, loadMaterials, KITS_DIR } = await inventoryEngine();

  const deliveries = await stock.listDeliveries();
  const from = stock.firstDelivery(deliveries);
  const materials = loadMaterials();
  const names = new Map(materials.map((m) => [`${m.category}|${m.material}`, m.material]));
  /**
   * Pieces in a SUPPLIER packet — `packOf`, never `piecesPerPack`.
   *
   * `piecesPerPack` answers what `paise` buys and belongs to costing; this answers what arrives in
   * a packet and belongs to the shelf. Reading the pricing one here would net a delivery of five
   * packets against a set price and silently mis-state the stock.
   */
  const perPack = new Map(
    materials.filter((m) => m.packOf).map((m) => [`${m.category}|${m.material}`, m.packOf!]),
  );

  const kits = listKits(KITS_DIR, materials);
  const today = new Date().toISOString().slice(0, 10);
  const used = new Map<string, { pieces: number; perWeek: number }>();
  /**
   * The RECENT rate, over its own shorter window — the second half of *"based on the order trends
   * you see recently and on the basis of all the history trends"*.
   *
   * `used` is measured from the first delivery, which is the whole history; a material that has
   * doubled this month is invisible in it. Four weeks is short enough to show a change and long
   * enough that one busy Saturday does not become the rate.
   */
  const recent = new Map<string, number>();
  /**
   * Every material the packing has EVER eaten, over every ledger there has ever been.
   *
   * Deliberately not the shelf's window: the question it answers is *has he ever bought this*, and
   * a material packed for a year and last used before the first delivery note is still one he owns.
   */
  const everPacked = new Map<string, { name: string; pieces: number }>();
  // Read once, and OUTSIDE the `from !== null` guard: the forecast is built from these and must
  // work on a machine that has never saved a delivery note.
  const ledgers = await orders.listLedgers();
  for (const b of orders.howItSells(ledgers, kits, "2000-01-01", today).burn) {
    if (b.pieces > 0) everPacked.set(b.key, { name: b.name, pieces: b.pieces });
  }
  if (from !== null) {
    const { burn } = orders.howItSells(ledgers, kits, from, today);
    for (const b of burn) used.set(b.key, { pieces: b.pieces, perWeek: b.piecesPerWeek });
    const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
    const fresh = orders.howItSells(ledgers, kits, since > from ? since : from, today);
    for (const b of fresh.burn) recent.set(b.key, b.piecesPerWeek);
  }
  /**
   * Parcels per SKU over the window — the other half of the forecast, and the half that needs no
   * delivery note. Counted off `firstSeen`, the day the parcel appeared on a manifest, because that
   * is when the kit was actually sold; `packedOn` is when somebody got round to it.
   */
  const soldSince = new Date(Date.now() - FORECAST_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const soldPerSku = new Map<string, number>();
  for (const l of ledgers) {
    for (const p of l.subOrders) {
      if ((p.firstSeen ?? "") >= soldSince) soldPerSku.set(p.sku, (soldPerSku.get(p.sku) ?? 0) + p.qty);
    }
  }

  const onHand = stock.onHand(deliveries, used, names, perPack);
  return {
    deliveries,
    from,
    onHand,
    reorderWeeks: stock.REORDER_WEEKS,
    nextCall: stock.nextCall(onHand, kits, recent, perPack, new Set(everPacked.keys())),
    untallied: stock.untallied(onHand, everPacked),
    /**
     * What the next fortnight will CONSUME, at the rate these kits are selling.
     *
     * **It needs no delivery note.** Parcels per SKU come from the ledgers and the recipe from the
     * costed kits; the shelf is not in the sum at all. That matters on a day like 2026-09-14, when
     * Vansh is calling his supplier tomorrow and has never uploaded a delivery: this list is
     * available anyway.
     *
     * The price of that is on the screen, not hidden: it is a GROSS requirement. Nothing subtracts
     * what is already on the shelf, so it can only over-order. `nextCall` is the one that nets off
     * stock, and it is only as good as the notes behind it.
     */
    forecast: stock.forecast({
      sold: soldPerSku,
      windowDays: FORECAST_WINDOW_DAYS,
      horizonDays: FORECAST_HORIZON_DAYS,
      kits,
      packSizes: perPack,
    }),
    forecastDays: FORECAST_HORIZON_DAYS,
    forecastWindow: FORECAST_WINDOW_DAYS,
    /**
     * Our SKUs that are LIVE on Flipkart because we latched them.
     *
     * The call already asks for everything a costed kit needs. What it could not say is which of
     * those lines is holding up a listing that is already selling — *order it this week* versus
     * *order it today, or pause the listing.* The screen marks those; nothing else changes.
     */
    liveSkus: await (async () => {
      try {
        const { readLatches } = await latchEngine();
        return (await readLatches()).rows
          .filter((r) => r.latchedOn && r.ourSku)
          .map((r) => r.ourSku!);
      } catch {
        return [] as string[];
      }
    })(),
    coverWeeks: stock.COVER_WEEKS,
    thin: stock.THIN,
    aliases: await readAliases(),
  };
});


/**
 * Words a human has taught the matcher — `{ "jhalar": "fringe" }`.
 *
 * Beside the aliases, in the account's folder, for the same reason: it is a fact about how this
 * supplier talks, not about this machine, and it should follow the business to a new laptop.
 */
const LEARNED_FILE = () => path.join(ORDERS_DIR, "words.json");

async function readLearned(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(LEARNED_FILE(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Teach the matcher one word, or forget one.
 *
 * **Everything re-scores afterwards**, including kits already costed — that is the point. A word
 * learnt from a delivery note is the same word in a kit's line, so `PROMPT-inventory`'s output
 * starts matching too, which is the half Vansh worried about: *"in this way our sku json entry will
 * also don't match."*
 */
ipcMain.handle("learnWord", async (_e, from: string, to: string | null) => {
  const words = await readLearned();
  if (to) words[from.toLowerCase()] = to.toLowerCase();
  else delete words[from.toLowerCase()];
  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(LEARNED_FILE(), `${JSON.stringify(words, null, 2)}\n`);
  (await inventoryEngine()).useLearnedWords(words);
  return words;
});

ipcMain.handle("learnedWords", () => readLearned());

/**
 * Export this computer's price list, taught words and aliases into one file for someone else.
 * Saved where the person chooses (Downloads by default), because it is sent on by hand. See share-core.
 */
ipcMain.handle("exportInventory", async (e): Promise<Attempt<string>> => {
  const { buildExport } = await import("../src/share-core.js");
  const inv = await inventoryEngine();
  const day = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, {
    defaultPath: path.join(app.getPath("downloads"), `wishworks-inventory-${day}.json`),
    filters: [{ name: "Inventory export", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { ok: false, message: "" };
  const file = buildExport(activeAccount()?.label ?? "WishWorks", inv.loadMaterials(), await readLearned(), await readAliases());
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`);
  return {
    ok: true,
    result: filePath,
    note: `Saved ${file.materials.length} materials, ${Object.keys(file.words).length} words and ${Object.keys(file.aliases).length} aliases. Send this file to whoever needs it.`,
  };
});

/**
 * Fold someone's export into this computer. Adds only — every clash is listed and left alone.
 */
ipcMain.handle("importInventory", async (e): Promise<Attempt<{ added: string; clashes: string[] }>> => {
  const share = await import("../src/share-core.js");
  const inv = await inventoryEngine();
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "Inventory export", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return { ok: false, message: "" };
  let theirs;
  try {
    theirs = share.readInventoryFile(await readFile(filePaths[0], "utf8"));
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const plan = share.planImport({ materials: inv.loadMaterials(), words: await readLearned(), aliases: await readAliases() }, theirs);
  const done = await share.applyImport(plan, {
    categoriesDir: (await import("../src/paths.js")).CATEGORIES_DIR,
    editsFile: inv.PRICE_EDITS_FILE,
    wordsFile: LEARNED_FILE(),
    aliasesFile: ALIASES_FILE(),
  });
  inv.useLearnedWords(await readLearned());
  return {
    ok: true,
    result: {
      added:
        `From ${theirs.from}: added ${done.materials} material${done.materials === 1 ? "" : "s"}, ` +
        `${done.words} word${done.words === 1 ? "" : "s"}, ${done.aliases} alias${done.aliases === 1 ? "" : "es"}.`,
      clashes: [...share.describeClashes(plan, theirs.from), ...done.refused],
    },
  };
});

/**
 * What one unknown word in his note might mean, given the row a human just chose.
 *
 * Returns the row's spare words as OPTIONS, never an answer — see `proposeWord`. Null when there is
 * nothing to learn, which is the common case and must be silent: a prompt after every pick would be
 * trained away within a day.
 */
ipcMain.handle("proposeWord", async (_e, note: string, key: string) => {
  const inv = await inventoryEngine();
  const material = inv.loadMaterials().find((m) => `${m.category}|${m.material}` === key);
  return material ? inv.proposeWord(note, material) : null;
});


/**
 * Ask ChatGPT, once, what the supplier's words mean.
 *
 * Sends our whole price list and his note in one prompt — about 6 KB — and reads back word rules,
 * aliases, what is genuinely new, and what it could not decide. **Nothing is applied here.** The
 * reply is checked against the real price list and handed to the screen to tick, because a wrong
 * word rule is permanent and silent: it rewrites every future note.
 */
ipcMain.handle("askSupplierWords", async (_e, note: string): Promise<Attempt<unknown>> => {
  if (!note.trim()) return { ok: false, message: "Paste his note first." };
  const sw = await import("../src/supplier-words.js");
  const { askOnce, chatTitle, renameChat } = await import("../src/chat-core.js");
  const { chatTab } = await import("../src/browser-core.js");
  const inv = await inventoryEngine();

  let prompt: string;
  try {
    prompt = sw.buildPrompt(sw.promptText(promptDirs().shipped), inv.loadMaterials(), note);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  let tab;
  try {
    tab = await chatTab();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const reply = await askOnce(tab, prompt).catch(() => "");
  // A delivery has a date where a listing has a SKU, so that is what its chat is called.
  await renameChat(tab, chatTitle("words", new Date().toLocaleDateString("en-CA"))).catch(() => false);
  const proposal = sw.readProposal(reply);
  const rows = sw.reviewProposal(proposal, inv.loadMaterials(), await readLearned());

  if (rows.length === 0 && proposal.unsure.length === 0 && proposal.new.length === 0) {
    return {
      ok: false,
      message: "Nothing came back that could be read. The chat is still open — have a look at what it said.",
    };
  }
  return {
    ok: true,
    result: { rows, proposal },
    note: `${rows.length} rule${rows.length === 1 ? "" : "s"} proposed, ${proposal.unsure.length} it was unsure about, ${proposal.new.length} it says we do not stock.`,
  };
});

/**
 * Save the rules a human ticked.
 *
 * Words go to `words.json`, aliases onto their own row in `materials.json`. Written through the
 * price list's own saver so its uniqueness check still runs — a duplicate alias would otherwise
 * only surface as a failed load later.
 */
ipcMain.handle("applySupplierWords", async (_e, chosen: unknown): Promise<Attempt<unknown>> => {
  const sw = await import("../src/supplier-words.js");
  const inv = await inventoryEngine();
  const taught = await readLearned();
  const out = sw.applyProposal(chosen as never, inv.loadMaterials(), taught);

  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(LEARNED_FILE(), `${JSON.stringify(out.words, null, 2)}\n`);
  inv.useLearnedWords(out.words);

  // Through the price list's own writer, so it keeps one writer and its uniqueness check still
  // runs. Aliases only — a proposal may not touch a price, a category or a pack size.
  const aliases = (chosen as { kind: string; from: string; to: string; blockedBy: string }[])
    .filter((r) => r.kind === "alias" && !r.blockedBy)
    .map((r) => ({ material: r.to, says: r.from }));
  if (aliases.length) inv.addAliases(aliases);

  return { ok: true, result: out.added, note: `${out.added} rule${out.added === 1 ? "" : "s"} saved.` };
});

/** A packer's rate, in paise per packet. Zero or absent means their pay is not worked out here. */
ipcMain.handle("setRate", async (_e, name: string, paise: number) => {
  const rates = { ...(await readRates()), [name]: paise };
  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(RATES_FILE(), `${JSON.stringify(rates, null, 2)}\n`);
  return rates;
});

ipcMain.handle("rates", () => readRates());

/**
 * Ads and boost, in paise, per day per marketplace — `{ "2026-08-21": { meesho: 45000 } }`.
 *
 * Beside the days it is spent on, for the same reason the rates are: it is a money record, it must
 * survive a reinstall, and it must follow the folder onto a synced drive. **It is not a second
 * expenses file** — materials and revenue are derived and deliberately never stored, but nothing
 * in the ledger or the kit knows what Meesho charged to promote a listing. This is the only cost
 * here that has no other source than a person reading it off the Ads dashboard.
 */
const ADS_FILE = () => path.join(ORDERS_DIR, "ads.json");

async function readAds(): Promise<Record<string, Record<string, number>>> {
  try {
    return JSON.parse(await readFile(ADS_FILE(), "utf8")) as Record<string, Record<string, number>>;
  } catch {
    return {};
  }
}

ipcMain.handle("ads", () => readAds());

/** Set one day's spend on one marketplace. Zero clears it, so a mistyped number can be undone. */
ipcMain.handle("setAds", async (_e, on: string, market: string, paise: number) => {
  const ads = await readAds();
  const day = { ...ads[on], [market]: paise };
  if (paise <= 0) delete day[market];
  const next = { ...ads, [on]: day };
  if (Object.keys(day).length === 0) delete next[on];
  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(ADS_FILE(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
});

/**
 * Mark a parcel as come back, or take that mark off.
 *
 * The parcel is found by its sub-order number, which is what the marketplace's own RTO and returns
 * reports carry — so when those files get parsed, they will drive exactly this.
 */
ipcMain.handle(
  "returned",
  async (_e, subOrder: string, status: "rto" | "returned" | null, on: string) => {
    const engine = await ordersEngine();
    for (const ledger of await engine.listLedgers()) {
      const next = status === null
        ? engine.clearBack(ledger, subOrder)
        : engine.markBack(ledger, subOrder, status, on);
      if (JSON.stringify(next.subOrders) !== JSON.stringify(ledger.subOrders)) await engine.writeLedger(next);
    }
    return ordersView();
  },
);

/**
 * Read a marketplace's RTO or returns report and mark every parcel of ours it mentions.
 *
 * **It does not parse the report's format, and that is the point.** These files change shape —
 * CSV one month, XLSX the next, columns nobody documented — and matching on columns means guessing
 * about which parcel came back, which is guessing about money. Instead the text is pulled out of
 * whatever kind of file it is and searched for **ids we already have**: our sub-order numbers and
 * our AWBs. A file that names our parcel is about our parcel, wherever in it the number sits.
 *
 * The status comes from which button was used rather than from the file, because an RTO report
 * and a returns report are two different downloads and the person doing it knows which is which.
 */
ipcMain.handle(
  "readReport",
  async (_e, file: string, status: "rto" | "returned"): Promise<Attempt<unknown>> => {
    const engine = await ordersEngine();
    const ledgers = await engine.listLedgers();
    const packed = ledgers.flatMap((l) => l.subOrders).filter((p) => p.packedOn);
    const found = engine.idsInFile(await readFile(file), packed);
    if (found.length === 0) {
      return {
        ok: false,
        message: `Nothing in ${path.basename(file)} matches a parcel this app has packed. If it is the right report, the parcels in it were packed before this screen existed.`,
      };
    }
    const on = today();
    const ids = new Set(found.map((p) => p.subOrder));
    for (const ledger of ledgers) {
      let next = ledger;
      for (const id of ids) next = engine.markBack(next, id, status, on);
      if (JSON.stringify(next.subOrders) !== JSON.stringify(ledger.subOrders)) await engine.writeLedger(next);
    }
    return {
      ok: true,
      result: {
        marked: found.length,
        skus: [...new Set(found.map((p) => p.sku))],
        view: await ordersView(),
      },
    };
  },
);

/** Every parcel packed but not yet marked as come back — what the returns screen picks from. */
/**
 * Every parcel we know of, newest packing first — **including the ones not packed yet**.
 *
 * It was packed-only, for the returns screen, which is the only thing that can come back. It now
 * carries the outstanding ones too, because the same table is where a **cancelled** order is
 * deleted, and a cancellation almost always lands before the parcel is packed. The screen still
 * shows nothing until you search or something is marked, so the extra rows change no first sight.
 */
ipcMain.handle("sent", async () => {
  const ledgers = await (await ordersEngine()).listLedgers();
  return ledgers
    .flatMap((l) => l.subOrders)
    .sort((a, b) => (b.packedOn ?? b.firstSeen).localeCompare(a.packedOn ?? a.firstSeen));
});

/**
 * Delete one parcel for good — the order cancelled after the manifest printed.
 *
 * Every ledger is searched rather than the current month, because a parcel from the 31st sits in
 * last month's file and is exactly the one somebody cancels on the 1st.
 */
ipcMain.handle("dropParcel", async (_e, subOrder: string) => {
  const engine = await ordersEngine();
  for (const ledger of await engine.listLedgers()) {
    const next = engine.dropParcel(ledger, subOrder);
    if (next.subOrders.length !== ledger.subOrders.length) await engine.writeLedger(next);
  }
  return ordersView();
});

/**
 * Change what is packed. One handler, because the three actions differ by one word and all three
 * have to find the right ledgers, write them, and hand back the same recomputed view.
 *
 * A SKU's outstanding subOrders can sit in TWO months' files at the turn of a month, so every
 * ledger is offered the change and only the ones that actually moved are written.
 */
ipcMain.handle(
  "packing",
  async (
    _e,
    action: "pack" | "unpack" | "credit",
    sku: string,
    on: string,
    opts: { by?: string[]; limit?: number; replacing?: string[] } = {},
  ) => {
    const engine = await ordersEngine();
    /**
     * What a parcel is worth, read once, now — and written onto it.
     *
     * The kit is where the money lives, and a kit's price changes: a ticket raised with the
     * marketplace, a promotion, a corrected material. Freezing it here means a correction moves
     * today rather than last month, and an RTO reverses what was actually booked.
     */
    const { listKits, loadMaterials, KITS_DIR } = await inventoryEngine();
    const kits = listKits(KITS_DIR, loadMaterials());
    const priceAt = (p: { sku: string; market: string }) => {
      const kit = engine.kitForSku(p.sku, kits);
      const paidPaise = kit?.pays?.[p.market];
      return kit?.costPaise === undefined || paidPaise === undefined
        ? null
        : { paidPaise, materialsPaise: kit.costPaise };
    };

    // A part-packed SKU can span two months' files at the turn of a month, so the count is spent
    // across ledgers rather than applied to each — otherwise "packed 2" would pack 2 per file.
    let left = opts.limit ?? Infinity;
    for (const ledger of await engine.listLedgers()) {
      const before = engine.leftToPack(ledger, sku);
      const next =
        action === "pack" ? engine.packSku(ledger, sku, on, opts.by ?? [], left, priceAt)
        : action === "unpack" ? engine.unpackSku(ledger, sku, on)
        : engine.creditSku(ledger, sku, on, opts.by ?? [], opts.replacing ?? []);
      if (JSON.stringify(next.subOrders) === JSON.stringify(ledger.subOrders)) continue;
      if (action === "pack") left -= before - engine.leftToPack(next, sku);
      await engine.writeLedger(next);
    }
    return ordersView(on);
  },
);

ipcMain.handle("skuImage", async (_e, sku: string, position: number) =>
  (await ordersEngine()).imageForSku(FOLDERS.ready.dir, sku, position),
);
ipcMain.handle("addSkuImage", async (_e, sku: string, position: number, file: string) =>
  (await ordersEngine()).addSkuImage(FOLDERS.ready.dir, sku, position, file),
);

/**
 * Who packs — a list of names in the ORDERS folder, not in settings.
 *
 * It belongs beside the days it is used in: both are pay records, both should survive the app
 * being reinstalled, and both should follow the folder if that is moved to a synced drive. In
 * `settings.json` it was machine state, which is exactly what it must not be.
 */
const PACKERS_FILE = () => path.join(ORDERS_DIR, "packers.json");

ipcMain.handle("workers", async () => {
  try {
    return JSON.parse(await readFile(PACKERS_FILE(), "utf8")) as string[];
  } catch {
    // No file yet — or the old list, still in settings from before this moved. Either is fine.
    return readSettings().workers ?? [];
  }
});

ipcMain.handle("setWorkers", async (_e, workers: string[]) => {
  await mkdir(ORDERS_DIR, { recursive: true });
  await writeFile(PACKERS_FILE(), `${JSON.stringify(workers, null, 2)}\n`);
});

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
/**
 * Saved pages are **per-account**, like the folders.
 *
 * A remembered URL is a seller-panel page — it carries that seller's own ids (`vid=`,
 * `requestId=`). Shared across accounts it would take you straight into the wrong seller's
 * dashboard from a button labelled with the right name, which is the worst shape a shortcut can
 * have. Machines with no accounts keep the flat list they already have.
 */
function readShortcuts(): { name: string; url: string }[] {
  return activeAccount()?.shortcuts ?? readSettings().shortcuts ?? [];
}

async function writeShortcuts(shortcuts: { name: string; url: string }[]): Promise<void> {
  const st = readSettings();
  const i = st.activeAccount ?? 0;
  if (st.accounts?.[i]) {
    await writeSettings({
      accounts: st.accounts.map((a, n) => (n === i ? { ...a, shortcuts } : a)),
    });
  } else await writeSettings({ shortcuts });
}

ipcMain.handle("shortcuts", readShortcuts);

ipcMain.handle("rememberPage", async (_e, name: string) => {
  const { sessionStatus } = await browserEngine();
  const { url } = await sessionStatus();
  if (!url || url === "about:blank") return null;
  const shortcuts = readShortcuts().filter((s) => s.name !== name);
  shortcuts.unshift({ name, url });
  await writeShortcuts(shortcuts);
  return { name, url };
});

ipcMain.handle("forgetPage", async (_e, name: string) => {
  const shortcuts = readShortcuts().filter((s) => s.name !== name);
  await writeShortcuts(shortcuts);
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
 * Every folder setting ends here, because `paths.ts` resolves `WW_*_DIR` once, at module load,
 * from env vars set above before the engine is imported. A setting that half-applied until the
 * next restart would be worse than one that is honest about needing it.
 */
function relaunch(): void {
  app.relaunch();
  /**
   * A tick later, never in the same turn.
   *
   * Every caller of this is inside an `ipcMain.handle`, and quitting synchronously there throws
   * the reply away — the renderer's `await` never settles, so a button that set `busy` before the
   * call stays on "…" for ever. That is indistinguishable from a hang, and it is what signing up
   * looked like the first time it ran. 150ms is nothing next to a process restart and is enough
   * for the answer to be on its way.
   */
  setTimeout(() => app.quit(), 150);
}

/**
 * Every movable folder, in one call, so the renderer never has four channels to keep in step.
 *
 * `label`/`what` live here rather than in the renderer because this is where the default is
 * decided — a screen that describes a folder differently from the code that picks it is how
 * WW-153 happened.
 */
const FOLDERS = {
  images: {
    dir: IMAGES_DIR,
    label: "Converted images",
    what: "the photos this app converts and prepares — the biggest folder by far",
  },
  meta: {
    dir: META_DIR,
    label: "The AI's Meesho copy",
    what: "the title, description and pack contents the AI writes, one .json per listing",
  },
  products: {
    dir: PRODUCTS_DIR,
    label: "Flipkart listing files",
    what: "the 66 form fields the Fill Flipkart step types from",
  },
  kits: {
    dir: KITS_DIR,
    label: "Costed kits",
    what: "what each kit costs to make — small text files, safe to share",
  },
  /**
   * The one folder meant to be SHARED, and the only one that defaults outside the workspace.
   *
   * `~/Downloads/wishworks-ready` is where `npm run finish` has always written and where a person
   * can actually find things — the workspace can sit under Application Support, which is hidden
   * in Finder, and these are the files that get picked up by hand and uploaded.
   */
  orders: {
    dir: ORDERS_DIR,
    label: "Packing records",
    what: "what was ordered each day and who packed it — the pay record, worth putting on a synced drive",
  },
  ready: {
    dir: folderPath("ready", path.join(app.getPath("downloads"), "wishworks-ready")),
    label: "Finished images (the ready folder)",
    what: "the finished images, descriptions already inside them — the folder to share on Drive",
  },
} as const;

ipcMain.handle("folders", () =>
  Object.fromEntries(Object.entries(FOLDERS).map(([k, v]) => [k, { ...v }])),
);

/**
 * Put loose files in the ready folder into the `GTB/`, `ANP/`, `HBD/peppa/` … folders they belong in.
 *
 * The finish step has grouped by SKU code since WW-156, but everything finished BEFORE that is
 * still lying in the root — 48 files on Vansh's machine — and the grouping is only useful if it
 * covers the lot. This is that one-off catch-up, and it stays available because a file can always
 * arrive in the root by hand.
 *
 * `skuGroup` and `themeIn` from the engine, not copies: this MOVES files, so it has to agree with
 * the code that names the folders, not merely follow the same rule. Only files are moved, and
 * nothing is ever overwritten — a name already taken in the group folder is left where it is and
 * reported, because two different images called `GTB-2.1.jpg` is a real possibility and silently
 * keeping one of them is the wrong answer to it. Folders in the root are left alone entirely.
 */
ipcMain.handle("tidyReady", async () => {
  const { skuGroup } = await import("../src/finish-core.js");
  const { themeIn } = await import("../src/id.js");
  const dir = FOLDERS.ready.dir;
  let moved = 0;
  const clashed: string[] = [];
  const groups = new Set<string>();

  /**
   * The root, plus the group folders this button made — and nothing else.
   *
   * Its own folders are re-read so the button is **self-correcting**: the grouping rule changed
   * once already (WW-165 moved combos from their first code to their last), and a file filed
   * under the old rule has to be able to find its way to the new one. `^[A-Z]+$` is how it tells
   * its own folders from a real one somebody made — `Inventory list/` is a folder Vansh keeps
   * there, and walking into it would scatter its contents across the tree.
   */
  const top = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const tags = top.filter((e) => e.isDirectory() && /^[A-Z]+$/.test(e.name)).map((e) => e.name);
  /**
   * Its own theme folders too — `HBD/peppa` — so this stays self-correcting now that the rule has
   * a second level. Theme folders are lower case, which is what tells them from a folder somebody
   * made: `Inventory list/` lives in the ready folder and walking into it would scatter it.
   */
  const themes = (
    await Promise.all(
      tags.map(async (tag) =>
        (await readdir(path.join(dir, tag), { withFileTypes: true }).catch(() => []))
          .filter((e) => e.isDirectory() && /^[a-z]+$/.test(e.name))
          .map((e) => path.join(tag, e.name)),
      ),
    )
  ).flat();
  const from = ["", ...tags, ...themes];

  for (const sub of from) {
    const here = path.join(dir, sub);
    for (const e of await readdir(here, { withFileTypes: true }).catch(() => [])) {
      if (!e.isFile() || e.name.startsWith(".")) continue;
      const group = skuGroup(e.name);
      if (!group) continue; // no code in the name at all — the root is where it belongs
      // Tag, then theme. `themeIn` is "" for an un-themed name and for one whose theme was already
      // thrown away (`HBD-01`), so those stay one level up rather than being guessed into a folder.
      const want = path.join(group, themeIn(e.name));
      if (want === sub) continue; // already where it belongs
      const to = path.join(dir, want, e.name);
      if (existsSync(to)) {
        clashed.push(e.name);
        continue;
      }
      await mkdir(path.join(dir, want), { recursive: true });
      await rename(path.join(here, e.name), to);
      moved += 1;
      groups.add(want);
    }
  }
  return { moved, clashed, groups: [...groups].sort() };
});

/**
 * Point one of them somewhere else. Relaunches, like every other folder setting — `paths.ts`
 * reads `WW_*_DIR` once, at module load. Nothing is moved, so a wrong choice is undone by
 * choosing again.
 */
ipcMain.handle("chooseFolder", async (e, key: FolderKey): Promise<boolean> => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: FOLDERS[key].dir,
    message: `Where should WishWorks keep ${FOLDERS[key].what}?`,
  });
  if (canceled || filePaths.length === 0) return false;
  // Into the ACTIVE ACCOUNT when there is one. Writing the machine-wide key instead would hand
  // the partner's account this account's folders, which is the one thing accounts exist to stop.
  const st = readSettings();
  const i = st.activeAccount ?? 0;
  if (st.accounts?.[i]) {
    await writeSettings({
      accounts: st.accounts.map((a, n) =>
        n === i ? { ...a, folders: { ...a.folders, [key]: filePaths[0] } } : a,
      ),
    });
  } else await writeSettings({ [key]: filePaths[0] });
  relaunch();
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
  // With an account live, ITS folder is the workspace — writing the flat `workspace` setting here
  // would store a path that `storedWorkspace()` then ignores, which looks exactly like a button
  // that does nothing.
  const s = readSettings();
  const i = s.activeAccount ?? 0;
  if (s.accounts?.[i]) {
    await writeSettings({
      accounts: s.accounts.map((a, n) => (n === i ? { ...a, workspace: filePaths[0] } : a)),
    });
  } else await writeSettings({ workspace: filePaths[0] });
  relaunch();
  return true;
});

// ---------------------------------------------------------------- seller accounts

/**
 * Four seller accounts, two people each, and one app that says whose data is on screen (WW-154).
 *
 * There is nothing here but a list and an index. The sharing is Google Drive's — one account is
 * one Gmail is one Drive folder, shared with exactly that pair — so this code never authenticates
 * anybody, never talks to an API, and never keeps a second copy of anything. It points the
 * workspace at a folder, which is all a Drive folder needs.
 */
ipcMain.handle("accounts", () => {
  const s = readSettings();
  // `activeAccount` being UNSET is the record of "nobody has chosen yet" — no second flag, and
  // nothing to keep in step with it. Every path that picks an account writes it.
  return { accounts: s.accounts ?? [], active: s.activeAccount ?? 0, chosen: s.activeAccount !== undefined };
});

/**
 * Answer the launch screen without relaunching.
 *
 * `switchAccount` restarts the app because the folders are read once, at startup — but confirming
 * the account that is ALREADY open changes no folder, and a restart there would look like a crash
 * to somebody who has just told the app who they are.
 */
ipcMain.handle("confirmAccount", async (_e, index: number) => {
  await writeSettings({ activeAccount: index });
});

/**
 * The login — a username and a password, on a machine that has neither yet.
 *
 * **The workspace is derived, not asked for.** Being made to pick a folder was the first thing a
 * new person saw and the one question they could not answer; it lands under the app's own data
 * folder, named after the user, and Settings moves it later. What matters on day one is only that
 * two logins never share one.
 */
ipcMain.handle("signUp", async (_e, user: string, password: string): Promise<Attempt<void>> => {
  const { hashPassword, userFolder } = await import("../src/auth.js");
  const name = user.trim();
  if (name === "") return { ok: false, message: "Type a username." };
  if (password.length < 4) return { ok: false, message: "Use at least 4 characters." };
  const s = readSettings();
  const accounts = s.accounts ?? [];
  if (accounts.some((a) => (a.user ?? a.label).toLowerCase() === name.toLowerCase())) {
    return { ok: false, message: `${name} already has a login on this computer.` };
  }
  /**
   * **The first login on a machine adopts the folder that machine was already using.**
   *
   * Signing up is not "start again" — this app has been in use for weeks before logins existed,
   * and inventing an empty workspace for the first account hides every product, listing and costed
   * kit behind a screen that was sold as *tell us your name*. It looked exactly like data loss
   * (WW-177). A SECOND account does get a folder of its own, because two logins sharing one
   * workspace is the thing accounts exist to prevent.
   */
  const next = [
    ...accounts,
    {
      label: name,
      user: name,
      password: hashPassword(password),
      workspace:
        accounts.length === 0 && s.workspace
          ? s.workspace
          : path.join(USER_DATA, "workspaces", userFolder(name)),
    },
  ];
  await writeSettings({ accounts: next, activeAccount: next.length - 1 });
  relaunch();
  return { ok: true, result: undefined };
});

/**
 * Sign in as one of the logins this computer holds.
 *
 * **An account with no password stored gets one from this attempt** rather than being refused:
 * accounts existed before logins did, and locking somebody out of their own workspace to enforce a
 * rule that did not exist when they made it would be the wrong way round.
 *
 * Signing into the account already open does not relaunch — nothing about the folders changed.
 */
ipcMain.handle("signIn", async (_e, user: string, password: string): Promise<Attempt<void>> => {
  const { hashPassword, verifyPassword } = await import("../src/auth.js");
  const s = readSettings();
  const accounts = s.accounts ?? [];
  const i = accounts.findIndex((a) => (a.user ?? a.label).toLowerCase() === user.trim().toLowerCase());
  // One message for both halves on purpose: naming which half was wrong tells whoever is typing
  // which usernames exist on the machine.
  if (i === -1) return { ok: false, message: "That username and password do not match." };

  const account = accounts[i];
  if (account.password === undefined) {
    if (password.length < 4) return { ok: false, message: "Use at least 4 characters." };
    accounts[i] = { ...account, user: account.user ?? account.label, password: hashPassword(password) };
    await writeSettings({ accounts });
  } else if (!verifyPassword(password, account.password)) {
    return { ok: false, message: "That username and password do not match." };
  }

  const same = s.activeAccount === i;
  await writeSettings({ activeAccount: i });
  if (!same) relaunch();
  return { ok: true, result: undefined };
});

/** Ask again next launch. Only the pointer is cleared — no account and no file is touched. */
ipcMain.handle("signOut", async () => {
  const s = readSettings();
  delete s.activeAccount;
  await writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2));
});

ipcMain.handle("switchAccount", async (_e, index: number) => {
  await writeSettings({ activeAccount: index });
  relaunch();
});

ipcMain.handle("addAccount", async (e, label: string, skuPrefix: string): Promise<boolean> => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    // NOT a Drive folder. This holds the raw photos and the AI's downloads — the working files,
    // which Vansh was explicit should never sync. Only the finished images and the costed kits do.
    message: `Where should ${label || "this account"} keep its working files? A normal folder on this computer — not a Google Drive one.`,
  });
  if (canceled || filePaths.length === 0) return false;
  const s = readSettings();
  const accounts = [...(s.accounts ?? []), { label, workspace: filePaths[0], skuPrefix: skuPrefix || undefined }];
  // Switch to what was just added: adding an account you then have to select is a two-step
  // version of a one-step intention, and the un-switched state is the confusing one.
  await writeSettings({ accounts, activeAccount: accounts.length - 1 });
  relaunch();
  return true;
});

/**
 * Forget an account. Nothing in its folder is touched — this list is only which accounts this
 * machine offers, so removing the wrong one costs an Add, not any data.
 */
ipcMain.handle("removeAccount", async (_e, index: number) => {
  const accounts = (readSettings().accounts ?? []).filter((_, i) => i !== index);
  // Back to the first one rather than trying to keep pointing at the same account: the surviving
  // indices all shifted, and "which account am I on" must never be a guess.
  await writeSettings({ accounts, activeAccount: 0 });
  relaunch();
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

  /**
   * A right-click menu. Electron shows NONE by default, so right-click → Paste in a text box did
   * nothing — Vansh, 2026-09-17, on the "Paste a list" box: *"this is not letting me paste anything."*
   * The partner on Windows pastes this way as often as with a shortcut.
   */
  win.webContents.on("context-menu", (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = params.isEditable
      ? [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }]
      : params.selectionText
        ? [{ role: "copy" }]
        : [];
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
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

/**
 * Create every folder the app writes to, once, at launch.
 *
 * **A fresh install has none of them**, because each one used to be created by whichever step
 * wrote to it first — and the steps that only READ (the listing picker, "no file matches", every
 * *Open it* button) got a missing folder instead. That is three different first-run symptoms with
 * one cause: `shell.openPath` on a missing folder does nothing at all, silently; `readdir` throws
 * ENOENT, which reads as "the button does nothing"; and `whyNoMatch` correctly says the folder
 * does not exist, which sends someone off to create it by hand in a guessed location.
 *
 * Vansh, 2026-08-15, on a new Windows PC: *"when i click bring files for the first time at page 3
 * in a new windows pc, these folders aren't created by default with correct location."* Doing it
 * here rather than in each caller means no step can be the one that forgot — and `mkdir
 * -recursive` on a folder that exists is free, so it costs nothing on every later launch.
 *
 * Deliberately NOT fatal. A folder on a disconnected drive or a path the user cannot write to is
 * a real situation, and the panel that needs it will say so in words; refusing to start the whole
 * app over one folder would be a far worse answer.
 */
async function ensureFolders(): Promise<void> {
  for (const { dir } of Object.values(FOLDERS)) {
    await mkdir(dir, { recursive: true }).catch(() => {});
  }
}

app.whenReady().then(() => {
  /**
   * Serve one local file. The URL is built by `fileUrl` in the renderer, one encoded segment at a
   * time, so this is the exact reverse: decode the path back out and let Electron read it.
   *
   * The Windows case is the one to keep: `C:\Users\…` arrives as `/C:/Users/…` — a standard
   * scheme always has a leading slash on its path — and `pathToFileURL` needs it gone.
   */
  protocol.handle("ww-file", (request) =>
    net.fetch(pathToFileURL(filePathFromUrl(request.url)).toString()),
  );

  void ensureFolders();
  createWindow();
  void checkForUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * **Close both Chromes properly before the app exits — this is what keeps the logins.**
 *
 * Without it, Playwright's own exit hook SIGKILLs every browser it launched (read in
 * `playwright-core`'s process launcher). A killed Chrome never flushes its cookies, so the next
 * launch holds half a session: the dashboard thinks it is logged in, the server does not, and the
 * page bounces between `#dashboard/home-page` and the login screen on its own — no automation
 * running, and "Log in to Flipkart" bouncing too. Vansh, 2026-09-16, after a day of app restarts:
 * *"now even the login to flipkart page is refreshing again and again."* Every quit did this,
 * including the partner's on Windows, where the kill is `taskkill /F`.
 */
let closingBrowsers = false;
app.on("before-quit", (e) => {
  if (closingBrowsers) return;
  closingBrowsers = true;
  e.preventDefault();
  void browserEngine()
    .then(async (b) => {
      await Promise.all([b.closeSession(), b.closeChat()]);
    })
    .catch(() => {})
    .finally(() => app.quit());
});
// `npm run gui` restarting on a code change sends SIGTERM, which skips `before-quit` — route it there.
process.on("SIGTERM", () => app.quit());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

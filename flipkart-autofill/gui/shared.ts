/**
 * shared.ts — the ONLY contract between the Electron main process and the renderer.
 *
 * Main owns the engine (fs, sharp, Playwright). The renderer owns pixels and nothing else —
 * no `node:` imports, no `require`, `contextIsolation: true`. Everything that crosses between
 * them is declared here and imported by main.ts, preload.ts and the renderer alike, so a
 * channel can never be renamed on one side only.
 *
 * What crosses: paths and small JSON. Never image bytes. Thumbnails are `file://` URLs
 * pointing at the real files on disk, because base64 through IPC would copy every photo
 * twice for no reason.
 */

// The engine's own row type, imported rather than re-declared. Type-only, so nothing from
// images-core.ts is bundled into the renderer.
import type { Row } from "../src/images-core.js";
import type { FinishResult } from "../src/finish-core.js";
import type { InboxItem, ImportResult } from "../src/inbox.js";
import type { Listing } from "../src/listings.js";
import type { PasteResult } from "../src/paste-core.js";
import type { CheckResult } from "../src/check-core.js";
import type { FillResult, SessionStatus } from "../src/browser-core.js";
import type { DefaultsTab, FieldRow, ScanResult } from "../src/listing.js";
import type { PromptFile } from "../src/prompts.js";
import type { ListingFolder, PhotoImport, PhotoItem } from "../src/photo-inbox.js";
import type { CostedLine, Kit, KitLine, KitRow, Material, SavedKit } from "../src/inventory-core.js";
import type { OrderDay, OrderRow } from "../src/orders-core.js";
import type { Box, Parcel } from "../src/packaging.js";
export type { PromptFile, ListingFolder, PhotoImport, PhotoItem };
export type {
  Row, FinishResult, InboxItem, ImportResult, Listing, PasteResult, CheckResult,
  FillResult, SessionStatus, DefaultsTab, FieldRow, ScanResult, CostedLine, Kit, KitLine, KitRow, Material, SavedKit, Parcel, Box,
  OrderDay, OrderRow,
};

/**
 * The folders a user can move, each stored in `settings.json` and read once into a `WW_*_DIR`.
 *
 * **Every one of them is per-account.** Two accounts on one machine do not share data — that is
 * the entire point of accounts — so they must not share the folders that data lives in either.
 * An account's own value wins; without one, the machine-wide value; without that, the default.
 */
export type FolderKey = "images" | "meta" | "products" | "kits" | "ready";

/** Anything that talks to the browser can fail for ordinary reasons; none of them are crashes. */
export type Attempt<T> = { ok: true; result: T } | { ok: false; message: string };

/**
 * One seller account: one Gmail, one Flipkart + Meesho login, one Drive folder (WW-154).
 *
 * There is no login screen and no server behind this. The isolation is Google's folder sharing —
 * the pair who work an account have the folder shared with them and nobody else does. A password
 * check inside an Electron app would be theatre: the files sit on the local disk and Explorer
 * opens them whatever this UI says.
 */
export interface Account {
  /** What goes on screen — `GTB — gtb.wishworks@gmail.com`. Free text; nothing parses it. */
  label: string;
  /** The folder this account's working files live in — local, not Drive. */
  workspace: string;
  /**
   * This account's own folder overrides, when one should not sit inside its workspace.
   *
   * Per-account and not machine-wide, because *"after logging in for my account, my folder
   * details should stay diff then my partner's one"* (Vansh, 2026-08-15). The `ready` folder is
   * the one that matters most: it is the shared Drive folder, and two accounts pointing at one
   * would put two sellers' finished images in the same place.
   */
  folders?: Partial<Record<FolderKey, string>>;
  /**
   * Seller-panel pages saved for THIS account. A remembered URL carries that seller's own ids,
   * so a shared list would open the wrong seller's dashboard from a correctly-named button.
   */
  shortcuts?: { name: string; url: string }[];
  /** Optional. **Unset means no flagging at all** — an account that never wants it never sees it. */
  skuPrefix?: string;
  /**
   * The login. `user` is typed on the launch screen; `password` is a scrypt salt and hash, never
   * the password itself (`src/auth.ts`). Absent on an account made before the login existed —
   * the first sign-in sets one rather than locking anybody out.
   */
  user?: string;
  password?: { salt: string; hash: string };
}

/**
 * Which category an ID belongs to — the LAST code in it, or the letters it starts with.
 *
 * A combo carries two: `SVP033 - ANP002` is an Annaprashan kit that also has a combo number, and
 * Vansh files it under `ANP`. *"also keep this under anp only"* — the trailing code is what the
 * kit IS; the leading one is a number it was given.
 *
 * A code is spelt `AA9` or `AAA9` — two or three capitals with digits against them — and that
 * shape is the whole rule, because it is the only thing separating a second code from a variant
 * NAME. `HBD-Kitty01` and `HBD-DORE01` are Happy Birthday kits called Kitty and Doraemon, not
 * kits of some `KITTY` category, and every looser rule put them there: mixed case is out on
 * `Kitty`, and the two-or-three-letter limit is what keeps `DORE` out. Falling back to the
 * leading letters covers `GTB-1` and `HBD-space001`, where nothing matches that shape at all.
 *
 * The same rule as `skuGroup` in `finish-core.ts`, which is what actually names the subfolders in
 * the ready folder. Repeated rather than imported because that file pulls in sharp and `node:fs`,
 * and the renderer must not; if the two ever disagree the ENGINE wins and this is merely a label.
 * Kept identical on purpose: a kit grouped under `GTB` on screen is filed under `GTB` on disk.
 *
 * "" for an ID starting with no letters, which groups nothing rather than inventing a group.
 */
export function skuPrefix(id: string): string {
  const codes = [...id.matchAll(/\b([A-Z]{2,3})\d+/g)];
  if (codes.length > 0) return codes[codes.length - 1][1];
  return /^[A-Za-z]+/.exec(id)?.[0].toUpperCase() ?? "";
}

/**
 * Every `<letters><number>` pair in an ID, so a combo says which numbers it uses up.
 *
 * `WKU003-GTB001` is one listing and it takes BOTH `WKU003` and `GTB001` — asking "what is the
 * next free GTB" while only reading the leading letters would happily hand back a number that is
 * already on a kit. Leading zeros are dropped, so `ANP004` and `ANP4` are the same number, because
 * on disk they have been written both ways.
 */
export function skuNumbers(id: string): [string, number][] {
  return [...id.matchAll(/([A-Za-z]+)[\s_-]*0*(\d+)/g)].map(([, p, n]) => [p.toUpperCase(), Number(n)]);
}

/**
 * Does this listing ID belong to the account whose SKUs start with `prefix`?
 *
 * Lives here rather than in `src/` because both sides need it and `src/id.ts` imports `node:fs`,
 * which the renderer cannot have. True when there is no prefix, which is what makes an unset
 * `skuPrefix` mean "never flag". IDs arrive normalised (`ANP-003` → `ANP3`), so the prefix is
 * normalised the same crude way rather than trusting however it was typed in.
 */
export function isForAccount(id: string, prefix?: string): boolean {
  const strip = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const p = strip(prefix ?? "");
  return p === "" || strip(id).startsWith(p);
}

/**
 * Steps that open a picker each remember their own folder. One global "last folder" would have
 * converting (which reaches for ~/Downloads) fighting finishing (the WhatsApp archive).
 */
export type StepId =
  | "convert" | "hero" | "info" | "copy" | "finish" | "check" | "inbox" | "inventory"
  // Two on the orders screen, because they open on different things: the manifest comes out of
  // the browser's downloads, a product picture out of wherever the photos are kept.
  | "orders" | "orders-image";

/**
 * The tag clean-up, which belongs on this step because the engine does it here: cropping and
 * painting are stage-1 options on `runImages()`, the same call that converts. GUI-SPEC used to
 * put them on a separate "Prepare images" step; there is no separate engine pass to hang that on,
 * and splitting them would mean converting twice.
 *
 * Positions are 1-based and match the numbers the images end up with, so "images 2,3,4" on screen
 * means `2.jpg 3.jpg 4.jpg`. Empty list = every image.
 */
export interface CleanUp {
  /** Pixels off the bottom. 0 = don't crop. Image 1 gets this: the AI replaces it anyway. */
  cropBottom: number;
  cropImages: number[];
  /** [width, height] of the white patch painted at bottom-left. null = don't paint. */
  eraseTag: [number, number] | null;
  eraseImages: number[];
}

export interface ConvertResult {
  /** The product folder name, taken from the folder that was dropped in. */
  product: string;
  /** Where the converted images landed, for the "open folder" button. */
  outDir: string;
  rows: Row[];
  failures: string[];
  /** Set when the dropped folder held no images the engine can read. */
  empty: boolean;
}

export interface WwApi {
  /** The real filesystem path of a dragged-in file or folder. Empty string if there isn't one. */
  pathForFile(file: File): string;
  /**
   * Open a picker at this step's remembered folder. Empty array = cancelled.
   *
   * Folder and file modes are separate calls because Windows cannot show one dialog that accepts
   * both — it honours whichever property came first — and the two machines must behave alike.
   */
  pick(step: StepId, mode: "folder" | "files"): Promise<string[]>;
  /** Stage 1: copy a folder OR loose image files into the workspace and run the pipeline. */
  convert(input: string[], cleanUp: CleanUp): Promise<ConvertResult>;
  /** Rows as they land. Returns an unsubscribe function. */
  onRow(cb: (row: Row) => void): () => void;
  /** For the Settings panel: what each step currently remembers. */
  rememberedFolders(): Promise<Partial<Record<StepId, string>>>;
  /** Forget them all. The app must keep working with nothing remembered. */
  clearFolders(): Promise<void>;
  /** Reveal a path in Finder/Explorer. */
  showFolder(dir: string): Promise<void>;
  /** Where the workspace lives, shown once in Settings so it is never a mystery. */
  workspaceDir(): Promise<string>;
  /** Whether this machine may edit the shipped prompt files. Always true in development. */
  editPrompts(): Promise<boolean>;
  /** Turn that on or off. Takes effect on the next prompt opened; nothing restarts. */
  setEditPrompts(on: boolean): Promise<void>;
  /** Pick a new workspace. Relaunches the app on success; false means the user cancelled. */
  chooseWorkspace(): Promise<boolean>;

  /**
   * The seller accounts on this machine and which one is live. Empty list = nobody has set one up,
   * and the app behaves exactly as it did before WW-154.
   */
  /**
   * `chosen` is false until somebody has actually picked an account on this machine — which is
   * what the launch screen asks, and why it is not the same question as "is there one in the
   * list". It stays true from then on, so the app asks once and remembers.
   */
  accounts(): Promise<{ accounts: Account[]; active: number; chosen: boolean }>;
  /** Confirm the account already open, without the relaunch a real switch needs. */
  confirmAccount(index: number): Promise<void>;
  /**
   * Make the login for a machine that has none: a username, a password, and a workspace folder
   * named after the user. Relaunches into it.
   */
  signUp(user: string, password: string): Promise<Attempt<void>>;
  /**
   * Sign in. Wrong name or wrong password comes back as a message, never as a thrown error —
   * mistyping a password is the most ordinary thing that happens on this screen.
   */
  signIn(user: string, password: string): Promise<Attempt<void>>;
  /** Ask for the password again on the next launch. Deletes nothing. */
  signOut(): Promise<void>;
  /** Work a different account. Relaunches — the engine resolves its folders once, at startup. */
  switchAccount(index: number): Promise<void>;
  /** Add one: names it, then asks for its Drive folder. Relaunches; false means cancelled. */
  addAccount(label: string, skuPrefix: string): Promise<boolean>;
  /** Forget one. Nothing on disk is touched — only this machine stops offering it. */
  removeAccount(index: number): Promise<void>;

  /**
   * Every folder the app writes to, with the words the Settings panel shows for it.
   *
   * One call rather than a getter per folder: four channels that must stay in step is four
   * chances for the screen to describe a folder the code does not use (WW-153).
   */
  folders(): Promise<Record<FolderKey, { dir: string; label: string; what: string }>>;
  /** Point one of them somewhere else. Relaunches on success; false means cancelled. */
  chooseFolder(key: FolderKey): Promise<boolean>;

  /** Every listing this machine knows about, newest first. */
  listings(): Promise<Listing[]>;
  /** A prompt file's entire text, for the one-click copy. */
  promptText(file: string): Promise<string>;
  /** The prompt plus where it saves and every version kept. */
  readPrompt(file: string): Promise<PromptFile>;
  /** Save an edit, keeping what it said before as a dated version. */
  savePrompt(file: string, text: string): Promise<PromptFile>;
  readVersion(file: string): Promise<string>;

  /** The shipped price list, for the correction dropdowns. */
  materials(): Promise<Material[]>;
  /**
   * What the price list still needs — rows with a blank price cell, and rows with no size.
   * Surfaced in the app because a gap nobody can see is a gap nobody fills.
   */
  materialGaps(): Promise<{ noPrice: Material[]; noSize: Material[]; total: number }>;
  /**
   * Read the AI's reply and price it. `overrides` maps a line index to `category|material` — what
   * the correction dropdown sends. Re-runs on every correction; it is a few dozen multiplications.
   */
  costInventory(file: string, overrides: Record<number, string>): Promise<Attempt<Kit>>;
  /**
   * The same, from text pasted straight out of the chat. The reply arrives as a ```json code
   * block, not a download, so this is the normal route and the file is the exception. The fence
   * and any prose around it are tolerated.
   */
  costPasted(text: string, overrides: Record<number, string>): Promise<Attempt<Kit>>;
  /** The same, for a kit already read once — reopening, or re-costing after a correction. */
  costLines(
    lines: KitLine[],
    overrides: Record<number, string>,
    sku: string,
    /** Unit prices for THIS kit only, keyed `category|material`. */
    prices: Record<string, number>,
    /** Corrected counts, by line index. */
    counts: Record<number, number>,
  ): Promise<Kit>;
  /**
   * Change a price in the shipped list — every kit, both machines. Refused in a packaged app,
   * where the list is read-only and a change has to go out as a release.
   */
  setMaterialPrice(key: string, paise: number | null): Promise<Attempt<Material[]>>;

  /** Add a material the list has never had. Refused in a packaged app, same as the price above. */
  addMaterial(row: { category: string; material: string; paise: number | null }): Promise<Attempt<Material[]>>;

  /**
   * The posted parcel for a kit — size, weight, volumetric weight, and the two forms Flipkart
   * asks for. Computed from the inventory (src/packaging.ts), never guessed per listing.
   */
  parcelFor(
    lines: KitLine[],
    /** A size or weight chosen by hand. Only the fields given overrule the rules. */
    chosen: { lengthCm?: number; breadthCm?: number; heightCm?: number; grams?: number },
  ): Promise<{
    parcel: Parcel;
    /** The polybag sizes on the shelf, for the picker. */
    boxes: Box[];
    packageDetails: Record<string, string>;
    dimensions: Record<string, string>;
  } | null>;

  /** Keep a costed kit. The reading and the corrections are stored; the total never is. */
  saveKit(kit: SavedKit): Promise<string>;
  /**
   * Write the kits out as a spreadsheet and return where it landed, or null if cancelled.
   * Pass a kit's file to export just that one, or null for all of them.
   */
  exportKits(only: string | null): Promise<string | null>;
  /** Reveal the folder the saved kits live in — for looking at, backing up, or syncing. */
  openKitsFolder(): Promise<void>;
  /**
   * File every loose image in the ready folder under its SKU code — `GTB-2.1.jpg` into `GTB/`.
   * Never overwrites: a name already taken in the group folder is left alone and named back.
   */
  tidyReady(): Promise<{ moved: number; clashed: string[]; groups: string[] }>;
  /** Every kit kept on this machine, newest first. */
  listKits(): Promise<KitRow[]>;
  openKit(file: string): Promise<SavedKit>;
  /** Remove a saved kit's file — how a rename gets rid of the kit's old name. Kits folder only. */
  deleteKit(file: string): Promise<void>;

  /** Match downloaded pictures to the listing folders under an archive root. Changes nothing. */
  scanPhotos(from: string, root: string): Promise<PhotoItem[]>;
  /** File one picture as `<position>.<ext>`, removing whatever else held that position. */
  importPhoto(item: PhotoItem, position: number, opts: { move?: boolean }): Promise<PhotoImport>;
  listingFolders(root: string): Promise<ListingFolder[]>;
  /** Every check `npm run paste` runs, for one listing. */
  paste(id: string): Promise<{ ok: true; result: PasteResult } | { ok: false; message: string }>;
  /** Remove emoji from the Flipkart-bound values of a listing written before the rule existed. */
  stripEmoji(id: string): Promise<{ file: string; changed: string[] }>;
  /** The listing file as text, for editing in the app rather than in a code editor. */
  readProduct(id: string): Promise<Attempt<{ file: string; text: string }>>;
  /** Save it back. Refused unless it parses, so a half-typed file can never reach the bot. */
  saveProduct(file: string, text: string): Promise<Attempt<string>>;
  /**
   * Write a costed kit's parcel into `products/<id>.json`. Only the dimension keys are writable —
   * see applyParcelToListing, which owns the whitelist.
   */
  applyParcel(
    id: string,
    /** The inches block, plus `packageDetails` — the same box in cm/kg for the Price/Stock tab. */
    dimensions: Record<string, string | Record<string, string>>,
  ): Promise<
    | { ok: true; result: { file: string; changed: { key: string; from: string | null; to: string }[] } }
    | { ok: false; message: string }
  >;

  /**
   * Read a manifest PDF and fold it into the day it names. Returns the whole day, packing and
   * all. Dropping the same file twice changes nothing — see `mergeManifest`.
   */
  addManifest(file: string): Promise<Attempt<OrderDay>>;
  /** Every day recorded on this machine, newest first. Small files; a month of them is pay day. */
  orderDays(): Promise<OrderDay[]>;
  /** Write a day back after ticking off some packing. The panel owns the whole object. */
  saveDay(day: OrderDay): Promise<void>;
  /**
   * A finished image for a SKU out of the ready folder — `2` is what goes in the packet and is
   * what the packing screen opens on, `1` is the main photo. Null when that SKU has no image in
   * that slot, which is a normal state and one the panel draws rather than treating as an error.
   */
  skuImage(sku: string, position: number): Promise<string | null>;
  /**
   * Put a picture on a SKU by hand, filed under its code in the ready folder — for every SKU that
   * never went through this app's finish step, which is all of the partner's.
   */
  addSkuImage(sku: string, position: number, file: string): Promise<string>;
  /** The people who pack, for the tick-off list. One setting, replaced whole. */
  workers(): Promise<string[]>;
  setWorkers(names: string[]): Promise<void>;

  /** Where the AI's downloads land. Remembered, defaults to ~/Downloads. */
  downloadsDir(): Promise<string>;
  /** What importing that folder would do. Changes nothing. */
  scanInbox(from: string): Promise<InboxItem[]>;
  /** File everything new or newer into image-meta/ and products/. */
  importInbox(from: string, opts: { move?: boolean; only?: string[] }): Promise<ImportResult>;
  /** File specific dropped .json files, deciding the folder from their content. */
  fileOne(files: string[]): Promise<ImportResult>;

  /** Stamp descriptions into finished images. `id` renames, `metaId` picks descriptions — never
   *  derive one from the other, that was WW-078. */
  finish(o: { inDir: string; outDir: string; id?: string | null; metaId?: string | null }): Promise<FinishResult>;

  /** Read the descriptions back out of finished images. */
  check(target: string): Promise<{ ok: true; result: CheckResult } | { ok: false; message: string }>;
  /** Absolute path of a listing's clean folder, from its REAL folder name. */
  cleanFolder(folder: string): Promise<string>;

  /** Open the real Chrome with the saved seller session. Defaults to the dashboard, never a
   *  login page; pass a saved shortcut's URL to land somewhere else. */
  openChrome(url?: string): Promise<Attempt<SessionStatus>>;
  /** Pages the user chose to remember. Not a guessed list of Flipkart routes — see main.ts. */
  shortcuts(): Promise<{ name: string; url: string }[]>;
  /** Save whatever page Chrome is on right now under this name. Null if it is on nothing. */
  rememberPage(name: string): Promise<{ name: string; url: string } | null>;
  forgetPage(name: string): Promise<{ name: string; url: string }[]>;
  /** Never navigates, so polling it cannot interrupt an OTP. */
  chromeStatus(): Promise<SessionStatus>;
  /** Closes Chrome gracefully. Only ever called from a button — never automatically. */
  closeChrome(): Promise<void>;
  /** Type a listing's values into whatever form is open in Chrome. `tab` picks the defaults
   *  file, which is what keeps an inches Height off the centimetres tab — see DefaultsTab. */
  fillListing(id: string, tab?: DefaultsTab): Promise<Attempt<FillResult>>;
  /** Click Save. **Refuses while any field reads ⚠️** — the guard is in the engine, not here. */
  saveListing(): Promise<Attempt<{ clicked: string | null; candidates: string[] }>>;
  /** Capture the field labels of the tab Chrome is showing, into `categories/<category>.json`.
   *  Adds only; never types into the form, never touches a listing. */
  scanTab(id: string): Promise<Attempt<ScanResult>>;
  /** Fields as they land during a fill. Returns an unsubscribe function. */
  onField(cb: (row: FieldRow) => void): () => void;
}

declare global {
  interface Window {
    ww: WwApi;
  }
}

/**
 * A local path as a `ww-file://` URL, and back again — the pair that puts a picture on screen.
 *
 * **They live together because they are one rule read in two directions**, and they run in two
 * different processes: `fileUrl` in the renderer, `filePathFromUrl` in the protocol handler in
 * `gui/main.ts`. Split across those two files they drifted silently; the failure is a broken
 * image, which looks exactly like *there is no picture*, which is a state the app draws on purpose
 * (WW-177, C-064).
 *
 * **Not `file://`.** The renderer in development is served from `http://localhost:5173`, and
 * Chromium refuses to load a local file from an http page — every thumbnail in the app was broken
 * in development and fine when packaged, which is the worst way round.
 *
 * Each segment is encoded separately, which is what makes a folder with a space in it work — the
 * default workspace sits under "Application Support".
 *
 * **`//local/` and not `///`, and this is the whole trick.** The scheme is registered as
 * `standard`, so Chromium parses it with an authority: `ww-file:///Users/vansh/x.jpg` has its
 * FIRST SEGMENT taken as the host and lower-cased, arriving at the handler as
 * `ww-file://users/vansh/x.jpg` — one folder eaten, another case-mangled. A constant host nobody
 * reads keeps the whole path in the path. A URL round-trip test does not catch this: the mangling
 * happens inside Chromium, between the two functions (WW-178).
 */
export const fileUrl = (p: string) =>
  "ww-file://local/" + p.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent).join("/");

/**
 * The path back out of one of those URLs.
 *
 * The Windows case is the whole reason this is a function: `C:\\Users\\…` goes out as
 * `/C:/Users/…` — a standard scheme always has a leading slash on its path — and it has to come
 * off again, or the file is looked for at a path that starts with a slash and a drive letter.
 */
export function filePathFromUrl(url: string): string {
  const decoded = decodeURIComponent(new URL(url).pathname);
  return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}

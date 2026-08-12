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
import type { Box, Parcel } from "../src/packaging.js";
export type { PromptFile, ListingFolder, PhotoImport, PhotoItem };
export type {
  Row, FinishResult, InboxItem, ImportResult, Listing, PasteResult, CheckResult,
  FillResult, SessionStatus, DefaultsTab, FieldRow, ScanResult, CostedLine, Kit, KitLine, KitRow, Material, SavedKit, Parcel, Box,
};

/** Anything that talks to the browser can fail for ordinary reasons; none of them are crashes. */
export type Attempt<T> = { ok: true; result: T } | { ok: false; message: string };

/**
 * Steps that open a picker each remember their own folder. One global "last folder" would have
 * converting (which reaches for ~/Downloads) fighting finishing (the WhatsApp archive).
 */
export type StepId =
  | "convert" | "hero" | "info" | "copy" | "finish" | "check" | "inbox" | "inventory";

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
  /** Where that folder is, shown in Settings so it is never a mystery. */
  kitsFolder(): Promise<string>;
  /**
   * Point the kits at a folder of their own — a shared Drive folder, to share them with the other
   * machine. Relaunches on success; false means cancelled.
   */
  chooseKitsFolder(): Promise<boolean>;
  /** Every kit kept on this machine, newest first. */
  listKits(): Promise<KitRow[]>;
  openKit(file: string): Promise<SavedKit>;

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

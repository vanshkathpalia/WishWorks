/**
 * preload.ts — the only bridge between the renderer and the engine.
 *
 * Thin on purpose: every function here is one `invoke` and nothing else. Any logic that creeps
 * in would live in a process with node access and no tests, which is the worst of both. If a
 * handler needs to do something, it does it in main.ts.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  CleanUp, DefaultsTab, FieldRow, FolderKey, KitLine, PhotoItem, Row, SavedKit, StepId, WwApi,
} from "./shared.js";

const api: WwApi = {
  // Electron 32 removed the non-standard `File.path`, so a dropped folder's real location can
  // only be had here, in the preload, via webUtils. The renderer has no other way to learn it.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  pick: (step: StepId, mode: "folder" | "files") => ipcRenderer.invoke("pick", step, mode),
  convert: (input: string[], cleanUp: CleanUp) => ipcRenderer.invoke("convert", input, cleanUp),
  onRow: (cb: (row: Row) => void) => {
    const handler = (_e: unknown, row: Row) => cb(row);
    ipcRenderer.on("row", handler);
    return () => void ipcRenderer.off("row", handler);
  },
  rememberedFolders: () => ipcRenderer.invoke("rememberedFolders"),
  clearFolders: () => ipcRenderer.invoke("clearFolders"),
  showFolder: (dir: string) => ipcRenderer.invoke("showFolder", dir),
  workspaceDir: () => ipcRenderer.invoke("workspaceDir"),
  editPrompts: () => ipcRenderer.invoke("editPrompts"),
  setEditPrompts: (on: boolean) => ipcRenderer.invoke("setEditPrompts", on),
  chooseWorkspace: () => ipcRenderer.invoke("chooseWorkspace"),

  accounts: () => ipcRenderer.invoke("accounts"),
  confirmAccount: (index: number) => ipcRenderer.invoke("confirmAccount", index),
  signUp: (user: string, password: string) => ipcRenderer.invoke("signUp", user, password),
  signIn: (user: string, password: string) => ipcRenderer.invoke("signIn", user, password),
  signOut: () => ipcRenderer.invoke("signOut"),
  switchAccount: (index: number) => ipcRenderer.invoke("switchAccount", index),
  addAccount: (label: string, skuPrefix: string) =>
    ipcRenderer.invoke("addAccount", label, skuPrefix),
  removeAccount: (index: number) => ipcRenderer.invoke("removeAccount", index),

  folders: () => ipcRenderer.invoke("folders"),
  chooseFolder: (key: FolderKey) => ipcRenderer.invoke("chooseFolder", key),

  listings: () => ipcRenderer.invoke("listings"),
  promptText: (file: string) => ipcRenderer.invoke("promptText", file),
  readPrompt: (file: string) => ipcRenderer.invoke("readPrompt", file),
  savePrompt: (file: string, text: string) => ipcRenderer.invoke("savePrompt", file, text),
  readVersion: (file: string) => ipcRenderer.invoke("readVersion", file),

  materials: () => ipcRenderer.invoke("materials"),
  materialGaps: () => ipcRenderer.invoke("materialGaps"),
  costInventory: (file: string, overrides: Record<number, string>) =>
    ipcRenderer.invoke("costInventory", file, overrides),
  costPasted: (text: string, overrides: Record<number, string>) =>
    ipcRenderer.invoke("costPasted", text, overrides),
  costLines: (
    lines: KitLine[],
    overrides: Record<number, string>,
    sku: string,
    prices: Record<string, number>,
    counts: Record<number, number>,
  ) => ipcRenderer.invoke("costLines", lines, overrides, sku, prices, counts),
  editMaterial: (
    key: string,
    patch: {
      paise?: number | null; size?: string; material?: string; piecesPerPack?: number;
      category?: string; sellsAs?: string;
    },
  ) =>
    ipcRenderer.invoke("editMaterial", key, patch),
  addColour: (key: string, colour: string) => ipcRenderer.invoke("addColour", key, colour),
  addSize: (key: string, size: string) => ipcRenderer.invoke("addSize", key, size),
  addMaterial: (row: {
    category: string; material: string; paise: number | null;
    size?: string; piecesPerPack?: number;
  }) =>
    ipcRenderer.invoke("addMaterial", row),
  parcelFor: (lines: KitLine[], chosen: Record<string, number | undefined>) =>
    ipcRenderer.invoke("parcelFor", lines, chosen),
  saveKit: (kit: SavedKit) => ipcRenderer.invoke("saveKit", kit),
  exportKits: (only: string | null) => ipcRenderer.invoke("exportKits", only),
  openKitsFolder: () => ipcRenderer.invoke("openKitsFolder"),
  exportInventory: () => ipcRenderer.invoke("exportInventory"),
  importInventory: () => ipcRenderer.invoke("importInventory"),
  tidyReady: () => ipcRenderer.invoke("tidyReady"),
  listKits: () => ipcRenderer.invoke("listKits"),
  openKit: (file: string) => ipcRenderer.invoke("openKit", file),
  deleteKit: (file: string) => ipcRenderer.invoke("deleteKit", file),

  scanPhotos: (from: string, root: string) => ipcRenderer.invoke("scanPhotos", from, root),
  importPhoto: (item: PhotoItem, position: number, opts: { move?: boolean }) =>
    ipcRenderer.invoke("importPhoto", item, position, opts),
  listingFolders: (root: string) => ipcRenderer.invoke("listingFolders", root),
  paste: (id: string) => ipcRenderer.invoke("paste", id),
  stripEmoji: (id: string) => ipcRenderer.invoke("stripEmoji", id),
  readProduct: (id: string) => ipcRenderer.invoke("readProduct", id),
  saveProduct: (file: string, text: string) => ipcRenderer.invoke("saveProduct", file, text),
  applyParcel: (id: string, dimensions: Record<string, string | Record<string, string>>) =>
    ipcRenderer.invoke("applyParcel", id, dimensions),

  addManifest: (file: string) => ipcRenderer.invoke("addManifest", file),
  orders: () => ipcRenderer.invoke("orders"),
  addLabels: (file: string) => ipcRenderer.invoke("addLabels", file),
  latches: () => ipcRenderer.invoke("latches"),
  crawlSearch: (term: string, minutes: number) => ipcRenderer.invoke("crawlSearch", term, minutes),
  stopCrawl: () => ipcRenderer.invoke("stopCrawl"),
  shareLatches: (pack: string | null) => ipcRenderer.invoke("shareLatches", pack),
  importShared: (text: string) => ipcRenderer.invoke("importShared", text),
  latchPending: () => ipcRenderer.invoke("latchPending"),
  imageQueue: () => ipcRenderer.invoke("imageQueue"),
  runImages: (sku: string) => ipcRenderer.invoke("runImages", sku),
  runMeta: (sku: string) => ipcRenderer.invoke("runMeta", sku),
  meeshoQueue: () => ipcRenderer.invoke("meeshoQueue"),
  meeshoSheet: (skus: string[]) => ipcRenderer.invoke("meeshoSheet", skus),
  meeshoDone: (skus: string[]) => ipcRenderer.invoke("meeshoDone", skus),
  onImageStep: (cb) => {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on("imageStep", handler);
    return () => void ipcRenderer.off("imageStep", handler);
  },
  approvals: () => ipcRenderer.invoke("approvals"),
  sweepApproved: (minutes: number) => ipcRenderer.invoke("sweepApproved", minutes),
  onCrawlRow: (cb) => {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on("crawlRow", handler);
    return () => void ipcRenderer.off("crawlRow", handler);
  },
  checkLatches: (all: boolean, pack: string | null) => ipcRenderer.invoke("checkLatches", all, pack),
  showBatch: (size: number, pack: string | null, kind: "form" | "approval" = "form") =>
    ipcRenderer.invoke("showBatch", size, pack, kind),
  latchOpen: (withCosting: boolean) => ipcRenderer.invoke("latchOpen", withCosting),
  fillFrontLatch: (withCosting: boolean) => ipcRenderer.invoke("fillFrontLatch", withCosting),
  costingFront: () => ipcRenderer.invoke("costingFront"),
  saveForLater: (unpark: string | null) => ipcRenderer.invoke("saveForLater", unpark),
  showAgain: (fsn: string) => ipcRenderer.invoke("showAgain", fsn),
  openProduct: (fsn: string) => ipcRenderer.invoke("openProduct", fsn),
  recordApproval: (pasted: string) => ipcRenderer.invoke("recordApproval", pasted),
  approvalOpen: (pack: string | null, only: string[] | null) => ipcRenderer.invoke("approvalOpen", pack, only),
  sweepBrandsTyped: (typed: string, minutes: number) => ipcRenderer.invoke("sweepBrandsTyped", typed, minutes),
  openApprovalForm: (fsn: string) => ipcRenderer.invoke("openApprovalForm", fsn),
  markApplied: (fsn: string, withCosting: boolean) => ipcRenderer.invoke("markApplied", fsn, withCosting),
  copyProductLink: (fsn: string) => ipcRenderer.invoke("copyProductLink", fsn),
  latchOne: (fsn: string, withCosting: boolean) => ipcRenderer.invoke("latchOne", fsn, withCosting),
  onLatchRow: (cb) => {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on("latchRow", handler);
    return () => void ipcRenderer.off("latchRow", handler);
  },
  money: (from: string, to: string, market?: string) => ipcRenderer.invoke("money", from, to, market),
  rates: () => ipcRenderer.invoke("rates"),
  setRate: (name: string, paise: number) => ipcRenderer.invoke("setRate", name, paise),
  howItSells: (from: string, to: string, market?: string) =>
    ipcRenderer.invoke("howItSells", from, to, market),
  tallyNotes: (claimedNote: string, countedNote: string) =>
    ipcRenderer.invoke("tallyNotes", claimedNote, countedNote),
  setAlias: (name: string, key: string | null) => ipcRenderer.invoke("setAlias", name, key),
  learnWord: (from: string, to: string | null) => ipcRenderer.invoke("learnWord", from, to),
  learnedWords: () => ipcRenderer.invoke("learnedWords"),
  proposeWord: (note: string, key: string) => ipcRenderer.invoke("proposeWord", note, key),
  askSupplierWords: (note: string) => ipcRenderer.invoke("askSupplierWords", note),
  applySupplierWords: (chosen: unknown) => ipcRenderer.invoke("applySupplierWords", chosen),
  saveDelivery: (d: unknown) => ipcRenderer.invoke("saveDelivery", d),
  removeDelivery: (date: string) => ipcRenderer.invoke("removeDelivery", date),
  stock: () => ipcRenderer.invoke("stock"),
  ads: () => ipcRenderer.invoke("ads"),
  setAds: (on: string, market: string, paise: number) => ipcRenderer.invoke("setAds", on, market, paise),
  sent: () => ipcRenderer.invoke("sent"),
  readReport: (file: string, status: "rto" | "returned") =>
    ipcRenderer.invoke("readReport", file, status),
  returned: (subOrder: string, status: "rto" | "returned" | null, on: string) =>
    ipcRenderer.invoke("returned", subOrder, status, on),
  dropParcel: (subOrder: string) => ipcRenderer.invoke("dropParcel", subOrder),
  packing: (
    action: "pack" | "unpack" | "credit",
    sku: string,
    on: string,
    opts: { by?: string[]; limit?: number; replacing?: string[] },
  ) => ipcRenderer.invoke("packing", action, sku, on, opts),
  skuImage: (sku: string, position: number) => ipcRenderer.invoke("skuImage", sku, position),
  addSkuImage: (sku: string, position: number, file: string) =>
    ipcRenderer.invoke("addSkuImage", sku, position, file),
  workers: () => ipcRenderer.invoke("workers"),
  setWorkers: (names: string[]) => ipcRenderer.invoke("setWorkers", names),

  downloadsDir: () => ipcRenderer.invoke("downloadsDir"),
  scanInbox: (from: string) => ipcRenderer.invoke("scanInbox", from),
  importInbox: (from: string, opts: { move?: boolean; only?: string[] }) =>
    ipcRenderer.invoke("importInbox", from, opts),
  fileOne: (files: string[]) => ipcRenderer.invoke("fileOne", files),

  finish: (o: { inDir: string; outDir: string; id?: string | null; metaId?: string | null }) =>
    ipcRenderer.invoke("finish", o),

  check: (target: string) => ipcRenderer.invoke("check", target),
  cleanFolder: (folder: string) => ipcRenderer.invoke("cleanFolder", folder),

  openChrome: (url?: string) => ipcRenderer.invoke("openChrome", url),
  shortcuts: () => ipcRenderer.invoke("shortcuts"),
  rememberPage: (name: string) => ipcRenderer.invoke("rememberPage", name),
  forgetPage: (name: string) => ipcRenderer.invoke("forgetPage", name),
  chromeStatus: () => ipcRenderer.invoke("chromeStatus"),
  closeChrome: () => ipcRenderer.invoke("closeChrome"),
  fillListing: (id: string, tab?: DefaultsTab) => ipcRenderer.invoke("fillListing", id, tab),
  saveListing: () => ipcRenderer.invoke("saveListing"),
  scanTab: (id: string) => ipcRenderer.invoke("scanTab", id),
  onField: (cb: (row: FieldRow) => void) => {
    const handler = (_e: unknown, row: FieldRow) => cb(row);
    ipcRenderer.on("field", handler);
    return () => void ipcRenderer.off("field", handler);
  },
};

contextBridge.exposeInMainWorld("ww", api);

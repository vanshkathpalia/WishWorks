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
  editMaterial: (key: string, patch: { paise?: number | null; size?: string; material?: string }) =>
    ipcRenderer.invoke("editMaterial", key, patch),
  addMaterial: (row: { category: string; material: string; paise: number | null }) =>
    ipcRenderer.invoke("addMaterial", row),
  parcelFor: (lines: KitLine[], chosen: Record<string, number | undefined>) =>
    ipcRenderer.invoke("parcelFor", lines, chosen),
  saveKit: (kit: SavedKit) => ipcRenderer.invoke("saveKit", kit),
  exportKits: (only: string | null) => ipcRenderer.invoke("exportKits", only),
  openKitsFolder: () => ipcRenderer.invoke("openKitsFolder"),
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
  packing: (action: "pack" | "unpack" | "credit", sku: string, on: string, by: string[]) =>
    ipcRenderer.invoke("packing", action, sku, on, by),
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

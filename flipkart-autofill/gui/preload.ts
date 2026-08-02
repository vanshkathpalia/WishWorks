/**
 * preload.ts — the only bridge between the renderer and the engine.
 *
 * Thin on purpose: every function here is one `invoke` and nothing else. Any logic that creeps
 * in would live in a process with node access and no tests, which is the worst of both. If a
 * handler needs to do something, it does it in main.ts.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { CleanUp, FieldRow, PhotoItem, Row, StepId, WwApi } from "./shared.js";

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
  chooseWorkspace: () => ipcRenderer.invoke("chooseWorkspace"),

  listings: () => ipcRenderer.invoke("listings"),
  promptText: (file: string) => ipcRenderer.invoke("promptText", file),
  readPrompt: (file: string) => ipcRenderer.invoke("readPrompt", file),
  savePrompt: (file: string, text: string) => ipcRenderer.invoke("savePrompt", file, text),
  readVersion: (file: string) => ipcRenderer.invoke("readVersion", file),

  scanPhotos: (from: string, root: string) => ipcRenderer.invoke("scanPhotos", from, root),
  importPhoto: (item: PhotoItem, position: number, opts: { move?: boolean }) =>
    ipcRenderer.invoke("importPhoto", item, position, opts),
  listingFolders: (root: string) => ipcRenderer.invoke("listingFolders", root),
  paste: (id: string) => ipcRenderer.invoke("paste", id),
  stripEmoji: (id: string) => ipcRenderer.invoke("stripEmoji", id),

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
  fillListing: (id: string) => ipcRenderer.invoke("fillListing", id),
  saveListing: () => ipcRenderer.invoke("saveListing"),
  onField: (cb: (row: FieldRow) => void) => {
    const handler = (_e: unknown, row: FieldRow) => cb(row);
    ipcRenderer.on("field", handler);
    return () => void ipcRenderer.off("field", handler);
  },
};

contextBridge.exposeInMainWorld("ww", api);

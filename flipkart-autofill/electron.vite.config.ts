/**
 * electron.vite.config.ts — builds the three halves of the app: main, preload, renderer.
 *
 * `externalizeDepsPlugin` keeps everything in `dependencies` out of the bundle. That is not an
 * optimisation: `sharp` and `playwright` are native/binary packages that cannot be bundled, and
 * they have to be left as real `node_modules` for electron-builder to ship.
 *
 * The engine in `src/` is NOT external — it is our own TypeScript and gets compiled into the
 * main bundle, which is how `runImages()` runs in the same process as the window.
 */

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(__dirname, "gui/main.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(__dirname, "gui/preload.ts") } },
  },
  renderer: {
    root: resolve(__dirname, "gui/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, "gui/renderer/index.html") },
    },
  },
});

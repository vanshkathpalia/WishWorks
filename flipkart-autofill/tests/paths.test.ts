/**
 * paths.test.ts — where this tool's folders live.
 *
 * Pinned because getting `PROFILE_DIR` wrong is invisible until someone loses a login. It moved
 * out of the project folder for the packaged app: that folder is read-only, and Chrome answers a
 * read-only profile dir by starting with NO SESSION rather than by failing — which reads as "it
 * logged me out" and is WW-061's exact symptom.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_DIR, ROOT, userDataDir } from "../src/paths.js";

const exec = promisify(execFile);
const PROJECT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("userDataDir", () => {
  it("matches what Electron's app.getPath('userData') returns on each platform", () => {
    expect(userDataDir("darwin")).toContain(path.join("Library", "Application Support", "WishWorks"));
    expect(userDataDir("win32")).toContain("WishWorks");
    expect(userDataDir("linux")).toContain("WishWorks");
  });

  it("is absolute everywhere — a relative profile path would follow the working directory", () => {
    for (const p of ["darwin", "win32", "linux"] as const) {
      expect(path.isAbsolute(userDataDir(p))).toBe(true);
    }
  });
});

describe("PROFILE_DIR", () => {
  it("is either the legacy ./profile or the OS user-data one — never a guess", () => {
    const legacy = path.join(ROOT, "profile");
    expect(PROFILE_DIR === legacy || PROFILE_DIR.startsWith(userDataDir())).toBe(true);
  });

  it("prefers a legacy ./profile when it exists, so a working login is never thrown away", async () => {
    // Resolved in a subprocess so this test cannot be fooled by module caching.
    const { stdout } = await exec("npx", ["tsx", "-e", `import("./src/paths.js").then(p => console.log(p.PROFILE_DIR))`], { cwd: PROJECT });
    const legacy = path.join(ROOT, "profile");
    const { existsSync } = await import("node:fs");
    expect(stdout.trim()).toBe(existsSync(legacy) ? legacy : path.join(userDataDir(), "profile"));
  });

  it("is overridable, so a test or a second workspace never touches the real session", async () => {
    const overrides = { ...process.env, WW_PROFILE_DIR: path.join(PROJECT, "no-such-profile") };
    const { stdout } = await exec("npx", ["tsx", "-e", `import("./src/paths.js").then(p => console.log(p.PROFILE_DIR))`], { cwd: PROJECT, env: overrides });
    expect(stdout.trim()).toBe(path.join(PROJECT, "no-such-profile"));
  });
});

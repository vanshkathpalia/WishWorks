/**
 * prompts.test.ts — where a prompt edit is allowed to go, which is a distribution rule and not a
 * convenience.
 *
 * The trap being fixed: a prompt edited inside a PACKAGED app used to land in `userData/prompts/`
 * and win over the shipped copy for ever after. Every later release was then silently ignored on
 * that machine, for that one file, with nothing on screen to say so — and the person it happens to
 * is the partner, who cannot read a diff to work out why the copy got worse.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPrompt, savePrompt, type PromptDirs } from "../src/prompts.js";

function dirs(canEditShipped: boolean): PromptDirs {
  const root = mkdtempSync(path.join(tmpdir(), "ww-prompt-"));
  const shipped = path.join(root, "guides");
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "P.md"), "the shipped one");
  return { shipped, userData: path.join(root, "data"), canEditShipped };
}

describe("in development, the repo file is the source of truth", () => {
  it("writes the edit back where git can see it, so a release carries it", async () => {
    const d = dirs(true);
    await savePrompt(d, "P.md", "changed");
    const p = await readPrompt(d, "P.md");
    expect(p.text).toBe("changed");
    expect(p.readOnly).toBe(false);
    expect(p.savesTo).toBe(path.join(d.shipped, "P.md"));
  });

  it("keeps what it used to say", async () => {
    const d = dirs(true);
    await savePrompt(d, "P.md", "changed");
    const p = await readPrompt(d, "P.md");
    expect(p.versions).toHaveLength(1);
  });
});

describe("in a packaged app, prompts are read-only", () => {
  it("refuses a save rather than writing it somewhere that looks like it worked", async () => {
    const d = dirs(false);
    await expect(savePrompt(d, "P.md", "changed")).rejects.toThrow(/read-only/i);
    expect((await readPrompt(d, "P.md")).text).toBe("the shipped one");
  });

  it("says so, and offers nowhere to save to", async () => {
    const p = await readPrompt(dirs(false), "P.md");
    expect(p.readOnly).toBe(true);
    expect(p.savesTo).toBeNull();
  });

  it("ignores an override left by an older build, and names it instead of obeying it", async () => {
    // Obeying it would keep the bug alive on exactly the machines that already have one. Saying
    // nothing would be its own silent surprise, so the file is named on screen.
    const d = dirs(false);
    mkdirSync(path.join(d.userData, "prompts"), { recursive: true });
    writeFileSync(path.join(d.userData, "prompts", "P.md"), "someone's old local edit");
    const p = await readPrompt(d, "P.md");
    expect(p.text).toBe("the shipped one");
    expect(p.ignoredOverride).toContain("prompts");
  });
});

/**
 * The read/write split that actually bit us (2026-08-11).
 *
 * In DEVELOPMENT editing is allowed, and the old `activeFile` preferred an override there — while
 * `savePrompt` has always written to the shipped file. Read one, write the other. An edit made in
 * the app sat in `userData` looking right on screen for four days while the repo copy stayed old,
 * git saw nothing to commit, and the packaged app would have shipped the partner the stale one.
 */
describe("development reads the same file it writes", () => {
  it("ignores a leftover override even where editing is allowed", async () => {
    const d = dirs(true);
    mkdirSync(path.join(d.userData, "prompts"), { recursive: true });
    writeFileSync(path.join(d.userData, "prompts", "P.md"), "the local copy nobody can see");
    const p = await readPrompt(d, "P.md");
    expect(p.text).toBe("the shipped one");
    // Named, not silently dropped — and named HERE, which is the mode it was being obeyed in.
    expect(p.ignoredOverride).toContain("prompts");
  });

  it("saves where it reads, so an edit is visible to git and to the next release", async () => {
    const d = dirs(true);
    mkdirSync(path.join(d.userData, "prompts"), { recursive: true });
    writeFileSync(path.join(d.userData, "prompts", "P.md"), "the local copy nobody can see");
    await savePrompt(d, "P.md", "edited in the app");
    expect(readFileSync(path.join(d.shipped, "P.md"), "utf8")).toBe("edited in the app");
    expect((await readPrompt(d, "P.md")).text).toBe("edited in the app");
  });
});

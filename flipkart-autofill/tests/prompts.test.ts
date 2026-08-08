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
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

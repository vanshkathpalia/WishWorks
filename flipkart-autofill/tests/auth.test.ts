/**
 * auth.test.ts — a login is a security path, so the two ways it can be quietly wrong are pinned:
 * a wrong password that gets in, and a right one that does not.
 *
 * Run:  npm test
 */

import { describe, it, expect } from "vitest";
import { hashPassword, userFolder, verifyPassword } from "../src/auth.js";

describe("the login", () => {
  it("lets the right password in and keeps every other one out", () => {
    const stored = hashPassword("balloon123");
    expect(verifyPassword("balloon123", stored)).toBe(true);
    expect(verifyPassword("balloon124", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
    expect(verifyPassword("BALLOON123", stored)).toBe(false);
  });

  it("never stores the password, and never the same hash twice", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a.hash).not.toBe(b.hash); // different salt, so one leaked hash is not a master key
    expect(JSON.stringify(a)).not.toContain("same");
    // Each still verifies against its own salt.
    expect(verifyPassword("same", a) && verifyPassword("same", b)).toBe(true);
  });

  it("answers no rather than throwing on a settings file somebody edited", () => {
    expect(verifyPassword("x", { salt: "ab", hash: "not-hex-at-all" })).toBe(false);
    expect(verifyPassword("x", { salt: "", hash: "" })).toBe(false);
  });

  it("turns a name into a folder, and never into nothing", () => {
    expect(userFolder("Vansh Kumar")).toBe("vansh-kumar");
    expect(userFolder("  ANP_partner!! ")).toBe("anp-partner");
    expect(userFolder("!!!")).toBe("user");
  });
});

/**
 * auth.ts — the username and password on the launch screen.
 *
 * **What this is honestly for.** It is the door on the app, not on the disk: the files sit in a
 * normal folder and Explorer opens them whatever this screen says, so a determined person is not
 * stopped by it. What it does buy is the thing the business actually needed — two people who share
 * a computer stop landing in each other's listings, costings and pay records by accident, and the
 * app knows whose day it is recording without anyone having to remember to check.
 *
 * The password is never stored. `scrypt` turns it into a hash with a random salt, and checking one
 * hashes the attempt the same way and compares in constant time. That is the whole file.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** What gets written next to the account. Neither field is a secret on its own. */
export interface Password {
  salt: string;
  hash: string;
}

/**
 * scrypt's cost, left at Node's defaults except N, which is raised to 2^15.
 *
 * It costs about a tenth of a second on the machines this runs on — unnoticeable once per launch,
 * and the reason a stolen `settings.json` is not a list of passwords by teatime.
 */
const COST = { N: 32768, keylen: 32, maxmem: 64 * 1024 * 1024 };

// `maxmem` has to be raised with N: scrypt needs 128 × N × r bytes, which at N=2^15 is exactly
// Node's 32 MB default and fails with "memory limit exceeded" rather than quietly using less.

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Password {
  return { salt, hash: scryptSync(password, salt, COST.keylen, COST).toString("hex") };
}

/**
 * True when this password made that hash.
 *
 * `timingSafeEqual` rather than `===` because a comparison that returns early leaks, one byte at a
 * time, how much of a guess was right. It throws on a length mismatch, which a corrupted or
 * hand-edited settings file can produce, so that is caught and answered as *no*.
 */
export function verifyPassword(password: string, stored: Password): boolean {
  try {
    const want = Buffer.from(stored.hash, "hex");
    // **A stored hash that is not a hash is a NO, never a yes.** `Buffer.from(…, "hex")` stops at
    // the first character that is not hex and hands back what it got — so a settings file with a
    // blank or hand-typed hash yields an empty buffer, which `timingSafeEqual` then finds equal to
    // another empty buffer, and every password in the world gets in. Found by the test below.
    if (want.length !== COST.keylen || stored.salt === "") return false;
    return timingSafeEqual(want, scryptSync(password, stored.salt, want.length, COST));
  } catch {
    return false;
  }
}

/**
 * A username reduced to a folder name — `Vansh Kumar` → `vansh-kumar`.
 *
 * The workspace is derived rather than chosen because being asked to pick a folder is the first
 * thing a new person sees and the one they cannot answer. It is a normal folder they can move
 * later in Settings; what matters on day one is that two logins never share one.
 */
export function userFolder(user: string): string {
  return user.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
}

// connect.ts — opens YOUR real Google Chrome (not Playwright's bundled Chromium) with a
// persistent profile, so the Flipkart login is entered ONCE and reused by every later run.
//
// The profile lives in the OS user-data directory (see paths.ts), NOT inside the project: a
// packaged app's own folder is read-only, and Chrome responds to that by starting with no
// session rather than by failing — which reads as "it logged me out" and is WW-061's exact
// symptom. An existing ./profile still wins, so this machine keeps the login it already has.
//
// Why not attach to an already-open Chrome? Two hard blockers, both verified on this
// machine: since Chrome 136 Google refuses --remote-debugging-port on the default
// profile, and Chrome 150's CDP no longer supports the browser-context calls Playwright's
// connectOverCDP makes ("Browser context management is not supported"). So we drive our
// own persistent Chrome instead — same effect, no re-login.
//
// THE CRITICAL BIT: Chrome only writes session cookies to disk on a graceful shutdown.
// Killing the process (Ctrl+C) loses the login — that is exactly what wiped it before.
// installCleanExit() traps Ctrl+C and closes Chrome properly so the session always sticks.
import { chromium, type BrowserContext, type Page } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// One answer to "where do this tool's folders live", shared with every other module. connect.ts
// used to compute its own ROOT from import.meta.url — a second path convention in one codebase,
// which is exactly what C-032 was about.
export { PROFILE_DIR } from "./paths.js";
import { PROFILE_DIR } from "./paths.js";

export interface Session {
  context: BrowserContext;
  /** close Chrome gracefully so cookies/login are flushed to disk */
  close: () => Promise<void>;
}

/** Block for `ms` without spawning a shell. `execSync("sleep")` does not exist on Windows. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Make sure no other Chrome is holding ./profile before we launch.
 *
 * Chrome allows exactly one process per profile directory. If a previous run's Chrome
 * is still alive (terminal closed, crash, window left open), the next launch cannot use
 * the profile and silently comes up with NO SESSION — which looks exactly like "it asked
 * me to log in again" even though the cookies are saved and valid.
 *
 * Safe to kill: ./profile is this tool's own dedicated profile, never your personal Chrome.
 *
 * ⚠️ MACOS/LINUX ONLY. `ps` does not exist on Windows, so there the lookup throws, is
 * caught, and this silently does nothing — leaving exactly the stale-profile symptom
 * described above with no clue as to why. Needs a `tasklist`/WMI branch before the
 * Windows app ships (WW-061); the stale-lock cleanup below is already cross-platform.
 */
function ensureProfileFree(): void {
  let pids: string[] = [];
  try {
    pids = execSync("ps -A -o pid=,command=", { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.includes(PROFILE_DIR) && l.includes("Google Chrome"))
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((pid) => pid && pid !== String(process.pid));
  } catch {
    /* ps unavailable — fall through */
  }

  if (pids.length) {
    console.log(`↻ Closing ${pids.length} leftover Chrome process(es) still holding ./profile...`);
    for (const pid of pids) {
      try { process.kill(Number(pid), "SIGTERM"); } catch { /* already gone */ }
    }
    // give Chrome a moment to exit and release the lock
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      try {
        const still = execSync("ps -A -o pid=,command=", { encoding: "utf8" })
          .split("\n")
          .filter((l) => l.includes(PROFILE_DIR) && l.includes("Google Chrome"));
        if (!still.length) break;
      } catch { break; }
      sleepSync(300);
    }
    for (const pid of pids) {
      try { process.kill(Number(pid), "SIGKILL"); } catch { /* gone, good */ }
    }
  }

  // stale lock symlinks survive an unclean exit and block the next launch
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.rmSync(path.join(PROFILE_DIR, f), { force: true }); } catch { /* fine */ }
  }
}

export async function openBrowser(): Promise<Session> {
  ensureProfileFree();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", // your real Chrome — better session handling than bundled Chromium
    headless: false,
    viewport: null,
    args: ["--start-maximized", "--no-first-run", "--no-default-browser-check"],
    // Do NOT let Playwright kill Chrome on Ctrl+C. Its default handler tears the browser
    // down before cookies are flushed, which is precisely how the saved login disappeared.
    // We install our own handlers below that close it gracefully instead. (Verified: with
    // these left at their defaults the session is lost; with them off it survives.)
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await context.close(); // graceful → cookies flushed → login survives
    } catch {
      /* already gone */
    }
  };

  // Ctrl+C must NOT kill Chrome mid-write, or the login is lost.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      process.stdout.write("\nClosing Chrome cleanly so your login is saved...\n");
      await close();
      process.exit(0);
    });
  }

  return { context, close };
}

/**
 * Return the tab worth acting on.
 *
 * Flipkart opens "Add New Listing" in a NEW tab, so using pages()[0] silently targets
 * the wrong page — that is how a scan captures the dashboard's search box instead of the
 * listing form. Cross-tab focus is reported unreliably, but "the tab with dozens of
 * inputs is the listing form" holds either way.
 */
export async function activePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter((p) => !p.isClosed());
  if (pages.length === 0) return context.newPage();
  if (pages.length === 1) return pages[0];

  const FORM_MIN = 5;
  let focused: Page | null = null;
  let best: Page = pages[pages.length - 1];
  let bestCount = -1;

  for (const p of pages) {
    try {
      const { inputs, hasFocus } = await p.evaluate(() => ({
        inputs: document.querySelectorAll("input:not([type=hidden]),textarea,select").length,
        hasFocus: document.hasFocus(),
      }));
      if (hasFocus && inputs >= FORM_MIN && !focused) focused = p;
      if (inputs > bestCount) {
        bestCount = inputs;
        best = p;
      }
    } catch {
      /* navigating or closed — skip */
    }
  }
  return focused ?? best;
}

/** Pause until the user presses Enter in the terminal. */
export function pressEnter(msg: string): Promise<void> {
  process.stdout.write(`\n${msg}\n➡️  Press ENTER here when ready... `);
  return new Promise((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}

/** Ask a question and return the typed answer (used by the menu in start.ts). */
export function ask(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    process.stdin.once("data", (d) => resolve(String(d)));
  });
}

/** The seller app itself. The bare domain serves the public marketing site instead. */
export const APP_URL = "https://seller.flipkart.com/index.html#dashboard";

/**
 * Is this page an authenticated seller session?
 *
 * Checked by REDIRECT, not by cookies. A stale `connect.sid` can sit in the profile long
 * after the server has invalidated it — cookie-presence reported "logged in" while every
 * page showed the login screen, which wasted a lot of time. Flipkart bounces an
 * unauthenticated request to `/?referral_url=...`, so that redirect is the honest signal.
 *
 * Pure inspection: never navigates, so it is safe to poll while the user is logging in.
 */
export function looksLoggedIn(page: Page): boolean {
  const url = page.url();
  if (url.includes("referral_url")) return false; // bounced by the auth gate
  return /seller\.flipkart\.com\/index\.html#/.test(url);
}

/** Navigate to the app and report whether we land authenticated. */
export async function checkLogin(page: Page): Promise<boolean> {
  try {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3500); // the SPA resolves auth after load
  } catch {
    return false;
  }
  return looksLoggedIn(page);
}

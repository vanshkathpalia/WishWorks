/**
 * browser-core.ts — the Flipkart browser session, as something a UI can hold open (WW-066b).
 *
 * The CLI's shape was one straight line: open Chrome → wait for a human → fill → report → save,
 * then exit. A window cannot work that way: each of those is a separate button press minutes
 * apart, so the session has to outlive the call that created it. That is the only real
 * difference, and it is why this file keeps ONE module-level session rather than returning it.
 *
 * Chrome is deliberately never closed from here. `npm start` ends with a warning in capitals
 * because closing the window before Save throws away every filled field — Vansh did exactly that
 * once, reading "this will finish by itself" as "closing it is how you finish". The app inherits
 * that rule: only `closeSession()` closes it, and nothing calls that automatically.
 *
 * Playwright drives the user's own installed Google Chrome (`channel: "chrome"`), so nothing here
 * needs Node or npm on the machine — Electron is the runtime and Chrome is already there.
 */

import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { openBrowser, activePage, looksLoggedIn, APP_URL, type Session } from "./connect.js";
import { clickSave, probeField } from "./fields.js";
import { findById } from "./id.js";
import { PRODUCTS_DIR } from "./paths.js";
import {
  checkValues, describeProblems, fillAll, loadProduct, needsEyes,
  type FieldRow, type Report, type Values,
} from "./listing.js";

/** The one live session. Null until `openSession()`, and only `closeSession()` clears it. */
let session: Session | null = null;

export interface SessionStatus {
  /** Chrome is open and under our control. */
  open: boolean;
  /**
   * Three states, not two. **"Not navigated yet" must never be reported as "logged out"** — that
   * confusion is WW-061, where Chrome came up with no session in a way indistinguishable from
   * having been signed out, and the wrong diagnosis cost a day.
   */
  login: "yes" | "no" | "unknown";
  /** Where the active tab is, so the screen can say what it is looking at. */
  url: string;
}

async function statusOf(context: BrowserContext): Promise<SessionStatus> {
  const page = await activePage(context);
  const url = page.url();
  // about:blank / a brand-new tab means we simply have not been anywhere yet.
  const login = !url || url === "about:blank" ? "unknown" : looksLoggedIn(page) ? "yes" : "no";
  return { open: true, login, url };
}

/**
 * Open Chrome (or reuse the one already open) and go somewhere.
 *
 * Defaults to the dashboard, never a login page — the saved session normally lands you straight
 * in, and being shown a login screen you did not need is what makes people think they have been
 * signed out. `url` is for saved shortcuts: any page the user chose to remember.
 */
export async function openSession(url = APP_URL): Promise<SessionStatus> {
  if (!session) session = await openBrowser();
  const page = await activePage(session.context);
  // A real navigation is what turns "unknown" into an answer; failures are ignored because an
  // offline machine should show "can't tell", not throw.
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  // The SPA resolves auth a moment after load, so read the answer rather than the first paint.
  await page.waitForTimeout(3000).catch(() => {});
  return statusOf(session.context);
}

/** Poll-friendly: never navigates, so it cannot interrupt an OTP being typed. */
export async function sessionStatus(): Promise<SessionStatus> {
  if (!session) return { open: false, login: "unknown", url: "" };
  try {
    return await statusOf(session.context);
  } catch {
    // The window was closed from the title bar — that is allowed, it just ends the session.
    session = null;
    return { open: false, login: "unknown", url: "" };
  }
}

/** Close Chrome gracefully so the login is written to disk. Never called automatically. */
export async function closeSession(): Promise<void> {
  const s = session;
  session = null;
  await s?.close().catch(() => {});
}

export interface FillResult {
  product: string;
  category: string;
  usedDefaults: string[];
  rows: FieldRow[];
  report: Report;
  /** How many fields disagree with what was typed. **Save is forbidden while this is > 0.** */
  needsEyes: number;
  /** For each mismatch, what the widget actually turned out to be — the debugging shortcut. */
  probes: { label: string; tag: string; kind: string; rowLabel: string; wrongRow: boolean; value: string; pills: string[] }[];
}

/** Thrown before anything is typed, so a bad file never reaches the form. */
export class FillBlocked extends Error {}

/**
 * Fill the form that is currently open in Chrome, from `products/<id>.json`.
 *
 * The value check runs BEFORE the browser is touched, exactly as the CLI does it: a file with a
 * problem should cost you nothing, and half a listing typed into a live draft is worse than none.
 */
export async function fillListing(
  id: string,
  onField?: (row: FieldRow) => void,
): Promise<FillResult> {
  if (!session) throw new FillBlocked("Chrome is not open — open it first.");

  const match = await findById(PRODUCTS_DIR, id);
  if (!match) throw new FillBlocked(`No file in products/ matches "${id}".`);

  const { values, usedDefaults, category } = loadProduct(match.file);
  const problems = checkValues(values as Values);
  if (problems.length) throw new FillBlocked(describeProblems(problems));

  const page = await activePage(session.context);
  const rows: FieldRow[] = [];
  const report = await fillAll(page, values as Values, (row) => {
    rows.push(row);
    onField?.(row);
  });

  return {
    product: path.basename(match.file, ".json"),
    category,
    usedDefaults,
    rows,
    report,
    needsEyes: needsEyes(report),
    probes: await explainMismatches(page, report),
  };
}

/** What each mismatched field's widget actually is, as data rather than printed lines. */
async function explainMismatches(page: Page, r: Report): Promise<FillResult["probes"]> {
  const out: FillResult["probes"] = [];
  for (const label of r.mismatch) {
    const p = await probeField(page, label).catch(() => null);
    if (!p) continue;
    out.push({
      label,
      tag: p.tag,
      kind: p.kind ?? p.type ?? "unknown",
      rowLabel: p.rowLabel,
      // The single most useful thing this ever tells you: we typed into a different field's row.
      wrongRow: p.rowLabel.trim().toLowerCase() !== label.trim().toLowerCase(),
      value: p.value,
      pills: p.pills,
    });
  }
  return out;
}

/**
 * Click Save.
 *
 * **Refuses while any field reads ⚠️.** That guard is the safety model, it predates the
 * auto-save, and it is not negotiable — so it lives here in the engine where no screen can
 * forget it, rather than as a disabled button somebody could work around.
 */
export async function saveListing(
  lastFill: Pick<FillResult, "needsEyes"> | null,
): Promise<{ clicked: string | null; candidates: string[] }> {
  if (!session) throw new FillBlocked("Chrome is not open.");
  if (!lastFill) throw new FillBlocked("Nothing has been filled yet.");
  if (lastFill.needsEyes > 0) {
    throw new FillBlocked(
      `${lastFill.needsEyes} field(s) do not read back the way they were typed. ` +
        `Nothing saves while that is true — look at them in Chrome first.`,
    );
  }
  return clickSave(await activePage(session.context));
}

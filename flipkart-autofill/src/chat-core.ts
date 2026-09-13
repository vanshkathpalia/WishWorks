/**
 * chat-core.ts — driving ChatGPT: sending a prompt, and getting a generated image back.
 *
 * Everything here was measured against the live site on 2026-09-13, because every reasonable guess
 * about it turned out to be wrong:
 *
 *  - **A generated image is NOT inside the assistant's message.** `[data-message-author-role]`
 *    listed only the *user* turn while a finished 1254×1254 image sat on the page; waiting for an
 *    assistant turn to contain an `img` waits for ever.
 *  - **There is no download button.** The image is served from
 *    `chatgpt.com/backend-api/estuary/content?id=file_…&sig=…`, same-origin and authenticated by
 *    the session cookie, so it is fetched from inside the page rather than clicked.
 *  - **The prompt is pasted, never typed.** `pressSequentially` sends a real Enter for every `\n`,
 *    into a composer where Enter SENDS — and it silently eats the paragraph breaks. See
 *    `docs/learning/21`.
 *  - **The composer is not empty when a chat opens.** ChatGPT keeps an unsent draft, so typing into
 *    it appends: a 4,890-character prompt came back as 9,648, the whole thing twice.
 */

import type { Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Images ChatGPT serves from its own backend — generated ones and uploads both live here. */
const CONTENT = /chatgpt\.com\/backend-api\/[^"']*content\?/;

/** Big enough to be a product image rather than an avatar or an icon. */
const REAL_IMAGE = 250;

/**
 * Which images on the page are NEW since we looked last, and big enough to matter.
 *
 * **A set difference, not "the last image".** A chat already holds the pictures that were uploaded
 * to it and everything generated earlier in the same conversation, and the newest one is not
 * reliably last in the DOM. Taking what was not there before is the only reading that survives a
 * second and third image in one chat, which is exactly what the four-image flow does.
 */
export function newImages(before: string[], after: string[]): string[] {
  const seen = new Set(before);
  return after.filter((u) => !seen.has(u));
}

/** Every backend-served image currently on the page, deduplicated — ChatGPT renders each 2–3 times. */
export async function imagesOn(page: Page): Promise<string[]> {
  return page.evaluate((min) =>
    [...new Set(
      [...document.querySelectorAll("img")]
        .filter((i) => i.naturalWidth >= min && /chatgpt\.com\/backend-api\/[^"']*content\?/.test(i.currentSrc || i.src))
        .map((i) => i.currentSrc || i.src),
    )], REAL_IMAGE);
}

/**
 * Put `text` in the composer and send it.
 *
 * Clears first, pastes rather than types, and only then presses Enter — see the file note for why
 * each of those three is load-bearing rather than tidy.
 */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  const composer = page.locator("#prompt-textarea").first();
  await composer.click({ timeout: 30_000 });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://chatgpt.com" });
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press("ControlOrMeta+V");
  // The paste is asynchronous; sending before it lands sends half a prompt.
  await page.waitForTimeout(1500);
  await page.keyboard.press("Enter");
}

/**
 * Wait until ChatGPT has stopped working.
 *
 * The stop button is the honest signal: it exists exactly while a reply is being produced. Polled
 * rather than waited on, because it appears a moment AFTER Enter — checking once immediately would
 * see no stop button and call a job finished before it began, which is why `settle` exists.
 */
export async function waitUntilIdle(page: Page, opts: { timeoutMs: number; settleMs?: number }): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  await page.waitForTimeout(opts.settleMs ?? 4000);
  while (Date.now() < deadline) {
    const busy = await page
      .locator('[data-testid="stop-button"], button[aria-label*="Stop"]')
      .count()
      .catch(() => 0);
    if (!busy) return true;
    await page.waitForTimeout(3000);
  }
  return false;
}

/** Save an image the page can see, fetched from inside the page so the session cookie comes along. */
export async function saveFrom(page: Page, url: string, to: string): Promise<string> {
  const bytes = await page.evaluate(
    async (u) => [...new Uint8Array(await (await fetch(u)).arrayBuffer())],
    url,
  );
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, Buffer.from(bytes));
  return to;
}

export interface Generated {
  /** Where it was saved, or null when nothing new appeared. */
  file: string | null;
  /** How long it took, for the next one's patience budget. */
  seconds: number;
  /** True when the wait ran out with ChatGPT still working. */
  timedOut: boolean;
}

/**
 * Send an image prompt into an open chat and save what comes back.
 *
 * The chat is reused on purpose: the hero, the infographic and the sizes sheet are the SAME product
 * and each prompt refers to what came before — that is how Vansh works by hand, and a fresh chat
 * per image would throw away the context every prompt depends on.
 *
 * **Never fails loudly for taking too long.** An image can take two minutes; a timeout returns what
 * it has with `timedOut` set, and the tab stays open so a human can look. A run of four images must
 * not be lost because the third one was slow.
 */
export async function generateImage(
  page: Page,
  prompt: string,
  to: string,
  opts: { timeoutMs?: number } = {},
): Promise<Generated> {
  const before = await imagesOn(page);
  const started = Date.now();
  await sendPrompt(page, prompt);
  const finished = await waitUntilIdle(page, { timeoutMs: opts.timeoutMs ?? 240_000 });
  // One more look after it goes idle: the <img> is attached a beat after the stream ends.
  await page.waitForTimeout(3000);

  const fresh = newImages(before, await imagesOn(page));
  const seconds = Math.round((Date.now() - started) / 1000);
  if (fresh.length === 0) return { file: null, seconds, timedOut: !finished };
  // The last new one, when a prompt yields several: ChatGPT appends, so later is newer.
  return { file: await saveFrom(page, fresh[fresh.length - 1], to), seconds, timedOut: !finished };
}

// ---------------------------------------------------------------- the whole set, in one chat

/** One prompt in the run, and whether a picture is expected back from it. */
export interface Step {
  /** The prompt file, e.g. `PROMPT-main-image.md`. */
  prompt: string;
  /**
   * Which numbered image this produces, or null when the step makes no picture.
   *
   * `PROMPT-read-pack.md` is the null one and it is not optional: it says *"in TEXT ONLY (do NOT
   * make an image)"* and its answer — the item list with counts and colours — is what the three
   * image prompts after it are written against. Skipping it does not save a step, it produces
   * three pictures of a kit nobody described.
   */
  image: number | null;
}

/**
 * The standard run: read the pack, then the hero, the contents sheet, the same with sizes.
 *
 * The order is `docs/guides/`'s and `CLAUDE.md`'s, not a new one — and the numbering matches what
 * the rest of the tool already means by 1, 2 and 3.
 */
export const STANDARD_RUN: Step[] = [
  { prompt: "PROMPT-read-pack.md", image: null },
  { prompt: "PROMPT-main-image.md", image: 1 },
  { prompt: "PROMPT-infographic.md", image: 2 },
  { prompt: "PROMPT-infographic-sizes.md", image: 3 },
];

export interface RunResult {
  prompt: string;
  /** Where the image landed, null for a text step or when none arrived. */
  file: string | null;
  seconds: number;
  timedOut: boolean;
  /** Set when a step that should have produced a picture did not. */
  missing: boolean;
}

/**
 * Run a set of prompts in ONE chat, saving each image as it arrives.
 *
 * **One chat, on purpose.** Each prompt refers to what came before — the hero is "the DISPLAYED
 * items" from the pack the first step read, and the sizes sheet is the same items again. A fresh
 * chat per prompt throws away the thing the next prompt is about. It is also why the images have
 * to be told apart by *what is new*: by the third prompt the page holds the upload and two earlier
 * pictures.
 *
 * **A failed step does not end the run.** Four prompts is several minutes of somebody else's
 * compute; if the infographic times out, the sizes sheet is still worth having and the one that
 * failed is reported rather than thrown. The tab is left open either way, because the fix is
 * usually to look at what ChatGPT actually said.
 */
export async function runImageChat(
  page: Page,
  opts: {
    /** The contents-sheet photo the first prompt reads. Uploaded once, at the start. */
    contentsPhoto?: string;
    steps: Step[];
    /** Reads a prompt file by name — the app and the CLI find them differently. */
    readPrompt: (name: string) => Promise<string>;
    /** Where image `n` should be written. */
    fileFor: (n: number) => string;
    onStep?: (r: RunResult) => void;
    timeoutMs?: number;
  },
): Promise<RunResult[]> {
  const out: RunResult[] = [];

  if (opts.contentsPhoto) {
    // The hidden input, never the paperclip: that opens an OS dialog, which is outside the page.
    await page.locator("input[type=file]").first().setInputFiles(opts.contentsPhoto, { timeout: 30_000 });
    await page.waitForTimeout(3000);
  }

  for (const step of opts.steps) {
    const text = await opts.readPrompt(step.prompt);
    const started = Date.now();

    if (step.image === null) {
      await sendPrompt(page, text);
      const ok = await waitUntilIdle(page, { timeoutMs: opts.timeoutMs ?? 240_000 });
      const r = {
        prompt: step.prompt,
        file: null,
        seconds: Math.round((Date.now() - started) / 1000),
        timedOut: !ok,
        missing: false,
      };
      out.push(r);
      opts.onStep?.(r);
      continue;
    }

    const got = await generateImage(page, text, opts.fileFor(step.image), { timeoutMs: opts.timeoutMs });
    const r = { prompt: step.prompt, ...got, missing: got.file === null };
    out.push(r);
    opts.onStep?.(r);
  }
  return out;
}

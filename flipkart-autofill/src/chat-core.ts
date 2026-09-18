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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  await putInComposer(page, text);
  // **The only Enter in this file.** Splitting `sendPrompt` left one behind in `putInComposer` as
  // well, so the costing chat — whose whole point is to hand a human a filled composer to READ —
  // sent it instead, and `sendPrompt` pressed Enter twice. It cost an hour to find because both
  // callers still looked like they worked: one had sent, the other had a chat.
  await page.keyboard.press("Enter");
}

/**
 * Put `text` in the composer and leave it there, unsent.
 *
 * Split out from `sendPrompt` because one caller must NOT send: the costing chat hands a human a
 * filled composer to read before they commit to it. Both used to have their own copy of this, which
 * is how the 1.5-second bug survived in one of them after being fixed in the other.
 */
export async function putInComposer(page: Page, text: string): Promise<void> {
  const composer = page.locator("#prompt-textarea").first();
  /**
   * **In front first.** The clipboard write is refused ("Document is not focused") by a tab whose
   * window is behind another, and a latch run loads each product page in the FLIPKART window between
   * one costing chat and the next — so on 2026-09-17 only the first chat of each run (WH001 at 18:07,
   * the first product at 19:16) got its prompt, and every later one was silently abandoned.
   */
  await page.bringToFront().catch(() => {});
  await composer.click({ timeout: 30_000 });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://chatgpt.com" });
  const copied = await page.evaluate((t) => navigator.clipboard.writeText(t).then(() => true, () => false), text);
  if (copied) await page.keyboard.press("ControlOrMeta+V");
  // Still refused: insert the text directly. One input event, not typed keys, so no newline is
  // turned into an Enter (docs/learning/21) — the reason paste was chosen over typing at all.
  else await page.keyboard.insertText(text);

  /**
   * **Wait for the text to actually be there, rather than guessing how long a paste takes.**
   *
   * A fixed 1.5s was fine for a 5 KB costing prompt and silently wrong for an 11 KB one: the
   * supplier-words prompt carries the whole price list, the paste had not landed, and Enter fired
   * on an EMPTY composer — so no message was sent and no chat was even created. It looked like the
   * model had answered with nothing.
   *
   * Polled against the length instead. A tenth of the prompt is enough to know the paste is
   * happening; ChatGPT renders the composer's text in chunks and waiting for the whole thing exactly
   * is a race of its own.
   */
  // `text`, not `prompt` — `prompt` is a DOM global, so the wrong name TYPECHECKED and only
  // failed at runtime, after the browser had opened.
  const want = Math.min(text.trim().length, 200);
  let got = 0;
  for (let i = 0; i < 40; i++) {
    got = (await composer.innerText().catch(() => "")).trim().length;
    if (got >= want) break;
    // **A long paste becomes a file card, not text.** PROMPT-meta (27 KB) landed as "You are
    // preparing ON.. — Show in text field" with the composer still empty, measured 2026-09-14; an
    // 11 KB prompt did not. The button puts it back as text, which is what every caller expects.
    const inline = page.getByText("Show in text field").last();
    if (await inline.isVisible().catch(() => false)) await inline.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  /**
   * **Give up LOUDLY.** The first version simply fell out of the loop, so a paste that never landed
   * returned as though it had worked — and the costing chat then reported `ready` over an empty
   * composer. That is the same lie as the 1.5-second bug wearing a different hat: silence read as
   * success. The caller catches this and says `manual`, which is true.
   */
  if (got < want) throw new Error(`the prompt did not reach the composer (${got} of ${want} chars)`);
  // A beat for the tail of a long paste to settle before anything is pressed.
  await page.waitForTimeout(800);
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
  /**
   * This prompt deliberately stops and asks a question. The run pauses; it has not failed.
   *
   * `PROMPT-infographic-sizes.md` is the one: *"Then stop… wait. Do not draw anything until I have
   * confirmed the table. STEP 2 — after I confirm, generate the image."* Only Vansh knows what size
   * foil balloons he actually packs, so the prompt asks before drawing anything.
   *
   * **Without this flag the run calls that a failure** — it did, on the first real run: 27 seconds,
   * no image, reported as NO IMAGE when ChatGPT had done exactly the right thing and was waiting.
   * A tool that reads a question as a fault teaches you to ignore its faults.
   */
  waits?: boolean;
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
  { prompt: "PROMPT-infographic-sizes.md", image: 3, waits: true },
];

export interface RunResult {
  prompt: string;
  /** Where the image landed, null for a text step or when none arrived. */
  file: string | null;
  seconds: number;
  timedOut: boolean;
  /** Set when a step that should have produced a picture did not. */
  missing: boolean;
  /** Set when the prompt stopped to ask something. Not a failure — the chat is waiting for you. */
  awaiting?: boolean;
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
    /** What to call the chat afterwards — `ANP018 — images`. Skipped when absent. */
    title?: string;
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
    // A step that ASKS produces no image on purpose. Calling that missing is how a tool teaches
    // you to ignore it.
    const awaiting = step.waits === true && got.file === null;
    const r = { prompt: step.prompt, ...got, missing: got.file === null && !awaiting, awaiting };
    out.push(r);
    opts.onStep?.(r);
    // Nothing after a question can be answered until it is. Stop, and leave the tab open.
    if (awaiting) break;
  }
  // `title` was accepted and never used, so every image chat stayed "Generate Balloon Image".
  if (opts.title) await renameChat(page, opts.title);
  return out;
}

/**
 * What the assistant last said, as text.
 *
 * `[data-message-author-role=assistant]` DOES work for text — it was only the generated IMAGES that
 * turned out to live outside the turn (see the file note). Read after `waitUntilIdle`, or it
 * returns half a sentence that happens to parse.
 */
export async function lastReply(page: Page): Promise<string> {
  return page.evaluate(() => {
    const turns = [...document.querySelectorAll("[data-message-author-role=assistant]")];
    return (turns[turns.length - 1]?.textContent ?? "").trim();
  });
}

/**
 * The last reply with its line breaks. `textContent` runs paragraphs together, which is fine for JSON
 * and ruins a description whose whole shape is short lines (`PROMPT-meesho-only`).
 */
export async function lastReplyLines(page: Page): Promise<string> {
  return page.evaluate(() => {
    const turns = [...document.querySelectorAll<HTMLElement>("[data-message-author-role=assistant]")];
    return (turns[turns.length - 1]?.innerText ?? "").trim();
  });
}

/**
 * Ask one question in a fresh chat and hand back the answer.
 *
 * A NEW chat each time, unlike the image run: this question carries its own price list and its own
 * note, and an earlier answer in the same thread would be context the model starts agreeing with
 * rather than re-deriving.
 */
export async function askOnce(page: Page, prompt: string, timeoutMs = 300_000): Promise<string> {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(6000);
  await sendPrompt(page, prompt);
  await waitUntilIdle(page, { timeoutMs });
  // The last chunk lands a beat after the stream ends.
  await page.waitForTimeout(2500);
  return lastReply(page);
}

/**
 * Name the chat after the work it holds.
 *
 * Vansh, 2026-09-14: *"rename the ChatGPT chat name — the SKU name… then followed by image if it
 * generated images, meta for the metadata one, and if delivery related then delivery-date."* The
 * sidebar is otherwise a column of *"Generate Balloon Image"* and *"Untitled"*, and the chat that
 * costed ANP018 is unfindable a week later — which matters because these are the chats a human goes
 * back to when a price looks wrong.
 *
 * Best effort, always. A rename that fails must never cost the work in the chat, so every step is
 * caught and the caller is told plainly rather than thrown at.
 */
export async function renameChat(page: Page, title: string): Promise<boolean> {
  try {
    // The chat has to exist before it can be named — an unsent draft has no entry in the sidebar.
    const id = /\/c\/([^/?#]+)/.exec(page.url())?.[1];
    if (!id) return false;

    const row = page.locator(`nav a[href="/c/${id}"]`).first();
    await row.hover({ timeout: 10_000 });
    // The three-dot button on that row. `has=` scopes it to this chat rather than the hovered one,
    // which is the same row today and need not be tomorrow.
    await page.locator(`nav li:has(a[href="/c/${id}"]) button`).last().click({ timeout: 10_000 });
    await page.getByRole("menuitem", { name: /rename/i }).click({ timeout: 10_000 });

    /**
     * **Wait for the rename box before writing into it.** The row turns into an input a moment AFTER
     * the menu item is clicked, and typing straight away sent the first keystrokes into nothing:
     * `HBD-Kitty01 — meta` landed as *"D-Kitty01 — meta"* and `delivery 2026-09-14` as *"ivery
     * 2026-09-14"* (Vansh's sidebar, 2026-09-17). Reproduced on a fake sidebar with a 400 ms delay.
     * So: wait until an input has focus, `fill` it in one step, confirm it holds the whole title,
     * and only then press Enter.
     */
    await page.waitForFunction(() => document.activeElement?.tagName === "INPUT", undefined, { timeout: 10_000 });
    const box = page.locator("input:focus");
    await box.fill(title, { timeout: 5_000 });
    if ((await box.inputValue()) !== title) return false;
    await box.press("Enter");
    await page.waitForTimeout(1500);

    /**
     * **Check it actually happened.** Every step above can succeed while the chat keeps its old
     * name — measured, 2026-09-14: this returned `true` and the chat was still called *"Reply
     * exactly OK"*. Vansh had said so first: *"I didn't see any chat with those names."*
     *
     * Read back by the chat's own id, never the top row, which is whatever is pinned. `document
     * .title` is the fallback because ChatGPT's sidebar does not always hold a row for the chat you
     * are looking at, and a missing row is not a failed rename.
     */
    return page.evaluate(
      ([id, want]) => {
        const row = document.querySelector(`nav a[href="/c/${id}"]`)?.textContent?.trim();
        return row === want || document.title.trim() === want;
      },
      [id, title] as const,
    );
  } catch {
    return false;
  }
}

/**
 * Rename a costing chat once a person has sent it.
 *
 * The costing chat is left UNSENT on purpose — the second gallery photo is not always the contents,
 * and Vansh swaps it before pressing Enter. But ChatGPT cannot rename a chat that does not exist yet,
 * so these chats kept ChatGPT's own titles (*"Inventory kit contents"*) and could not be found by SKU.
 * Each one is watched here — its URL read every 5 s, nothing loaded — and named `<SKU> — costing`
 * the moment it becomes `/c/<id>`. A tab closed unsent is simply dropped.
 */
const toName = new Map<Page, string>();
let naming: NodeJS.Timeout | null = null;
export function nameWhenSent(page: Page, title: string, every = 5000, settle = 4000): void {
  toName.set(page, title);
  if (naming) return;
  naming = setInterval(() => {
    for (const [p, title] of toName) {
      if (p.isClosed()) toName.delete(p);
      else if (/\/c\/[^/?#]+/.test(p.url())) {
        toName.delete(p);
        // A few seconds for the sidebar row to appear, then the same rename every chat uses.
        void p
          .waitForTimeout(settle)
          .then(() => renameChat(p, title))
          .catch(() => false);
      }
    }
    if (toName.size === 0 && naming) {
      clearInterval(naming);
      naming = null;
    }
  }, every);
}

/**
 * What a chat should be called, from what it was for.
 *
 * `ANP018 — images`, `ANP018 — meta`, `delivery 2026-09-14`. The SKU first because that is what a
 * human searches the sidebar for, and it is the one thing every listing chat has in common.
 */
export function chatTitle(what: "images" | "meta" | "costing" | "words" | "meesho", subject: string): string {
  return what === "words" ? `delivery ${subject}` : `${subject} — ${what}`;
}

// ---------------------------------------------------------------- the meta + product chat

/** Where `PROMPT-meta.md` asks for the kit. The kit JSON goes here rather than as an upload. */
const INVENTORY_SLOT = /^<PASTE THE INVENTORY HERE[^\n]*$/m;

/**
 * Put the kit's JSON where the prompt asks for it.
 *
 * **Throws when the slot is gone** rather than tacking the kit on somewhere: an edited prompt with
 * no slot would otherwise send a meta request with no inventory, and the prompt's own rule — "if it
 * is not in the INVENTORY, it does not exist" — would produce a listing of nothing.
 */
export function withInventory(prompt: string, kitJson: string): string {
  if (!INVENTORY_SLOT.test(prompt)) throw new Error("PROMPT-meta.md has no <PASTE THE INVENTORY HERE> line any more");
  return prompt.replace(INVENTORY_SLOT, () => kitJson.trim());
}

/**
 * The JSON object in a reply that PRINTED it instead of attaching a file — which both prompts allow.
 *
 * First `{` to last `}`: a code block's text also carries its "json" label and "Copy code" button,
 * and those sit outside the braces. Null when there is nothing that parses; never a guess.
 */
export function jsonFromReply(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Save what the last reply handed back to `to`: the attached file if there is one, else the printed JSON.
 *
 * Saved under OUR name, never the one ChatGPT chose. The file is filed by the ID in its name, and
 * the prompt already spends a paragraph begging the model not to tidy that ID.
 */
export async function saveReplyJson(page: Page, to: string): Promise<"file" | "text" | null> {
  await mkdir(path.dirname(to), { recursive: true });
  const link = page
    .locator("[data-message-author-role=assistant]")
    .last()
    .locator('a[href^="sandbox:"], a:has-text(".json"), button:has-text(".json")')
    .last();
  if (await link.count().catch(() => 0)) {
    try {
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), link.click()]);
      const part = `${to}.part`;
      await download.saveAs(part);
      JSON.parse(await readFile(part, "utf8")); // a download that is not JSON is not an answer
      await rename(part, to);
      return "file";
    } catch {
      // Fall through to the text: a link that would not download is still worth a look at the words.
    }
  }
  const data = jsonFromReply(await lastReply(page));
  if (data === null) return null;
  await writeFile(to, JSON.stringify(data, null, 2) + "\n");
  return "text";
}

/** The two prompts, in order, and which half of the listing each one produces. */
export const META_RUN = [
  { prompt: "PROMPT-meta.md", half: "image-meta" },
  { prompt: "PROMPT-product.md", half: "products" },
] as const;

export interface MetaResult {
  prompt: string;
  /** The saved JSON, or null when neither a file nor printed JSON came back. */
  file: string | null;
  /** Whether it arrived as a download or had to be read off the page. */
  via: "file" | "text" | null;
  seconds: number;
  timedOut: boolean;
}

/**
 * Describe the finished images and fill the Flipkart fields: `PROMPT-meta` then `PROMPT-product`,
 * in ONE chat.
 *
 * One chat because the second prompt reads the photos and inventory from the first (WW-081 split
 * them only because a combined ANSWER was truncated). Files land in `saveDir` under their download
 * names, so `importInbox(saveDir)` files them exactly as it files a hand download.
 */
export async function runMetaChat(
  page: Page,
  opts: {
    /** The finished images, in listing order — IMAGE 1 is the hero. */
    images: string[];
    /** The kit, as saved by the Inventory panel. Its `sku` names both files. */
    kit: { sku: string; json: string };
    readPrompt: (name: string) => Promise<string>;
    saveDir: string;
    onStep?: (r: MetaResult) => void;
    timeoutMs?: number;
    title?: string;
  },
): Promise<MetaResult[]> {
  // Both prompts read BEFORE anything is uploaded, so a broken prompt costs nothing.
  const texts = await Promise.all(META_RUN.map((s) => opts.readPrompt(s.prompt)));
  texts[0] = withInventory(texts[0], opts.kit.json);

  await page.locator("input[type=file]").first().setInputFiles(opts.images, { timeout: 30_000 });
  // Uploads have to finish before Enter, or the prompt goes out without its pictures.
  await page.waitForTimeout(3000 + 2000 * opts.images.length);

  const out: MetaResult[] = [];
  for (const [i, step] of META_RUN.entries()) {
    const started = Date.now();
    await sendPrompt(page, texts[i]);
    const finished = await waitUntilIdle(page, { timeoutMs: opts.timeoutMs ?? 300_000 });
    await page.waitForTimeout(2500);
    const file = path.join(opts.saveDir, `${step.half}-${opts.kit.sku}.json`);
    const via = await saveReplyJson(page, file);
    const r = {
      prompt: step.prompt,
      file: via ? file : null,
      via,
      seconds: Math.round((Date.now() - started) / 1000),
      timedOut: !finished,
    };
    out.push(r);
    opts.onStep?.(r);
  }
  if (opts.title) await renameChat(page, opts.title);
  return out;
}

// ---------------------------------------------------------------- the Meesho copy chat

/**
 * Meesho's copy for ONE kit: `PROMPT-meesho-only` with the pack in it, then `PROMPT-meesho-sheet`
 * for the dropdowns, in one chat — the second has to see the name the first wrote. Text only, no
 * photos: the prompt calls them optional and the pack is what the copy must come from anyway.
 * Hands back the two raw replies; `meesho-core` reads them, so the reading is unit-tested.
 */
export async function runMeeshoChat(
  page: Page,
  opts: { copyPrompt: string; sheetPrompt: string; title?: string; timeoutMs?: number },
): Promise<{ copyReply: string; sheetReply: string; timedOut: boolean }> {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(6000);
  let timedOut = false;
  const ask = async (text: string) => {
    await sendPrompt(page, text);
    timedOut = !(await waitUntilIdle(page, { timeoutMs: opts.timeoutMs ?? 300_000 })) || timedOut;
    await page.waitForTimeout(2500);
    return lastReplyLines(page);
  };
  const copyReply = await ask(opts.copyPrompt);
  const sheetReply = await ask(opts.sheetPrompt);
  if (opts.title) await renameChat(page, opts.title);
  return { copyReply, sheetReply, timedOut };
}

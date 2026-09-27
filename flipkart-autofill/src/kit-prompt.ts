/**
 * kit-prompt.ts — the kit's contents as text for the image prompts, counted by code, never by ChatGPT.
 *
 * The automated image run used to send `PROMPT-infographic.md` with its `[PASTE INVENTORY TABLE HERE]`
 * line still in it, and `PROMPT-infographic-sizes.md` with `<paste your typed inventory>` — nothing
 * filled either slot. ChatGPT answered the only way it could: by recounting the contents photo, which
 * is exactly the counting error the prompts spend a page forbidding. The kit is already typed, matched
 * and reviewed in the Inventory panel, so its numbers are the truth; this file turns them into the one
 * block every image prompt quotes, and the READY line that proves the chat read it right.
 */

import type { KitLine } from "./inventory-core.js";

/** Categories that are in the box but never on the wall. Packaging is not in the box at all. */
const AID_CATEGORIES = new Set(["Adhesive", "Equipment"]);
const NOT_IN_BOX = new Set(["Packaging"]);
/** The same list `PROMPT-inventory.md` names, for a line no material was matched to. */
const AID_WORDS = /\b(tape|glue|pump|hook|straw|thread)\b/i;

export interface KitCount {
  displayed: { qty: number; name: string }[];
  aids: { qty: number; name: string }[];
  displayedPieces: number;
  totalPieces: number;
}

/**
 * Split a saved kit into what is shown and what only helps assemble it, and add both up.
 *
 * `resolved` is the kit's own `index -> "Category|Material"` — the decision a human made in the panel,
 * so it outranks the word list. The size is the sheet's if it printed one, else the price list's.
 */
export function countKit(
  lines: KitLine[],
  resolved: Record<string | number, string> = {},
  sizeOf: (material: string) => string | undefined = () => undefined,
): KitCount {
  const out: KitCount = { displayed: [], aids: [], displayedPieces: 0, totalPieces: 0 };
  lines.forEach((l, i) => {
    const [category, material] = (resolved[i] ?? "").split("|");
    if (NOT_IN_BOX.has(category)) return;
    const size = l.size ?? (material ? sizeOf(material) : undefined);
    const row = { qty: l.qty, name: size ? `${l.item} (${size})` : l.item };
    const aid = category ? AID_CATEGORIES.has(category) || AID_WORDS.test(material ?? "") : AID_WORDS.test(l.item);
    (aid ? out.aids : out.displayed).push(row);
    if (!aid) out.displayedPieces += l.qty;
    out.totalPieces += l.qty;
  });
  return out;
}

/** The numbers the READY reply must repeat. */
export const readyLine = (c: KitCount): string =>
  `READY — ${c.displayed.length + c.aids.length} lines, ${c.displayedPieces} displayed pieces, ${c.totalPieces} total pieces`;

/** The block pasted into every image prompt. Numbered once, so "line 4" means one thing in every reply. */
export function kitBlock(sku: string, c: KitCount): string {
  let n = 0;
  const list = (rows: { qty: number; name: string }[]) => rows.map((r) => `${++n}. ${r.qty} x ${r.name}`).join("\n");
  const aids = c.totalPieces - c.displayedPieces;
  return [
    `KIT ${sku} — typed from our costed inventory and added up by our software. These are the only`,
    `items and the only numbers. Never recount from any picture, never add an item that is not listed.`,
    ``,
    `DISPLAYED (goes on the wall):`,
    list(c.displayed),
    ...(c.aids.length ? [``, `ASSEMBLY AIDS (in the box, NEVER shown in a decoration photo):`, list(c.aids)] : []),
    ``,
    `DISPLAYED PIECES: ${c.displayedPieces}`,
    `TOTAL PIECES IN THE BOX: ${c.totalPieces}` + (c.aids.length ? ` (displayed ${c.displayedPieces} + assembly aids ${aids})` : ""),
  ].join("\n");
}

/**
 * Every way the image prompts ask for the inventory, one per prompt file. `<KIT INVENTORY>` is
 * `PROMPT-kit-list.md`'s; the other two are the slots the hand flow always had.
 */
const SLOTS = [/^\[PASTE INVENTORY TABLE HERE\]$/m, /<paste your typed inventory>/, /^<KIT INVENTORY>$/m];

/** Put the block wherever the prompt asks for it. A prompt with no slot comes back unchanged. */
export const withKit = (prompt: string, block: string): string =>
  SLOTS.reduce((p, slot) => p.replace(slot, () => block), prompt);

/**
 * Did the chat read the list right? Null when the reply carries the exact READY line, else what to say.
 *
 * Compared by its three numbers, not character for character: a dash drawn differently is not a
 * misreading, a different piece count is — and a chat that has the count wrong before the first image
 * will draw it wrong three times, so the run stops rather than spend three generations finding out.
 */
export function checkReady(reply: string, c: KitCount): string | null {
  const nums = (s: string) => (/READY\D*(\d+)\D+(\d+)\D+(\d+)/i.exec(s) ?? []).slice(1).map(Number);
  const want = nums(readyLine(c));
  const got = nums(reply);
  if (got.length === 3 && got.every((x, i) => x === want[i])) return null;
  return got.length === 3
    ? `ChatGPT read the kit as ${got[0]} lines / ${got[1]} displayed / ${got[2]} total — ours is ${want[0]} / ${want[1]} / ${want[2]}. Stopped before any image.`
    : `ChatGPT did not confirm the kit with a READY line. Stopped before any image.`;
}

/**
 * A count check put under the HERO prompt, written from the kit — WW-267.
 *
 * The first live run read the counts right (READY 9 / 66 / 69) and still drew ~100 balloons for 40 and
 * 6 heart foils for 8. `PROMPT-main-image.md` says "use the DISPLAYED numbers from the list" and
 * "treat balloon counts as caps", but leaves the model to find the numbers again in a list several
 * messages back. This puts the exact numbers right under the instruction to draw, and says outright
 * that a thin garland at the true count is the right answer.
 */
export function countCheck(c: KitCount): string {
  return [
    ``,
    `COUNT CHECK — draw exactly these on the wall, each at exactly this number, and nothing else:`,
    ...c.displayed.map((r) => `- ${r.qty} x ${r.name}`),
    `That is ${c.displayedPieces} pieces. Count every group in your picture before you finish. Balloons`,
    `are the easiest to overdo: if the garland looks thin at the true count, leave it thin. A fuller`,
    `picture than the box is a return.`,
  ].join("\n");
}

/** The hero prompt, recognised by its opening line — the only prompt `countCheck` goes under. */
export const isHeroPrompt = (name: string): boolean => /^PROMPT-main-image/.test(name);

/**
 * Which picture a number is, in words ChatGPT can act on. Our 1/2/3 are OUR numbers — measured
 * 2026-09-27, "make image 1 again" got *"please upload the image you want me to remake"*, and the chat
 * had already been told the photo is IMAGE 2. So the redo attaches the picture and names it.
 */
export const pictureName = (n: number): string =>
  n === 1 ? "the main decoration photo" : n === 2 ? `the "what's in the box" infographic` : "the items-included sizes infographic";

/** `PROMPT-redo-image.md` with its two slots filled. Throws when a slot is gone, like `withInventory`. */
export function redoPrompt(template: string, n: number, wrong: string): string {
  if (!template.includes("<WHICH PICTURE>") || !template.includes("<WHAT IS WRONG>")) {
    throw new Error("PROMPT-redo-image.md has lost its <WHICH PICTURE> or <WHAT IS WRONG> slot");
  }
  return template.replace("<WHICH PICTURE>", () => pictureName(n)).replace("<WHAT IS WRONG>", () => wrong.trim() || "The counts do not match the kit list.");
}

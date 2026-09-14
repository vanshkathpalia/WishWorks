/**
 * supplier-words.ts — ask an AI, ONCE, what the supplier's words mean, and keep the answer as data.
 *
 * **Why this is not the thing WW-115 rejected.** That was pushing the whole price list into a
 * prompt at MATCH time: hundreds of names per sheet, every sheet, and the app left owning no data.
 * This sends the list once, offline, and what comes back is a file the app owns — word rules and
 * aliases. Every match afterwards is the same deterministic code as before, works with no internet,
 * and improves rather than re-guessing. Vansh, 2026-09-14: *"upload the list supplier has sent
 * with the existing inventory excel list, so that we have correct names list which we can upload
 * later to this system for easy picks."*
 *
 * **Nothing here is applied without a human.** The AI proposes; `applyProposal` only takes what has
 * been ticked. A wrong word rule is permanent and silent — it rewrites every future note — which is
 * exactly why the prompt is told to use `unsure` freely and why this file has a review step at all.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Material } from "./inventory-core.js";

/** What the AI is asked to return. Anything it invents beyond this shape is ignored. */
export interface Proposal {
  /** His word -> ours, true everywhere. The most valuable and the most dangerous. */
  words: Record<string, string>;
  /** A whole phrase that names one specific row. */
  aliases: { material: string; says: string }[];
  /** Lines naming something we genuinely do not stock. */
  new: string[];
  /** One line that is really two or more products. */
  split: { line: string; means: string[] }[];
  /** Anything it could not decide, with one sentence of why. */
  unsure: { line: string; why: string }[];
}

const EMPTY: Proposal = { words: {}, aliases: [], new: [], split: [], unsure: [] };

/**
 * The prompt, with both lists appended.
 *
 * The instructions live in `docs/guides/PROMPT-supplier-words.md` like every other prompt, so they
 * can be read and edited in one place; only the two lists are added here, because they are data
 * rather than wording.
 */
export function buildPrompt(instructions: string, materials: Material[], note: string): string {
  const listA = materials.map((m) => `${m.category} | ${m.material}`).join("\n");
  return `${instructions}\n\n--- LIST A: our price list ---\n${listA}\n\n--- LIST B: his note ---\n${note.trim()}\n`;
}

/**
 * Pull the proposal out of whatever the model actually replied.
 *
 * Tolerant of the wrapping — a fenced block, a bare object, or prose around either — because the
 * reply is a conversation turn, not an API response, and a run that fails on a stray sentence
 * wastes the whole exchange. Intolerant of the CONTENT: anything not matching the shape is dropped
 * rather than coerced, since a malformed rule applied is worse than a rule missed.
 */
export function readProposal(reply: string): Proposal {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const text = fenced ? fenced[1] : reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ...EMPTY };
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  const words: Record<string, string> = {};
  for (const [k, v] of Object.entries((raw.words as Record<string, unknown>) ?? {})) {
    const from = str(k).toLowerCase();
    const to = str(v).toLowerCase();
    // A rule mapping a word to itself, or to nothing, is not a rule.
    if (from && to && from !== to) words[from] = to;
  }

  return {
    words,
    aliases: arr(raw.aliases)
      .map((a) => ({ material: str((a as never)["material"]), says: str((a as never)["says"]) }))
      .filter((a) => a.material && a.says),
    new: arr(raw.new).map(str).filter(Boolean),
    split: arr(raw.split)
      .map((s) => ({ line: str((s as never)["line"]), means: arr((s as never)["means"]).map(str).filter(Boolean) }))
      .filter((s) => s.line && s.means.length > 1),
    unsure: arr(raw.unsure)
      .map((u) => ({ line: str((u as never)["line"]), why: str((u as never)["why"]) }))
      .filter((u) => u.line),
  };
}

/** A proposed rule, checked against reality, ready for a human to tick. */
export interface Review {
  kind: "word" | "alias";
  /** His wording. */
  from: string;
  /** What it would become — our word, or our material's full name. */
  to: string;
  /**
   * Why this one cannot be applied, empty when it can.
   *
   * **Checked here rather than trusted.** The model is told not to invent materials and mostly
   * does not; `applyProposal` still refuses a row that is not on the list, because "mostly" is not
   * a property you can build a price list on.
   */
  blockedBy: string;
  /** True when this would change an existing rule rather than add one. */
  replaces?: string;
}

/**
 * Check a proposal against the real price list and the rules already taught.
 *
 * Everything comes back — refusals included, with the reason — for the same reason the unlisted
 * block shows what it cannot place: a rule silently dropped is a rule nobody knows was dropped.
 */
export function reviewProposal(
  p: Proposal,
  materials: Material[],
  taught: Record<string, string> = {},
): Review[] {
  const names = new Map(materials.map((m) => [m.material.toLowerCase(), m.material]));
  const out: Review[] = [];

  for (const [from, to] of Object.entries(p.words)) {
    out.push({
      kind: "word",
      from,
      to,
      blockedBy: "",
      ...(taught[from] && taught[from] !== to ? { replaces: taught[from] } : {}),
    });
  }
  for (const a of p.aliases) {
    /**
     * `Decoration | Car Theme Set of 5` — the list is SHOWN to the model in that shape, so it
     * sometimes echoes it back. One of forty did on the first real run, and it read as an invented
     * row when the row was perfectly real. Only the part after the last `|` names the material.
     */
    const said = a.material.includes("|") ? a.material.slice(a.material.lastIndexOf("|") + 1) : a.material;
    const real = names.get(said.trim().toLowerCase());
    out.push({
      kind: "alias",
      from: a.says,
      to: real ?? said.trim(),
      blockedBy: real ? "" : "no such row on the price list",
    });
  }
  return out;
}

/** Load the instructions that ship with the app. */
export const promptText = (guidesDir: string): string =>
  readFileSync(path.join(guidesDir, "PROMPT-supplier-words.md"), "utf8");

/**
 * Write the ticked rules where the matcher will read them.
 *
 * Two destinations because they are two different kinds of fact. A **word** is about how this
 * supplier talks and lives in `words.json` beside the orders; an **alias** is about one row of the
 * price list and lives on that row, next to its price and its pack size.
 *
 * Returns what to save rather than saving it, so the caller owns the files and this stays testable
 * without a disk.
 */
export function applyProposal(
  chosen: Review[],
  materials: Material[],
  taught: Record<string, string>,
): { words: Record<string, string>; materials: Material[]; added: number } {
  const words = { ...taught };
  const rows = materials.map((m) => ({ ...m, aka: m.aka ? [...m.aka] : undefined }));
  let added = 0;

  for (const r of chosen) {
    if (r.blockedBy) continue;
    if (r.kind === "word") {
      words[r.from] = r.to;
      added++;
      continue;
    }
    const row = rows.find((m) => m.material === r.to);
    if (!row) continue;
    const aka = row.aka ?? [];
    // Already there, in any casing — adding it again would fail the price list's uniqueness check.
    if (aka.some((a) => a.toLowerCase() === r.from.toLowerCase())) continue;
    row.aka = [...aka, r.from];
    added++;
  }
  return { words, materials: rows, added };
}

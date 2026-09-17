/**
 * share-core.ts — carry what one computer knows about inventory to another, as one file.
 *
 * There is no database and no sync: everything lives on each machine. Vansh, 2026-09-17: *"i just
 * want to get the new added inventory to load to some other people."* So Settings has two buttons —
 * Export writes the price list, the taught words and the aliases into one JSON file, which travels
 * over WhatsApp or Drive, and Import folds it into the other machine.
 *
 * **Import only ever ADDS.** A material, word or alias the other machine does not have is added. One
 * it has with a DIFFERENT value is listed as a clash and left alone — a silent overwrite of a price
 * is exactly the damage a shared database would have prevented, and nothing downstream re-checks it.
 * Importing the same file twice adds nothing the second time.
 *
 * Deliveries and stock are deliberately NOT in the file: each person counts their own shelf, and
 * merging two shelves would double-count every packet.
 *
 * `planImport` is pure; `applyImport` does the writing through `addMaterial`, which already knows
 * whether this machine writes the list itself (development) or the overlay (a packaged app).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { addMaterial, materialKey, normalize, rupees, type Material } from "./inventory-core.js";

export const KIND = "wishworks-inventory";

export interface InventoryFile {
  kind: typeof KIND;
  version: 1;
  exportedAt: string;
  /** Which account / computer it came from, so a clash can say whose price is whose. */
  from: string;
  materials: Material[];
  /** Supplier's word -> our word, e.g. `kt` -> `fringe`. */
  words: Record<string, string>;
  /** A delivery-note phrase -> `category|material`. */
  aliases: Record<string, string>;
}

export function buildExport(from: string, materials: Material[], words: Record<string, string>, aliases: Record<string, string>, now = new Date()): InventoryFile {
  return { kind: KIND, version: 1, exportedAt: now.toISOString(), from, materials, words, aliases };
}

/** Read an exported file, or say in one sentence why it is not one. */
export function readInventoryFile(text: string): InventoryFile {
  let parsed: Partial<InventoryFile>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not an inventory export — it is not even JSON.");
  }
  if (parsed?.kind !== KIND || !Array.isArray(parsed.materials)) {
    throw new Error('That file is not an inventory export. Pick the "wishworks-inventory-….json" file someone sent you.');
  }
  return {
    kind: KIND,
    version: 1,
    exportedAt: String(parsed.exportedAt ?? ""),
    from: String(parsed.from ?? "someone"),
    materials: parsed.materials.filter((m) => typeof m?.material === "string" && typeof m?.category === "string"),
    words: parsed.words && typeof parsed.words === "object" ? parsed.words : {},
    aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {},
  };
}

export interface ImportPlan {
  addMaterials: Material[];
  /** Same material on both machines at different prices. Never applied. */
  priceClashes: { key: string; mine: number | null; theirs: number | null }[];
  /** Their material's NAME is already used here under another category, or as another row's old name. */
  nameClashes: { theirs: string; mine: string }[];
  addWords: Record<string, string>;
  wordClashes: { word: string; mine: string; theirs: string }[];
  addAliases: Record<string, string>;
  aliasClashes: { says: string; mine: string; theirs: string }[];
}

export function planImport(
  mine: { materials: Material[]; words: Record<string, string>; aliases: Record<string, string> },
  theirs: InventoryFile,
): ImportPlan {
  const byKey = new Map(mine.materials.map((m) => [materialKey(m), m]));
  const plan: ImportPlan = {
    addMaterials: [], priceClashes: [], nameClashes: [],
    addWords: {}, wordClashes: [], addAliases: {}, aliasClashes: [],
  };
  // Names as `addMaterial` sees them — it refuses a name already used by any row or any `aka`.
  const names = new Map<string, Material>();
  for (const m of mine.materials) for (const n of [m.material, ...(m.aka ?? [])]) names.set(normalize(n), m);

  for (const t of theirs.materials) {
    const key = materialKey(t);
    const here = byKey.get(key);
    if (here) {
      // ponytail: only the price is compared; a differing size or packet count is not reported yet.
      if (here.paise !== t.paise) plan.priceClashes.push({ key, mine: here.paise, theirs: t.paise });
      continue;
    }
    const taken = names.get(normalize(t.material));
    if (taken) {
      plan.nameClashes.push({ theirs: key, mine: materialKey(taken) });
      continue;
    }
    plan.addMaterials.push(t);
    names.set(normalize(t.material), t);
  }

  for (const [word, means] of Object.entries(theirs.words)) {
    const have = mine.words[word];
    if (have === undefined) plan.addWords[word] = means;
    else if (have !== means) plan.wordClashes.push({ word, mine: have, theirs: means });
  }

  // An alias is only worth adding if the row it points at exists here once the import is done.
  const known = new Set([...byKey.keys(), ...plan.addMaterials.map(materialKey)]);
  for (const [says, key] of Object.entries(theirs.aliases)) {
    const have = mine.aliases[says];
    if (have === undefined) {
      if (known.has(key)) plan.addAliases[says] = key;
    } else if (have !== key) plan.aliasClashes.push({ says, mine: have, theirs: key });
  }
  return plan;
}

/** Write the plan. Returns what actually went in — a row `addMaterial` refused is reported, not lost. */
export async function applyImport(
  plan: ImportPlan,
  where: { categoriesDir: string; editsFile: string; wordsFile: string; aliasesFile: string },
): Promise<{ materials: number; words: number; aliases: number; refused: string[] }> {
  const refused: string[] = [];
  let materials = 0;
  for (const m of plan.addMaterials) {
    try {
      addMaterial(m, where.categoriesDir, where.editsFile);
      materials++;
    } catch (e) {
      refused.push(`${m.material}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const merge = async (file: string, add: Record<string, string>) => {
    if (Object.keys(add).length === 0) return 0;
    const current = await readFile(file, "utf8").then((t) => JSON.parse(t) as Record<string, string>, () => ({}));
    // Existing entries win: `planImport` only put keys here that this machine did not have.
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ ...add, ...current }, null, 2)}\n`);
    return Object.keys(add).length;
  };
  return {
    materials,
    words: await merge(where.wordsFile, plan.addWords),
    aliases: await merge(where.aliasesFile, plan.addAliases),
    refused,
  };
}

/** The clashes in words a person reads, one per line. Empty when there are none. */
export function describeClashes(plan: ImportPlan, from: string): string[] {
  const money = (p: number | null) => (p === null ? "no price" : rupees(p));
  return [
    ...plan.priceClashes.map((c) => `${c.key.split("|")[1]}: yours ${money(c.mine)}, ${from}'s ${money(c.theirs)} — not changed`),
    ...plan.nameClashes.map((c) => `${c.theirs.split("|")[1]} (${c.theirs.split("|")[0]}) — you already have that name as ${c.mine.replace("|", " › ")}, not added`),
    ...plan.wordClashes.map((c) => `word "${c.word}": yours means ${c.mine}, ${from}'s means ${c.theirs} — kept yours`),
    ...plan.aliasClashes.map((c) => `"${c.says}": yours is ${c.mine.split("|")[1]}, ${from}'s is ${c.theirs.split("|")[1]} — kept yours`),
  ];
}

/**
 * packaging.ts — how big and heavy the posted parcel is, from what the kit contains.
 *
 * Flipkart asks for this **twice, in different units on different tabs** (Package Details wants
 * cm and kg on Price/Stock; Dimensions wants inches on Additional Description), and Meesho asks
 * again. That is three places for one measurement to be typed differently, which is exactly how
 * `Net Weight = 10000 g` ended up on a live listing (WW-055). So it is computed once, here, and
 * everything else derives from it.
 *
 * **The two marketplaces price delivery differently and only one of them cares about this file.**
 * Flipkart charges on volume and weight, so the box size genuinely moves the fee. Meesho quotes
 * before a weight has been entered at all and its number tracks the main image — every one of
 * SHIPPING-COST.md's fourteen failed experiments was Meesho, which is why nothing declared here
 * ever shifted it. Warnings below say which platform they apply to; a generic "the courier bills
 * the larger one" would send someone shrinking a box to fix a fee that ignores boxes.
 *
 * **This is deliberately code and not a prompt.** It is arithmetic over the inventory the app
 * already holds; a model would do it silently and untestably, and CLAUDE.md's rule is that
 * deterministic code computes and Claude only writes copy.
 *
 * Centimetres and grams throughout — inches are derived on the way out and never stored, because
 * two copies of one measurement drift.
 */

import fs from "node:fs";
import path from "node:path";
import { CATEGORIES_DIR } from "./paths.js";
import { type KitLine, type Material, score, FLOOR } from "./inventory-core.js";

export interface PackagingRule {
  name: string;
  /** Material names from materials.json. Matched, not keyword-searched — see the JSON's note. */
  whenAnyOf: string[];
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
  addGrams?: number;
}

/** A polybag on the shelf, offered as a choice when the rules pick the wrong one. */
export interface Box {
  label: string;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

export interface PackagingSpec {
  base: { lengthCm: number; breadthCm: number; heightCm: number; grams: number };
  maxGrams: number;
  rules: PackagingRule[];
  /** The sizes a human may pick from. Empty is fine — the rules still work. */
  boxes: Box[];
}

export interface Parcel {
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  grams: number;
  /** L x B x H / 5000, in grams. What a courier bills on when it exceeds the real weight. */
  volumetricGrams: number;
  /** The greater of the two — the number that actually costs money. */
  billedGrams: number;
  /** Which rules fired, so the screen can say WHY the box got bigger. */
  applied: string[];
  /** True when a human chose the size or the weight, so the screen must not claim it was derived. */
  overridden: boolean;
  /** Things a human has to decide about. Never silently corrected. */
  warnings: string[];
}

/**
 * Reads the named fields rather than trusting the object's shape, because every JSON file in this
 * repo carries `_` notes for humans and they must not become data — the same rule `loadProduct()`
 * applies to product values. Copying `base` wholesale put a paragraph of prose inside the parcel.
 */
export function loadPackaging(dir = CATEGORIES_DIR): PackagingSpec | null {
  const file = path.join(dir, "packaging.json");
  if (!fs.existsSync(file)) return null;
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  const b = p?.base;
  if (!b || typeof b.grams !== "number") return null;
  return {
    base: {
      lengthCm: Number(b.lengthCm),
      breadthCm: Number(b.breadthCm),
      heightCm: Number(b.heightCm),
      grams: Number(b.grams),
    },
    maxGrams: typeof p.maxGrams === "number" ? p.maxGrams : Infinity,
    rules: (p.rules ?? []).map((r: PackagingRule) => ({
      name: r.name,
      whenAnyOf: r.whenAnyOf ?? [],
      lengthCm: r.lengthCm,
      breadthCm: r.breadthCm,
      heightCm: r.heightCm,
      addGrams: r.addGrams,
    })),
    boxes: (p.boxes ?? []).map((b: Box) => ({
      label: String(b.label),
      lengthCm: Number(b.lengthCm),
      breadthCm: Number(b.breadthCm),
      heightCm: Number(b.heightCm),
    })),
  };
}

/** cm to inches, one decimal — the precision the Additional Description tab's boxes accept. */
export const toInches = (cm: number): number => Math.round((cm / 2.54) * 10) / 10;

/**
 * Does this kit contain any of the named materials?
 *
 * Matched through the same scorer the cost table uses, rather than by string equality, so a rule
 * naming `Green Net` still fires on a sheet that says `GREEN NET` or an old name in that row's
 * `aka`. A rule that named a keyword instead would be a trap — "net" would catch a future
 * "Netted Curtain" and quietly add 40 g to kits that contain no net at all.
 */
function kitHas(lines: KitLine[], names: string[], materials: Material[]): boolean {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const rows = materials.filter((m) => wanted.has(m.material.toLowerCase()));
  if (rows.length === 0) return false;
  return lines.some((l) => rows.some((r) => score(l.item, r) >= FLOOR));
}

/**
 * The parcel for one kit.
 *
 * Rules take the LARGEST dimension any of them asks for rather than the last one to fire, so two
 * rules that both grow the box cannot cancel each other out depending on file order. Weights add,
 * because two heavy things in one parcel really are heavier.
 */
export function parcelFor(
  lines: KitLine[],
  materials: Material[],
  spec: PackagingSpec,
  overrides: Partial<Parcel> = {},
): Parcel {
  let { lengthCm, breadthCm, heightCm, grams } = spec.base;
  const applied: string[] = [];

  for (const rule of spec.rules) {
    if (!kitHas(lines, rule.whenAnyOf, materials)) continue;
    applied.push(rule.name);
    lengthCm = Math.max(lengthCm, rule.lengthCm ?? 0);
    breadthCm = Math.max(breadthCm, rule.breadthCm ?? 0);
    heightCm = Math.max(heightCm, rule.heightCm ?? 0);
    grams += rule.addGrams ?? 0;
  }

  // A hand-entered figure always wins — someone who has weighed the actual parcel knows more than
  // a rule table, and this is the number the courier will check at pickup.
  lengthCm = overrides.lengthCm ?? lengthCm;
  breadthCm = overrides.breadthCm ?? breadthCm;
  heightCm = overrides.heightCm ?? heightCm;
  grams = overrides.grams ?? grams;

  const volumetricGrams = Math.round((lengthCm * breadthCm * heightCm) / 5);
  const billedGrams = Math.max(grams, volumetricGrams);

  const warnings: string[] = [];
  if (grams > spec.maxGrams) {
    warnings.push(`${grams} g is over the ${spec.maxGrams} g ceiling for a parcel.`);
  }
  // Named as a FLIPKART concern, not a general one. Vansh, 2026-08-08: Flipkart charges on volume
  // and weight, so a box that grows costs more there. Meesho quotes its fee before a weight has
  // even been entered and it tracks the main image — SHIPPING-COST.md's fourteen tests were all
  // Meesho, and none of them moved the number by changing anything declared. Saying "a courier
  // bills the larger one" as though it applied to both would send someone shrinking a box to fix
  // a Meesho fee that has nothing to do with it.
  if (volumetricGrams > grams) {
    warnings.push(
      `On Flipkart this parcel bills at ${volumetricGrams} g, not its real ${grams} g — volume wins when it is larger. Packing flatter is worth more than removing weight. Meesho is unaffected: it sets its fee from the main image, before a weight is entered.`,
    );
  }
  return {
    lengthCm, breadthCm, heightCm, grams, volumetricGrams, billedGrams, applied,
    overridden: Object.keys(overrides).length > 0,
    warnings,
  };
}

/**
 * The same parcel as the two forms Flipkart asks for.
 *
 * They are on different tabs in different units and `loadProduct()` merges every defaults file
 * into ONE flat map keyed by label — so `Height` and `Weight`, which exist on BOTH tabs, cannot be
 * told apart and one value gets typed into both. That is why `Height` and `Weight` are absent from
 * the pricing defaults now: Package Details is filled by hand, Dimensions is filled by the bot,
 * and neither can poison the other. Splitting them properly needs `scan` to record a field's tab,
 * which it does not (WW-112).
 */
export function flipkartFields(p: Parcel): {
  packageDetails: Record<string, string>;
  dimensions: Record<string, string>;
} {
  return {
    // Price/Stock/Shipping → Package Details. Fixed CM/KG labels, not unit pickers.
    packageDetails: {
      Length: String(p.lengthCm),
      Breadth: String(p.breadthCm),
      Height: String(p.heightCm),
      Weight: (p.grams / 1000).toFixed(3),
    },
    // Additional Description → Dimensions, in inches. The long side is Depth and the short side
    // is Width, so a parcel lying flat reads the way it sits.
    dimensions: {
      Width: String(toInches(p.breadthCm)),
      Height: String(toInches(p.heightCm)),
      Depth: String(toInches(p.lengthCm)),
      Weight: (p.grams / 1000).toFixed(3),
      "Weight (unit)": "kg",
    },
  };
}

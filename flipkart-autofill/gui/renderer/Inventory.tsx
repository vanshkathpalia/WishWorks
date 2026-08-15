/**
 * Inventory.tsx — what a kit costs, from the sheet the partner sends.
 *
 * The Excel this replaces is slow for one reason: every line is a dropdown and a kit is twenty
 * lines. The counts are already printed on the sheet, so this reads them once and only asks a
 * human about the lines it is unsure of.
 *
 * **The image sits beside the table on purpose, and it is the whole verification story.** OCR was
 * built and removed (WW-115): when OCR and the AI disagree you still have to open the image to see
 * which is right, so the image IS the check, and reading a table against the picture it came from
 * is one glance.
 *
 * Four states per line, and they are deliberately different because their fixes are different:
 *   priced        — quiet.
 *   flagged       — priced, but the name was ambiguous. Check it against the picture.
 *   no price set  — the material is on the list, its price cell is blank. Fill a cell.
 *   not on list   — no such material. Add a row, or correct this line.
 * The last two are summed as *uncosted* and printed next to the total, because a total that
 * quietly skipped four items is the failure this screen exists to prevent.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Box, CostedLine, Kit, KitLine, KitRow, Listing, Material, Parcel, SavedKit } from "../shared.js";
import { skuNumbers, skuPrefix } from "../shared.js";
import { CopyButton, fileUrl } from "./ui.js";
import { PromptEditor } from "./PromptEditor.js";

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;

/**
 * Centimetres to inches, one decimal — SCREEN ONLY.
 *
 * Vansh buys polybags by their inch size and reads a parcel that way ("the smallest one I use is
 * 8 by 10"), so cm on this panel is a number he has to convert in his head before he can tell
 * whether it is right. Everything underneath stays in cm: `packaging.json` stores cm, the engine
 * computes volumetric weight from cm, Flipkart's Package Details asks for cm, and the inch pair
 * the Additional Description tab wants is derived by `toInches` in `packaging.ts`. This is that
 * same one-liner rather than an import, because importing it would pull the engine (and `node:fs`
 * with it) into the renderer bundle — the one thing shared.ts exists to prevent. A formula can be
 * repeated; a measurement may not be.
 */
const inches = (cm: number) => Math.round((cm / 2.54) * 10) / 10;
const inchSize = (l: number, b: number, h: number) =>
  `${inches(l)} × ${inches(b)} × ${inches(h)} in`;

/** The partner's rule of thumb: a kit should leave about ₹60 after materials, delivery and GST. */
const TARGET_PAISE = 6000;

/**
 * How far the WORST marketplace is from the ₹60 target, 0 (on it) to 1 (₹60 out or more).
 *
 * The worst rather than the average, because the two marketplaces are priced separately and
 * routinely disagree — a kit that is healthy on Flipkart and losing money on Meesho is a kit to
 * look at, and an average would hide exactly that. `null` means nothing to judge: no listed price
 * yet, which is a different state from a bad margin and must not be coloured like one.
 */
function drift(k: KitRow): number | null {
  const each = Object.values(k.left ?? {});
  if (each.length === 0) return null;
  return Math.min(Math.max(...each.map((v) => Math.abs(v - TARGET_PAISE))) / TARGET_PAISE, 1);
}

/**
 * Dark = on target and settled; light = far off and asking for attention.
 *
 * One hue (the app's accent), lightness carrying the meaning, so the list reads as a heat map at a
 * glance instead of a wall of identical buttons. On this dark panel a light chip is the thing that
 * catches the eye, which is the right way round: the kits that need fixing are the ones that
 * should stand out.
 */
function driftStyle(d: number | null): React.CSSProperties | undefined {
  if (d === null) return undefined;
  return {
    background: `hsl(24, ${Math.round(35 + d * 50)}%, ${Math.round(14 + d * 46)}%)`,
    borderColor: `hsl(24, ${Math.round(35 + d * 50)}%, ${Math.round(24 + d * 46)}%)`,
    color: d > 0.55 ? "#1a1210" : "var(--ink)",
  };
}

/** `cost / (1 - margin)` — margin on the selling price, not markup on the cost. See the engine. */
const priceAt = (costPaise: number, margin: number) =>
  Math.round(costPaise / (1 - Math.min(Math.max(margin, 0), 95) / 100));

const key = (m: Material) => `${m.category}|${m.material}`;

/**
 * The kit as JSON, in the shape it arrived in — the reading, plus any row a human overruled.
 *
 * `item` stays exactly as the sheet had it. It is the column that gets read against the picture,
 * and replacing it with the price-list name would throw away the only evidence on the screen: you
 * would no longer be able to tell whether *Silver Metallic Balloon* is what the sheet said or what
 * the app decided. The decision goes in `pick` beside it, so the two facts stay two facts.
 *
 * `pick: ""` is not the same as no `pick`. It is a human saying *this is on no row at all*, and it
 * has to survive the round trip, or the line would quietly re-match to whatever it scored best
 * against the next time the box was read.
 *
 * The prices, the delivery figures and the corrected counts stay out. They are edited elsewhere on
 * this screen and a second copy of them in a textarea is a second thing to keep in step.
 */
function asJson(sku: string, lines: KitLine[], overrides: Record<number, string>) {
  return JSON.stringify(
    {
      sku,
      lines: lines.map((l, i) => ({
        item: l.item,
        qty: l.qty,
        ...(l.size ? { size: l.size } : {}),
        ...(i in overrides ? { pick: overrides[i].split("|")[1] ?? "" } : {}),
      })),
    },
    null,
    2,
  );
}

/**
 * Pick a material by TYPING, not by scrolling 121 rows.
 *
 * A `<select>` can only be searched by the first letters of a name, so finding *Silver Confetti
 * Balloon* meant knowing it starts with "Silver" and scrolling past everything else that does.
 * `<input list>` is the same control with substring search, and it is native — no combobox
 * library, no keyboard handling, no popup positioning of our own.
 *
 * **It cannot be left in a half-typed state.** Only a name that IS a row commits; anything else is
 * held as text and thrown away on blur, so the box always goes back to saying what the line is
 * actually costed as. An empty box is the one other real answer — *not on the price list* — and
 * commits as such.
 */
function MaterialPicker({
  id,
  name,
  flagged,
  choices,
  byCategory,
  onPick,
}: {
  id: string;
  /** The material this line is costed as right now, or "" for none. */
  name: string;
  flagged: boolean;
  choices: CostedLine["choices"];
  byCategory: [string, Material[]][];
  onPick: (key: string) => void;
}) {
  /** What is being typed, while it is not yet a row. `null` means the box shows `name`. */
  const [typed, setTyped] = useState<string | null>(null);
  const byName = useMemo(
    () => new Map(byCategory.flatMap(([, rows]) => rows.map((m) => [m.material.toLowerCase(), m]))),
    [byCategory],
  );
  // The near misses go first so they are what an unopened list offers; showing them again inside
  // their category would just be the same row twice.
  const ranked = choices.map((c) => c.material.material);

  function commit(text: string) {
    const hit = byName.get(text.trim().toLowerCase());
    if (hit) {
      onPick(key(hit));
      setTyped(null);
      return;
    }
    if (text.trim() === "") {
      onPick("");
      setTyped(null);
      return;
    }
    setTyped(text);
  }

  return (
    <>
      <input
        // Spelt out, not left to default: the app's input styling is `input[type="text"]`, and an
        // attribute selector does not match an attribute that is not there. Without it this box
        // renders as a white browser default in a dark panel.
        type="text"
        className={flagged ? "loose" : ""}
        list={id}
        value={typed ?? name}
        placeholder={name ? "type to search, or pick from the list" : "— not on the price list —"}
        spellCheck={false}
        onChange={(e) => commit(e.target.value)}
        // Clicking in empties the box so the list opens on EVERYTHING. The browser filters a
        // datalist by whatever is already in the field, so a line matched to "Silver Confetti
        // Balloon" would otherwise open a list of exactly that one row — useless for the case this
        // control exists for, which is not remembering what the list holds. Nothing is committed
        // here: blur puts the current match straight back.
        onFocus={() => setTyped("")}
        onBlur={() => setTyped(null)}
      />
      <datalist id={id}>
        {choices.map((c) => (
          <option key={`c-${key(c.material)}`} value={c.material.material}>
            closest · {Math.round(c.score * 100)}%
          </option>
        ))}
        {byCategory.map(([category, rows]) =>
          rows
            .filter((m) => !ranked.includes(m.material))
            .map((m) => (
              <option key={key(m)} value={m.material}>
                {category} · {m.paise === null ? "no price" : rupees(m.paise)}
              </option>
            )),
        )}
      </datalist>
    </>
  );
}

/** The two we sell on. Ids are the keys stored in the saved kit, so renaming a label is safe. */
const MARKETPLACES = [
  { id: "meesho", label: "Meesho" },
  { id: "flipkart", label: "Flipkart" },
] as const;

/** Rupees in the boxes, paise on disk — the boundary is here, once, in both directions. */
type Market = Record<string, { price?: number; ship?: number }>;

export function Inventory({ n }: { n: number }) {
  const [prompt, setPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [gaps, setGaps] = useState<{ noPrice: Material[]; noSize: Material[]; total: number } | null>(null);
  const [showGaps, setShowGaps] = useState(false);

  const [image, setImage] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [lines, setLines] = useState<KitLine[] | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [sku, setSku] = useState("");
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [margin, setMargin] = useState(50);
  // The partner's current advice is +60 flat. A default, not a rule — it is editable and saved.
  const [flat, setFlat] = useState(60);
  // 5% matches the GST_5 tax code on the listings. Editable because a category can differ.
  const [gst, setGst] = useState(5);
  const [over, setOver] = useState<"image" | "json" | null>(null);
  /** True while the JSON box has the cursor. See the effect that keeps the box and the kit in step. */
  const [boxFocused, setBoxFocused] = useState(false);
  const [saved, setSaved] = useState<KitRow[]>([]);
  /** Every listing on this machine, only ever read for which SKU numbers are already used. */
  const [listings, setListings] = useState<Listing[]>([]);
  /**
   * The file this kit was opened from, when it was opened from one.
   *
   * Only reason it exists: the filename is made from the SKU, so changing the SKU and keeping
   * writes a NEW file and would leave the old one sitting in the list under the old name. This is
   * what lets a rename be a rename.
   */
  const [openedFile, setOpenedFile] = useState<string | null>(null);
  const [showKits, setShowKits] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [market, setMarket] = useState<Market>({});
  /** Unit prices for THIS kit only, `category|material` -> rupees as typed. */
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [priceNote, setPriceNote] = useState<string | null>(null);
  /** Counts corrected by hand, by line index. The reading itself is never edited. */
  const [counts, setCounts] = useState<Record<number, number>>({});
  /** A box size or weight chosen by hand for this kit. Empty means "follow the rules". */
  const [chosen, setChosen] = useState<{
    lengthCm?: number;
    breadthCm?: number;
    heightCm?: number;
    grams?: number;
  }>({});
  /**
   * What is in the three inch boxes AS TYPED, before it becomes centimetres.
   *
   * Kept separate because the stored unit is not the shown one: typing "8." would round-trip to
   * cm and back as "8", the dot would vanish under the cursor, and the next keystroke would make
   * it "87" — eighty-seven inches, silently. WW-134 is the same lesson with a different
   * conversion. The typed string wins while you are typing; the parcel wins the moment you stop.
   */
  const [typed, setTyped] = useState<{ l?: string; b?: string; h?: string }>({});
  const [sent, setSent] = useState<string | null>(null);
  const [parcel, setParcel] = useState<{
    parcel: Parcel;
    boxes: Box[];
    packageDetails: Record<string, string>;
    dimensions: Record<string, string>;
  } | null>(null);

  /** Empty stays undefined rather than becoming 0, so "not filled in" reads as "—", not "free". */
  function setOne(id: string, field: "price" | "ship", raw: string) {
    const v = raw === "" ? undefined : Number(raw);
    setMarket((m) => ({ ...m, [id]: { ...m[id], [field]: v } }));
  }

  const refreshSaved = useCallback(() => void window.ww.listKits().then(setSaved), []);

  // The list is read off the folder every time, so a kit renamed, added or deleted in Finder is
  // picked up — on coming back to the window, which is when you have just been in there.
  useEffect(() => {
    window.addEventListener("focus", refreshSaved);
    return () => window.removeEventListener("focus", refreshSaved);
  }, [refreshSaved]);

  // Re-read after the editor closes, in case the prompt was changed.
  useEffect(() => {
    if (editing) return;
    void window.ww.promptText("PROMPT-inventory.md").then(setPrompt).catch(() => setPrompt(""));
  }, [editing]);
  useEffect(() => {
    void window.ww.materials().then(setMaterials);
    void window.ww.materialGaps().then(setGaps);
    void window.ww.listings().then(setListings);
    refreshSaved();
  }, [refreshSaved]);

  // One source for the total: every correction re-costs the whole kit in the engine, so the
  // number at the bottom can never disagree with the rows above it.
  useEffect(() => {
    if (!lines) return;
    const paise = Object.fromEntries(
      Object.entries(prices).map(([k, v]) => [k, Math.round(v * 100)]),
    );
    void window.ww.costLines(lines, overrides, sku, paise, counts).then(setKit);
  }, [lines, overrides, sku, prices, counts]);

  // The parcel depends on WHAT is in the kit, never on what a line was priced as — correcting a
  // material's price cannot change the size of the box.
  useEffect(() => {
    if (!lines) {
      setParcel(null);
      return;
    }
    void window.ww.parcelFor(lines, chosen).then(setParcel);
  }, [lines, chosen]);

  /**
   * The box mirrors the kit — EXCEPT while it is being typed in.
   *
   * Two things claim to own that text: the table (correct a material, renumber the SKU) and the
   * keyboard. A plain "rewrite the box whenever the kit changes" would fight the keyboard, because
   * every keystroke re-costs the kit and would rewrite the text under the cursor. Focus decides:
   * while the box has it, what is typed is the truth; the moment it is let go, the kit is. That
   * makes the two directions impossible to hold at the same time, which is why there is no case
   * where they disagree.
   */
  useEffect(() => {
    if (lines === null || boxFocused) return;
    setPaste(asJson(sku, lines, overrides));
  }, [sku, lines, overrides, boxFocused]);

  /**
   * The kits by their code, and what the next free number under each one is.
   *
   * The question this answers is the one Vansh kept having to answer by scrolling: *what number
   * does the next ANP get?* Getting it wrong writes a second `ANP004` — one folder of images, one
   * `products/` file and one kit all fighting over the same name.
   *
   * **Every number anything uses counts as taken, not just the costed kits.** A listing exists as
   * soon as there is a product file, a description or a folder of images, long before anyone costs
   * it, and `listings()` already unions all four — using only the kits would hand back a number a
   * half-built listing is already sitting on. The width of the number is copied from the highest
   * one seen (`ANP004` → `ANP005`, `GTB-1` → `GTB-2`), because the existing files disagree about
   * padding and the useful suggestion is the one that looks like its neighbours.
   */
  const groups = useMemo(() => {
    const kits = new Map<string, KitRow[]>();
    for (const k of saved) {
      const p = skuPrefix(k.sku);
      kits.set(p, [...(kits.get(p) ?? []), k]);
    }
    /**
     * A code only becomes a heading if something is actually NAMED with it — a kit or a listing
     * whose name STARTS with it. The number scan reads every code in a name, which is what makes
     * `WKU003-GTB001` count against GTB, but on real data it also turns up `DORE` and `KITTY` out
     * of `HBD-DORE01` and `HBD-Kitty01`. Those are not categories; they are the middle of a name.
     */
    const codes = new Set([...kits.keys(), ...listings.map((l) => skuPrefix(l.label))]);
    codes.delete("");

    const highest = new Map<string, { n: number; from: string }>();
    const note = (id: string) => {
      for (const [prefix, n] of skuNumbers(id)) {
        if (!codes.has(prefix)) continue;
        if (n > (highest.get(prefix)?.n ?? 0)) highest.set(prefix, { n, from: id });
      }
    };
    for (const k of saved) note(k.sku);
    for (const l of listings) note(l.label);

    return [...codes]
      // A code with neither a number nor a costed kit is a stray file, not a category — `hello`
      // and `example` are both really in the folders. Nothing is hidden that anyone named.
      .filter((p) => highest.has(p) || (kits.get(p)?.length ?? 0) > 0)
      .sort()
      .map((prefix) => {
        const top = highest.get(prefix);
        // Padded like its neighbours: the files disagree (`GTB-1` and `GTB005` both exist), so the
        // useful suggestion is the one shaped like the highest number already in use.
        const digits = top ? (/\d+$/.exec(top.from)?.[0].length ?? 0) : 0;
        return {
          prefix,
          kits: kits.get(prefix) ?? [],
          latest: top?.from ?? null,
          next: top ? `${prefix}${String(top.n + 1).padStart(digits, "0")}` : null,
          // `listings()` comes back newest first, so the first hit is the most recent one.
          newest: listings.find((l) => skuPrefix(l.label) === prefix)?.label ?? null,
        };
      });
  }, [saved, listings]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Material[]>();
    for (const m of materials) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  /** Both routes land here, so a pasted reply and a saved file can never behave differently. */
  function took(r: Awaited<ReturnType<typeof window.ww.costPasted>>) {
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setError(null);
    /**
     * The same items in the same order means this is the SAME kit re-read — the box below now
     * shows the open kit's own JSON, so an edit in it (a corrected count, a new SKU) is a revision
     * and must not throw away the prices and corrections that were typed against those lines. A
     * different item list is a different kit, and then every one of them has to go: `overrides` and
     * `counts` are keyed by line index and would silently land on the wrong line.
     */
    const same =
      lines !== null &&
      lines.length === r.result.lines.length &&
      lines.every((l, i) => l.item === r.result.lines[i].item);
    if (!same) {
      setOverrides({}); // a new reply is a new kit; the last kit's corrections do not apply
      setMarket({}); // and the last kit's prices are certainly not this one's
      setPrices({});
      setCounts({});
      setChosen({});
      setTyped({});
      setOpenedFile(null); // not the kit that was opened, so keeping must not replace it
    }
    setSku(r.result.sku);
    setLines(r.result.lines.map(({ item, qty, size }) => (size ? { item, qty, size } : { item, qty })));
    // A `pick` in the text IS the correction, so the box wins over whatever was in state — that is
    // what makes editing it a real edit and not a suggestion. A reply straight out of the chat has
    // no picks and this comes back empty, which is the reset the old code did by hand.
    setOverrides(
      Object.fromEntries(
        r.result.lines.flatMap((l, i) => (l.overridden && l.match ? [[i, key(l.match)]] : [])),
      ),
    );
    setKit(r.result);
  }

  /** A dropped file fills the box too, so every route in leaves the SKU editable in one place. */
  const loadReply = async (file: string) => took(await window.ww.costInventory(file, {}));

  /**
   * Pasting reads as you paste — no button. The whole interaction is copy in the chat, click here,
   * Cmd+V, and the table is there; a "Read this" button in between would be one more thing to
   * explain. Empty stays quiet: clearing the box is not an error.
   */
  function pasted(text: string) {
    setPaste(text);
    if (text.trim() === "") {
      setError(null);
      return;
    }
    void window.ww.costPasted(text, {}).then(took);
  }

  function dropped(e: React.DragEvent, kind: "image" | "json") {
    e.preventDefault();
    setOver(null);
    const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
    if (kind === "image") {
      const img = paths.find((p) => /\.(png|jpe?g|webp|avif|gif)$/i.test(p));
      if (img) setImage(img);
      return;
    }
    const json = paths.find((p) => p.toLowerCase().endsWith(".json"));
    if (json) void loadReply(json); // the box refills itself from the kit that lands
  }

  async function save() {
    if (!lines) return;
    const kept: SavedKit = {
      sku, image, lines, overrides,
      prices: Object.fromEntries(
        Object.entries(prices).map(([k, v]) => [k, Math.round(v * 100)]),
      ),
      counts,
      parcel: chosen,
      marginPercent: margin,
      flatPaise: flat * 100,
      marketplaces: Object.fromEntries(
        Object.entries(market).map(([id, v]) => [
          id,
          { pricePaise: v.price === undefined ? undefined : v.price * 100,
            shippingPaise: v.ship === undefined ? undefined : v.ship * 100 },
        ]),
      ),
      savedAt: "",
    };
    const file = await window.ww.saveKit(kept);
    // The filename comes from the SKU, so a renamed kit has just been written beside its old self.
    // Drop the old one: two files, same kit, different names is exactly the mess this avoids.
    const renamed = openedFile !== null && openedFile !== file;
    if (renamed) await window.ww.deleteKit(openedFile);
    setOpenedFile(file);
    const name = file.split(/[\\/]/).pop();
    setNote(
      renamed
        ? `Kept as ${name} — ${openedFile.split(/[\\/]/).pop()} is gone.`
        : `Kept as ${name}.`,
    );
    setTimeout(() => setNote(null), 4000);
    refreshSaved();
  }

  /**
   * Promote a kit's price into the shipped list. Separate from typing the price, because this one
   * reaches every kit ever costed and the other machine on the next release — and it is refused
   * outright in a packaged app, where the list is read-only.
   */
  async function fixList(materialKey: string, paise: number) {
    const r = await window.ww.setMaterialPrice(materialKey, paise);
    if (!r.ok) {
      setPriceNote(r.message);
      return;
    }
    setMaterials(r.result);
    // Drop the per-kit price: the list now says the same thing, and leaving it would show this
    // line as overridden for ever after.
    setPrices((p) => {
      const { [materialKey]: _done, ...rest } = p;
      return rest;
    });
    void window.ww.materialGaps().then(setGaps);
    setPriceNote(`${materialKey.split("|")[1]} is now ${rupees(paise)} in the price list, for every kit.`);
    setTimeout(() => setPriceNote(null), 8000);
  }

  async function exportAll(only: string | null) {
    const file = await window.ww.exportKits(only);
    if (!file) return; // cancelled, or nothing saved yet — neither is an error
    setNote(`Saved to ${file.split(/[\\/]/).pop()}.`);
    setTimeout(() => setNote(null), 6000);
  }

  async function reopen(file: string) {
    const k = await window.ww.openKit(file);
    setSku(k.sku);
    setImage(k.image);
    setOverrides(k.overrides ?? {});
    setMargin(k.marginPercent ?? 50);
    setFlat(Math.round((k.flatPaise ?? 6000) / 100));
    setMarket(
      Object.fromEntries(
        Object.entries(k.marketplaces ?? {}).map(([id, v]) => [
          id,
          { price: v.pricePaise === undefined ? undefined : v.pricePaise / 100,
            ship: v.shippingPaise === undefined ? undefined : v.shippingPaise / 100 },
        ]),
      ),
    );
    setPrices(
      Object.fromEntries(Object.entries(k.prices ?? {}).map(([key, v]) => [key, v / 100])),
    );
    setCounts(k.counts ?? {});
    setChosen(k.parcel ?? {});
    setTyped({});
    setLines(k.lines);
    setOpenedFile(file);
    setError(null);
  }

  const total = kit?.totalPaise ?? 0;

  // ₹20 out on a ₹60 target is a third of the margin — far enough to be worth a second look, and
  // loose enough that ordinary rounding does not fill the heading with warnings.
  const offTarget = saved.filter((k) => (drift(k) ?? 0) > 20 / 60).length;

  // Any axis overruled by hand counts as chosen — the rules apply per axis, so a kit can follow
  // them for its footprint and not for its height.
  const sizeChosen =
    chosen.lengthCm !== undefined || chosen.breadthCm !== undefined || chosen.heightCm !== undefined;
  const customValue = `${chosen.lengthCm}x${chosen.breadthCm}x${chosen.heightCm}`;
  const custom =
    sizeChosen && !(parcel?.boxes ?? []).some(
      (b) => `${b.lengthCm}x${b.breadthCm}x${b.heightCm}` === customValue,
    );

  return (
    <section className="panel">
      <header>
        <h1>{n === 0 ? "Inventory cost" : `${n}. Inventory cost`}</h1>
        <p>
          What a kit costs us, read off the sheet instead of picked from a dropdown twenty times.
          Drop the picture on the left so you can read the table against it — that is the check.
        </p>
      </header>

      <div className="inv-top">
        <div
          className={`drop inv-image ${over === "image" ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver("image");
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => dropped(e, "image")}
        >
          {image ? (
            <img src={fileUrl(image)} alt="the inventory sheet" onDoubleClick={() => setImage(null)} />
          ) : (
            <>
              <strong>Drop the inventory picture here</strong>
              <span className="muted">
                Nothing is read off it by the app — it is here so you can check the table against
                it.
              </span>
              <button
                onClick={() => void window.ww.pick("inventory", "files").then((p) => p[0] && setImage(p[0]))}
              >
                Choose the picture…
              </button>
            </>
          )}
        </div>

        <div className="inv-steps">
          <h3>1 — ask the AI what is on it</h3>
          <div className="picks">
            <CopyButton text={prompt} label="Copy the prompt" disabled={!prompt} />
            <button onClick={() => setEditing(true)}>Open</button>
          </div>
          <p className="muted">
            Attach the same picture in the chat. It comes back with the items{" "}
            <b>in the words the sheet uses</b> — the matching against our{" "}
            <b>{materials.length}</b> price rows happens here, not there, so nothing has to be
            pasted into the prompt and old sheets keep working.
          </p>

          <h3>2 — bring the reply back</h3>
          {/* Pasting first, because that is what actually happens: the reply comes back as a
              ```json code block in the chat, and asking for a downloadable file is a step
              ChatGPT does not always offer. The fence and any words around it are fine. */}
          <textarea
            className="inv-paste"
            placeholder="Paste the reply here — copy the whole JSON block out of the chat, fence and all"
            value={paste}
            spellCheck={false}
            onChange={(e) => pasted(e.target.value)}
            onFocus={() => setBoxFocused(true)}
            onBlur={() => setBoxFocused(false)}
          />
          {/* This box is the kit, not a paste buffer: it fills itself from whatever is loaded and
              follows the table, so the SKU has no second field and a correction has no second
              place to live. */}
          {lines && (
            <p className="muted">
              <b>This box and the table below are the same kit.</b> Correct a material down there
              and its <code>pick</code> appears up here; edit the <code>sku</code> here to renumber
              the kit — the file, the <code>products/&lt;ID&gt;.json</code> the parcel button writes
              and the image folders all follow that one word. <code>item</code> stays as the sheet
              had it, always: that is what you check against the picture. Changing the{" "}
              <b>items</b> makes it a different kit and clears the corrections and prices, because
              those are held against the lines that were there.
            </p>
          )}
          <div
            className={`drop small ${over === "json" ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver("json");
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => dropped(e, "json")}
          >
            <strong>…or drop a saved .json here</strong>
            <div className="picks">
              <button
                onClick={() =>
                  void window.ww.pick("inventory", "files").then((p) => {
                    const json = p.find((f) => f.toLowerCase().endsWith(".json"));
                    if (json) void loadReply(json);
                  })
                }
              >
                Choose the file…
              </button>
            </div>
          </div>

          {/* Folded away by default: this list only grows, and it sits between the two things
              actually used on every visit — dropping a reply in, and reading the table. The count
              of off-target kits stays on the heading so closing it never hides the warning. */}
          {saved.length > 0 && (
            <>
              <h3>
                Kits you have costed{" "}
                <button onClick={() => setShowKits((s) => !s)}>
                  {showKits ? "hide" : `show ${saved.length}`}
                </button>
              </h3>
              {offTarget > 0 && (
                <p className="muted">
                  <b>{offTarget}</b> of {saved.length} {offTarget === 1 ? "is" : "are"} more than
                  ₹20 away from the ₹60 a kit should leave. The lighter a kit reads below, the
                  further out it is.
                </p>
              )}
              {showKits && (
                <>
                  {/* Grouped the same way the ready folder is, so "all the GTBs together" means
                      the same thing on this screen and on disk. */}
                  {groups.map((g) => (
                    <div key={g.prefix} className="inv-group">
                      <div className="inv-group-head">
                        <b>{g.prefix || "no code"}</b>
                        {g.next ? (
                          <span className="muted">
                            next free: <b>{g.next}</b>
                            {g.latest && <> · highest so far {g.latest}</>}
                          </span>
                        ) : (
                          <span className="muted">nothing numbered yet</span>
                        )}
                        {g.newest && (
                          <span className="muted">
                            newest listing: <b>{g.newest}</b>
                          </span>
                        )}
                      </div>
                      <div className="picks inv-saved">
                        {g.kits.map((k) => {
                          const d = drift(k);
                          return (
                            <button
                              key={k.file}
                              style={driftStyle(d)}
                              title={
                                k.left
                                  ? Object.entries(k.left)
                                      .map(([id, v]) => `${id}: leaves ${rupees(v)}`)
                                      .join("  ·  ")
                                  : "No listed price yet, so there is no margin to judge."
                              }
                              onClick={() => void reopen(k.file)}
                            >
                              {k.sku}
                            </button>
                          );
                        })}
                        {g.kits.length === 0 && (
                          <span className="muted">no kit costed under this code yet</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <p className="muted">
                    <b>next free</b> is one past the highest number anything on this machine uses —
                    kits, listings, product files, descriptions and finished images all counted, and
                    a combo like <code>WKU003-GTB001</code> counts for <b>both</b> of its codes. It
                    is a suggestion, not a reservation: nothing is taken until you save something
                    with that number on it. <b>The file it came from is named beside it</b> — if a
                    number looks far too high, that is the file to go and look at, because the
                    answer is only ever as good as what is in the folders.
                  </p>
                  <p className="muted">
                    Shaded by what the kit <b>leaves</b> after materials, delivery and GST, against
                    the ₹60 rule: <b>dark is on target</b>, and the further out it is the lighter it
                    goes. The <b>worse</b> of the two marketplaces decides the colour — they are
                    priced separately and a kit can be healthy on one and losing money on the other,
                    which an average would hide. Hover for both figures. A kit with no listed price
                    yet is left plain: that is not a bad margin, it is no margin.
                  </p>
                  <p className="muted">
                    Reopening re-costs from today's price list — what is stored is the reading and
                    your corrections, never a total, so a kit never shows last month's balloon
                    price. The shading is re-costed the same way, so a price change moves these
                    colours.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {materials.length === 0 && (
        <p className="problems">
          The price list is empty, so nothing can be costed. <code>categories/materials.json</code>{" "}
          ships inside the app — if this says zero on a real install, it did not make it into the
          build.
        </p>
      )}

      {kit && (
        <>
          {kit.uncosted > 0 && (
            <div className="problems">
              <h3>
                {kit.uncosted} line{kit.uncosted === 1 ? "" : "s"} not counted in the total
              </h3>
              <ul>
                {kit.noPrice > 0 && (
                  <li>
                    <b>{kit.noPrice} on the price list with no price filled in.</b> The material
                    exists — its price cell is blank. Somebody fills the cell and the next build
                    costs it.
                  </li>
                )}
                {kit.unmatched > 0 && (
                  <li>
                    <b>{kit.unmatched} match no material at all.</b> Either pick the right one on
                    that row, or it needs adding to the price list.
                  </li>
                )}
              </ul>
              <p className="muted">
                Either way the total below is <b>lower than the real cost</b>, so do not price off
                it until these are settled.
              </p>
            </div>
          )}

          {kit.flagged > 0 && (
            <p className="problems">
              <b>{kit.flagged} line{kit.flagged === 1 ? " was" : "s were"} matched loosely</b> and
              are marked <em>check</em> below. They are priced, but the name on the sheet fitted
              more than one row — read those against the picture before trusting the total.
            </p>
          )}

          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Item, as the sheet has it</th>
                <th>Count</th>
                <th>Priced as</th>
                <th>Each</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {kit.lines.map((l, i) => (
                <tr key={i} className={l.paise === null ? "warn" : ""}>
                  <td>
                    {l.item}
                    {l.size && <span className="muted"> · {l.size}</span>}
                  </td>
                  {/* Editable. The AI counts what the SHEET shows, which is not always what gets
                      bought — and where it simply miscounted, this is the fix that needs no data
                      about the material at all. */}
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={counts[i] ?? l.qty}
                      onChange={(e) =>
                        setCounts((c) =>
                          e.target.value === ""
                            ? (({ [i]: _drop, ...rest }) => rest)(c)
                            : { ...c, [i]: Number(e.target.value) },
                        )
                      }
                    />
                    {/* The pack maths, spelled out. This line is where a 25 rupee kit became 400,
                        so the arithmetic is on screen rather than behind the number. */}
                    {l.match?.piecesPerPack && (
                      <span className="muted each-was">
                        {l.packs} × pack of {l.match.piecesPerPack}
                      </span>
                    )}
                  </td>
                  <td>
                    {/* Every row is correctable, including one that matched confidently — the
                        picture is the authority, and a name can be right and still be the wrong
                        material. The near misses are in the list too, so an unmatched line is one
                        click from fixed rather than a hunt through 121 rows. */}
                    <MaterialPicker
                      id={`mat-${i}`}
                      name={l.match ? l.match.material : ""}
                      flagged={l.flagged}
                      choices={l.overridden ? [] : l.choices}
                      byCategory={byCategory}
                      onPick={(k) => setOverrides((o) => ({ ...o, [i]: k }))}
                    />
                    {l.flagged && <span className="warnpill">check</span>}
                    {l.match && l.paise === null && <span className="warnpill">no price set</span>}
                  </td>
                  {/* Editable, and the two scopes are kept apart on purpose. Typing here changes
                      THIS kit — a batch that cost more, or a material the list has no price for.
                      "Fix the list" is a second, explicit click, because that one reaches every
                      kit ever costed and the other machine on the next release. */}
                  <td>
                    {l.match ? (
                      <>
                        {/* Typed straight into local state and read back from local state, NOT
                            from the engine's answer. Round-tripping every keystroke through IPC
                            made the box blank and unresponsive the moment the engine did not
                            return what was expected — `undefined / 100` is NaN, and React draws
                            `value={NaN}` as an empty field, so a stale main process looked exactly
                            like a broken control. `??` rather than `=== null` for the same reason:
                            an absent number must fall back, never become NaN. */}
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={prices[key(l.match)] ?? (l.match.paise ?? l.each ?? 0) / 100}
                          onChange={(e) =>
                            setPrices((p) => {
                              const k = key(l.match!);
                              if (e.target.value === "") {
                                const { [k]: _drop, ...rest } = p;
                                return rest;
                              }
                              return { ...p, [k]: Number(e.target.value) };
                            })
                          }
                        />
                        {/* What the LIST says, always visible beside the box — the whole point of
                            the column is knowing what a material is priced at, and an input on its
                            own hides that the moment you type in it. */}
                        <span className="muted each-was">
                          {l.match.paise === null
                            ? "no price in the list"
                            : `list: ${rupees(l.match.paise)}`}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                    {l.match && prices[key(l.match)] !== undefined && (
                      <button
                        className="tiny"
                        title="Write this price into the price list, for every kit"
                        onClick={() => void fixList(key(l.match!), Math.round(prices[key(l.match!)] * 100))}
                      >
                        fix the list
                      </button>
                    )}
                  </td>
                  <td>{l.paise === null ? "—" : rupees(l.paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <b>Cost of materials</b>
                  {kit.uncosted > 0 && (
                    <span className="muted"> · {kit.uncosted} line(s) not counted</span>
                  )}
                </td>
                <td>
                  <b>{rupees(total)}</b>
                </td>
              </tr>
            </tfoot>
          </table>

          {priceNote && <p className="problems">{priceNote}</p>}
          <p className="muted">
            <b>The Each column is editable.</b> Typing in it changes <b>this kit only</b> — a batch
            that cost more, or a material the list has no price for. If the <i>list itself</i> is
            wrong, press <b>fix the list</b> beside it: that reaches every kit ever costed, and the
            other machine on the next update.
          </p>

          <h3>What to sell it at</h3>
          {/* Both methods, both answers, no toggle. They disagree by more the bigger the kit
              gets — a flat +₹60 is 100% on a ₹60 kit and 20% on a ₹300 one — and which one is
              right is a judgement nobody can make without seeing the two numbers together. A
              mode switch would hide exactly that. */}
          <div className="inv-prices">
            <div className="inv-method">
              <label className="inline">
                Margin
                <input
                  type="number"
                  min={0}
                  max={95}
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                />
                %
              </label>
              <span className="inv-price">{rupees(priceAt(total, margin))}</span>
              <span className="muted">
                keeps {margin}% of the price as margin, so it scales with the kit
              </span>
            </div>
            <div className="inv-method">
              <label className="inline">
                Add ₹
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={flat}
                  onChange={(e) => setFlat(Number(e.target.value))}
                />
              </label>
              <span className="inv-price">{rupees(total + flat * 100)}</span>
              <span className="muted">
                cost + ₹{flat} flat — the partner's rule. That is{" "}
                {total > 0 ? Math.round(((flat * 100) / (total + flat * 100)) * 100) : 0}% of this
                price
              </span>
            </div>
          </div>
          <p className="muted">
            <b>Both are floors, not listing prices.</b> Each is worked out from the cost of
            materials and nothing else — neither knows the marketplace commission, the shipping
            fee, GST or packaging. The real formula goes in here once the sheet that computes it
            has been sent.
          </p>

          {/* Delivery is typed in, not computed, and it has to be: Meesho sets its fee from the
              main image by a rule fourteen tests failed to pin down (SHIPPING-COST.md), and the
              two marketplaces are rarely listed at the same price. The column that earns its
              place is the LAST one — what is actually left — because a kit can look healthy on
              margin and be losing money once delivery is counted. */}
          <h3>Delivery, per marketplace</h3>
          <p className="muted">
            Read the fee off each listing and type it here. The point is the last column: what a
            sale actually leaves you, which is what decides where the ad spend goes.
          </p>
          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Where</th>
                <th>Listed at ₹</th>
                <th>Delivery ₹</th>
                <th>Delivery is</th>
                <th>GST</th>
                <th>Left after materials, delivery and GST</th>
              </tr>
            </thead>
            <tbody>
              {MARKETPLACES.map(({ id, label }) => {
                const m = market[id] ?? {};
                const price = (m.price ?? 0) * 100;
                const ship = (m.ship ?? 0) * 100;
                // Vansh's formula: the listing price less delivery is what is taxed. Indian
                // marketplace prices are GST-INCLUSIVE, so the tax is extracted from that figure
                // (base x rate / (100 + rate)) rather than added on top of it — adding it on
                // would invent money the buyer never paid.
                const taxable = Math.max(price - ship, 0);
                const tax = Math.round((taxable * gst) / (100 + gst));
                const left = price - total - ship - tax;
                const shipShare = price > 0 ? Math.round((ship / price) * 100) : null;
                const leftShare = price > 0 ? Math.round((left / price) * 100) : null;
                return (
                  <tr key={id}>
                    <td>{label}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={m.price ?? ""}
                        onChange={(e) => setOne(id, "price", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={m.ship ?? ""}
                        onChange={(e) => setOne(id, "ship", e.target.value)}
                      />
                    </td>
                    <td>{shipShare === null ? "—" : `${shipShare}% of the price`}</td>
                    <td>{price === 0 ? "—" : rupees(tax)}</td>
                    <td className={price > 0 && left <= 0 ? "warnpill" : ""}>
                      {price === 0 ? "—" : `${rupees(left)}  ·  ${leftShare}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="picks">
            <label className="inline">
              GST
              <input
                type="number"
                min={0}
                max={50}
                value={gst}
                onChange={(e) => setGst(Number(e.target.value))}
              />
              %
            </label>
            <span className="muted">
              Taken out of <b>(listed price − delivery)</b>, treating the listed price as already
              including it, which is how a marketplace price works. 5% matches the{" "}
              <code>GST_5</code> tax code on the listings.
            </span>
          </div>
          <p className="muted">
            <b>"Left" is still not profit.</b> Materials, delivery and GST are out of it — the
            marketplace commission, its own 18% GST on that commission, packaging and ad spend are
            not. Use it to rank kits against each other rather than to bank a figure.
          </p>


          {/* Directly under everything that is TYPED IN — the prices, the delivery, the GST rate.
              It used to sit at the very bottom, below the parcel, which reads as further away
              from the fields it saves than it is; the parcel is computed and takes no input, so
              nothing below this point is ever lost by not pressing it. */}
          <div className="inv-save">
            <button className="primary" onClick={() => void save()}>
              {sku ? `Keep ${sku}` : "Keep this kit"}
            </button>
            <button onClick={() => void exportAll(null)}>Save every kit as a spreadsheet</button>
            <button onClick={() => void window.ww.openKitsFolder()}>Open the saved kits folder</button>
            <span className="muted">
              Keeping stores the {kit.lines.length} lines as read, any material you corrected, both
              pricing rules, and the prices, delivery and GST above. Not the total — that is worked
              out again from today&apos;s price list every time you open it, so a price change reaches
              every kit you have ever saved. The name is the <code>sku</code> in the box at the top:
              change it there and keeping <b>renames</b> this kit rather than making a second copy
              of it.
            </span>
            {note && <span className="allgood">{note}</span>}
          </div>

          {parcel && (
            <>
              <h3>The parcel</h3>
              <p className="muted">
                {parcel.parcel.overridden ? (
                  <b>Chosen by hand for this kit.</b>
                ) : (
                  <>
                    Worked out from what is in the kit, not typed per listing.
                    {parcel.parcel.applied.length > 0 ? (
                      <>
                        {" "}
                        This one is bigger than the standard box because it contains a{" "}
                        <b>{parcel.parcel.applied.join(" and a ")}</b>.
                      </>
                    ) : (
                      " Nothing in it needs a bigger box than the standard one."
                    )}
                  </>
                )}
              </p>

              {/* The rules get the common cases right and a human gets the rest right, so both
                  exist and the rule is the default. Only what is actually picked is stored, so a
                  kit whose weight was corrected still follows the rules for its size — and picks
                  up a corrected rule on the next release instead of being frozen at today's. */}
              <div className="picks parcel-pick">
                <label className="inline">
                  Box
                  <select value={sizeChosen ? customValue : ""}
                    onChange={(e) => {
                      setTyped({});
                      if (e.target.value === "") {
                        setChosen(({ lengthCm: _l, breadthCm: _b, heightCm: _h, ...rest }) => rest);
                        return;
                      }
                      const [lengthCm, breadthCm, heightCm] = e.target.value.split("x").map(Number);
                      setChosen((c) => ({ ...c, lengthCm, breadthCm, heightCm }));
                    }}
                  >
                    {/* Inches on screen, centimetres in the value — the option's value is still
                        the cm triple the engine and the saved kit have always used, so changing
                        the unit shown here cannot change a stored or declared number. */}
                    <option value="">
                      whatever the kit needs —{" "}
                      {inchSize(
                        parcel.parcel.lengthCm,
                        parcel.parcel.breadthCm,
                        parcel.parcel.heightCm,
                      )}
                    </option>
                    {parcel.boxes.map((b) => (
                      <option
                        key={b.label}
                        value={`${b.lengthCm}x${b.breadthCm}x${b.heightCm}`}
                      >
                        {b.label}
                      </option>
                    ))}
                    {/* A size typed by hand is no bag on the list, so without this the picker
                        would fall back to showing "whatever the kit needs" — claiming the rules
                        chose a size a human overruled. */}
                    {custom && <option value={customValue}>typed by hand</option>}
                  </select>
                </label>

                {/* Typed, not just picked. Vansh: "sometimes we take a 25 cm envelope but the
                    stuff we put into it is 22 max, we fold that margin on the length" — the bag
                    is off the shelf and the parcel is not, and what gets declared has to be the
                    parcel. Inches, because that is the unit this panel now speaks; the cm it
                    becomes are printed under the size above. */}
                {(["l", "b", "h"] as const).map((axis) => {
                  const cm = { l: "lengthCm", b: "breadthCm", h: "heightCm" } as const;
                  const label = { l: "Length", b: "Breadth", h: "Height" }[axis];
                  return (
                    <label className="inline" key={axis}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={typed[axis] ?? inches(parcel.parcel[cm[axis]])}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setTyped((t) => ({ ...t, [axis]: raw }));
                          setChosen((c) =>
                            raw === ""
                              ? (({ [cm[axis]]: _drop, ...rest }) => rest)(c)
                              : { ...c, [cm[axis]]: Math.round(Number(raw) * 2.54 * 10) / 10 },
                          );
                        }}
                      />
                      in
                    </label>
                  );
                })}
                <label className="inline">
                  Weight
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={chosen.grams ?? parcel.parcel.grams}
                    onChange={(e) =>
                      setChosen((c) =>
                        e.target.value === ""
                          ? (({ grams: _g, ...rest }) => rest)(c)
                          : { ...c, grams: Number(e.target.value) },
                      )
                    }
                  />
                  g
                </label>
                {(chosen.grams !== undefined || sizeChosen) && (
                  <button
                    onClick={() => {
                      setChosen({});
                      setTyped({});
                    }}
                  >
                    Back to what the kit needs
                  </button>
                )}
              </div>

              <div className="inv-parcel">
                {/* Inches read first because that is how the bags are bought, but the cm stay
                    on screen underneath: they are what goes into Flipkart's Package Details
                    block by hand, and a number you cannot see is a number you cannot check. */}
                <div>
                  <span className="muted">Size</span>
                  <b>
                    {inchSize(
                      parcel.parcel.lengthCm,
                      parcel.parcel.breadthCm,
                      parcel.parcel.heightCm,
                    )}
                  </b>
                  <span className="muted each-was">
                    {parcel.parcel.lengthCm} × {parcel.parcel.breadthCm} ×{" "}
                    {parcel.parcel.heightCm} cm
                  </span>
                </div>
                <div>
                  <span className="muted">Real weight</span>
                  <b>{parcel.parcel.grams} g</b>
                </div>
                <div>
                  <span className="muted">Volumetric (from the cm ÷ 5000)</span>
                  <b>{parcel.parcel.volumetricGrams} g</b>
                </div>
                <div>
                  <span className="muted">Billed on</span>
                  <b className={parcel.parcel.billedGrams > parcel.parcel.grams ? "warnpill" : ""}>
                    {parcel.parcel.billedGrams} g
                  </b>
                </div>
              </div>

              {parcel.parcel.warnings.length > 0 && (
                <div className="problems">
                  <ul>
                    {parcel.parcel.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Two tabs, two unit systems, and the app deliberately fills only one of them.
                  `Height` and `Weight` exist on BOTH, and loadProduct() merges every defaults
                  file into one flat map keyed by label — so one value would be typed as
                  centimetres here and inches there. Package Details is therefore yours to type,
                  with the numbers ready to copy; the bot fills the inch block, where nothing
                  can collide. */}
              <div className="two">
                <div className="card">
                  <b>Price, Stock &amp; Shipping → Package Details</b>
                  <span className="muted">
                    Type these four yourself. The app does not fill this block — the same{" "}
                    <em>Height</em> and <em>Weight</em> labels exist on the other tab in inches,
                    and it cannot yet tell them apart.
                  </span>
                  <ul className="kv">
                    {Object.entries(parcel.packageDetails).map(([k, v]) => (
                      <li key={k}>
                        <b>{k}</b>
                        <span>
                          {v} {k === "Weight" ? "KG" : "CM"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <CopyButton
                    label="Copy all four"
                    text={Object.entries(parcel.packageDetails)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n")}
                  />
                </div>
                {/* This card used to say "the bot fills these — nothing to do here", which was
                    not true. The bot fills `products/<ID>.json`, and those four values were
                    whatever the AI had guessed from a photo; the parcel below was computed from
                    what is actually in the kit and reached the form nowhere. Two sources for one
                    fact, and the guess was winning. The button is the join. */}
                <div className="card">
                  <b>Additional Description → Dimensions</b>
                  <span className="muted">
                    In inches, and the bot types these — <b>once you have put them on the
                    listing</b>. Until then the listing carries whatever the AI guessed, which is
                    not this.
                  </span>
                  <ul className="kv">
                    {Object.entries(parcel.dimensions).map(([k, v]) => (
                      <li key={k}>
                        <b>{k}</b>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="picks">
                    <button
                      className="primary"
                      disabled={!sku}
                      onClick={() =>
                        void window.ww.applyParcel(sku, { ...parcel.dimensions, packageDetails: parcel.packageDetails }).then((r) => {
                          setSent(
                            !r.ok
                              ? r.message
                              : r.result.changed.length === 0
                                ? `${sku} already carries this parcel — nothing to change.`
                                : `Written into ${r.result.file.split(/[\\/]/).pop()}: ${r.result.changed
                                    .map((c) => `${c.key} ${c.from ?? "—"} → ${c.to}`)
                                    .join(", ")}.`,
                          );
                          setTimeout(() => setSent(null), 12000);
                        })
                      }
                    >
                      Put these on the {sku || "listing"}
                    </button>
                    <span className="muted">
                      Overwrites the four values in <code>products/{sku || "&lt;ID&gt;"}.json</code>,
                      and says what it changed them from. The parcel is measured; what is in the
                      file was not.
                    </span>
                  </div>
                  {sent && <p className="muted">{sent}</p>}
                </div>
              </div>
            </>
          )}

        </>
      )}

      {gaps && (gaps.noPrice.length > 0 || gaps.noSize.length > 0) && (
        <div className="inv-gaps">
          <h3>
            What the price list still needs{" "}
            <button onClick={() => setShowGaps((s) => !s)}>{showGaps ? "hide" : "show"}</button>
          </h3>
          <p className="muted">
            <b>{gaps.noPrice.length}</b> of {gaps.total} materials have no price yet, and{" "}
            <b>{gaps.noSize.length}</b> have no size. Any kit containing one of the priceless ones
            costs less than it really does, and says so.
          </p>
          {showGaps && (
            <ul className="kv">
              {gaps.noPrice.map((m) => (
                <li key={key(m)}>
                  <b>{m.category}</b>
                  <span>{m.material}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <PromptEditor file="PROMPT-inventory.md" close={() => setEditing(false)} />}
    </section>
  );
}

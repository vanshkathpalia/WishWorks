/**
 * latch-core.ts — read a Flipkart label PDF into the list of products to latch.
 *
 * A latch is listing against a catalog entry somebody else already created: you search Flipkart's
 * catalog for the product, click through to it, and your own SKU + price becomes another offer on
 * it. The label pack is where the work list comes from — every parcel's label carries the SKU ID
 * and the catalog title it was sold under, so a day's labels name exactly the products that can be
 * latched, without a CSV export nobody can produce for another seller's listings.
 *
 * **Why `pdftotext` and not the zlib reader in orders-core.ts.** The Meesho manifest draws every
 * cell as `x y Td (text)Tj` in plain single-byte strings, which is why thirty lines read it. A
 * Flipkart label is Qt-generated with SUBSETTED CID FONTS: the text arrives as `<0001> Tj` glyph
 * ids, one per call, and turning those back into letters means resolving each page's font
 * resources and parsing its ToUnicode CMap — a real PDF parser, not thirty lines. See
 * docs/learning/11.
 *
 * ponytail: shells out to poppler's pdftotext, so this is Mac/Linux (brew install poppler) and not
 * the Windows app. Latching is Vansh's own job on his own machine; if it ever has to ship in the
 * .exe, that is when the CID/ToUnicode reader gets written.
 */

import type { Page } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORIES_DIR, ROOT } from "./paths.js";
import { normalize, tokens } from "./inventory-core.js";

export interface LatchItem {
  /** The seller SKU printed on the label — `FKUL017`. Ours, not the catalog's. */
  sku: string;
  /**
   * The catalog title as the label printed it — `ZYRIC Printed Happy Birthday Emoji Balloons
   * Decoration`. **Usually TRUNCATED**: the label has a fixed height and cuts the title off. That
   * is fine for searching, which is all it is for, and is why it is never written to a listing.
   */
  description: string;
  /** How many labels in the pack carried this SKU — how well it sells, roughly. */
  labels: number;
}

/** The label's `1 FKUL017 | Fundots Printed Transparent Balloons with Gold      1` line. */
const SKU_LINE = /^\s*\d+\s+(\S+)\s*\|\s*(.+)$/;

function pdfText(file: string): string {
  try {
    // -layout keeps the columns, which is what makes the SKU line one line.
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 64e6 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "pdftotext is not installed — it is what reads the label PDF.\n" +
          "  Install it with:  brew install poppler",
      );
    }
    throw e;
  }
}

/**
 * Every distinct product in these label PDFs, most-shipped first.
 *
 * Deduplicated by SKU: a pack of 86 labels is 22 products, and opening a tab per label would be
 * 64 tabs of work already done. The longest description wins when labels disagree, because the
 * only reason they differ is where the label cut the title off, and more title searches better.
 */
export function readLabels(files: string[]): LatchItem[] {
  return parseLabelText(files.map(pdfText).join("\n"));
}

/**
 * The same thing, from label text already extracted — where all the parsing actually lives.
 *
 * Split out from `readLabels` so the test can exercise it without a PDF. That is not only
 * convenience: a real label pack is 86 customers' names and addresses, and it is not going in the
 * repo the way `tests/fixtures/meesho-manifest.pdf` did.
 */
export function parseLabelText(text: string): LatchItem[] {
  const found = new Map<string, LatchItem>();

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = SKU_LINE.exec(lines[i]);
    // The header line above the row matches nothing (`SKU ID | Description`) because it has no
    // leading number, which is also what keeps every address line out.
    if (!m) continue;
    // The QTY column is at the end of THIS line, not of the finished title — a title that wraps
    // puts it in the MIDDLE ("Decoration Kit - Pastel 1 Balloons, Cutouts"). Dropped rather than
    // captured: nothing here needs it, and a title whose last word is a number would make
    // capturing it a guess.
    const parts = [m[2].replace(/\s+\d+\s*$/, "")];
    // The title wraps onto the following indented lines and stops at the first blank one.
    while (++i < lines.length && lines[i].trim() !== "") parts.push(lines[i]);

    const description = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!description) continue;

    const prev = found.get(m[1]);
    if (!prev) found.set(m[1], { sku: m[1], description, labels: 1 });
    else {
      prev.labels++;
      if (description.length > prev.description.length) prev.description = description;
    }
  }

  return [...found.values()].sort((a, b) => b.labels - a.labels || a.sku.localeCompare(b.sku));
}

// ---------------------------------------------------------------- finding the product

/**
 * The URL the Seller Lens extension's **Latch on** button opens, and the reason this tool needs no
 * extension at all.
 *
 * Read straight out of `flipkart.70f98deb.js` in Seller Lens 0.0.74. The button's entire handler is
 * one line — `chrome.runtime.sendMessage({ action: "openNewTab", url: getStartSellingURL(fsn) })` —
 * against `START_SELLING: ${SELLER_DASHBOARD_URL}index.html#dashboard/listings/product/na?fsn=FSN_ID
 * &sourceid=SELECTION_INSIGHTS_UI`. So the panel, its shadow DOM and its side panel are scenery:
 * the latch is a link, and the FSN is the `pid=` already in every flipkart.com product URL.
 *
 * The page it opens is also what decides *start selling* vs *request approval* — that is Flipkart's
 * call on the brand, made server-side, and nothing here tries to predict it.
 */
export const startSellingUrl = (fsn: string): string =>
  `https://seller.flipkart.com/index.html#dashboard/listings/product/na?fsn=${encodeURIComponent(fsn)}&sourceid=SELECTION_INSIGHTS_UI`;

/** The consumer site's search, which is where the FSN has to be found. No login needed. */
export const searchUrl = (q: string): string =>
  `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`;

/** One search result, as scraped off the results page. */
export interface Result {
  fsn: string;
  title: string;
  /**
   * The product page's real URL, slug and all.
   *
   * Kept because **`flipkart.com/p/p?pid=<FSN>` does not work** — it answers 500. The FSN opens
   * the seller-side latch form and nothing else, so the only way back to the pictures is the href
   * the search result already gave us.
   */
  url: string;
  /** What this seller charges today, off the same card. Null when the card showed no price. */
  listed?: Listed | null;
}

export interface Pick {
  /** The one result certain enough to open, or null — never a guess. */
  hit: Result | null;
  /** Why there is no hit: nothing matched, or more than one did and they cannot be told apart. */
  why: "found" | "none" | "ambiguous";
  /** The best few, always, so a human can choose when we would not. */
  near: (Result & { score: number })[];
}

/** Share of the label's words the title also has. 1.0 means the title contains all of them. */
function overlap(label: string, title: string): number {
  const want = new Set(tokens(label));
  if (!want.size) return 0;
  const has = new Set(tokens(title));
  let hit = 0;
  for (const t of want) if (has.has(t)) hit++;
  return hit / want.size;
}

/**
 * Which search result is the product on the label — or an honest refusal.
 *
 * **The test is PREFIX, not best score.** A label truncates the catalog title to fit the box, so
 * the real title *begins with* what the label printed, and any listing whose title starts with it
 * is the same product. Measured against a real pack: that rule picks the right listing every time
 * it fires, while "highest score wins" would have latched a ZYRIC kit onto a Magic Balloons one and
 * `Partyfox Birthday Decoration Items For Girls Pink` onto an Inispire2Fashion arch — both scored
 * 0.83 and neither was the product.
 *
 * **Two prefix matches is a refusal, not a coin toss.** `ZYRIC Solid Happy birthday black and gold`
 * is the start of both that seller's *decoration kit* and their *balloons set*, and the label cut
 * off exactly the word that told them apart. Latching the wrong one is a listing to delete later,
 * so those go to the by-hand list with both candidates shown.
 */
export function pickProduct(description: string, results: Result[]): Pick {
  const want = normalize(description);
  const prefix = results.filter((r) => normalize(r.title).startsWith(want));
  const near = results
    .map((r) => ({ ...r, score: overlap(description, r.title) }))
    .sort((a, b) => b.score - a.score || a.title.length - b.title.length)
    .slice(0, 3);

  if (prefix.length === 1) return { hit: prefix[0], why: "found", near };
  if (prefix.length > 1) {
    return { hit: null, why: "ambiguous", near: prefix.map((r) => ({ ...r, score: 1 })).slice(0, 4) };
  }
  return { hit: null, why: "none", near };
}

/**
 * Search terms to try, in order, stopping at the first that finds the product.
 *
 * The second one exists because the label cuts the title mid-word as often as between words, and a
 * half-word ("Balloo") is a term that matches nothing. Dropping it is one more search on the
 * products that would otherwise have gone to the by-hand list.
 */
export function searchTerms(description: string): string[] {
  const words = description.split(" ");
  const shorter = words.slice(0, -1).join(" ");
  return words.length > 3 ? [description, shorter] : [description];
}

// ---------------------------------------------------------------- filling the form

/**
 * A form label reduced to something two sources can agree on.
 *
 * The defaults file says `HSN`, the live form says `HSN*`; it says `Fullfilment by` and so does
 * Flipkart, typo and all. Stripping everything but letters and digits makes the required-asterisk
 * and the spacing stop mattering, and nothing else does.
 */
export const labelKey = (label: string): string => normalize(label.replace(/\*/g, " "));

/**
 * What to type into the latch form, keyed by label.
 *
 * **The values are NOT written here.** They come from `categories/balloon-decoration.pricing.
 * defaults.json`, which is the same file the 66-field fill bot reads and the one that carries
 * their provenance — Tax Code GST_5 confirmed off the live form, Procurement SLA 2 on Vansh's
 * instruction, PartyDreams as manufacturer and packer rather than WishWorks. A second copy in this
 * file would go stale the first time one of them changed, and a stale HSN is a tax problem rather
 * than a bug.
 *
 * `_`-prefixed keys are that file's own commentary, never fields.
 */
export function latchValues(
  overrides: Record<string, string> = {},
  dir = CATEGORIES_DIR,
): Map<string, string> {
  const raw = JSON.parse(readFileSync(path.join(dir, "balloon-decoration.pricing.defaults.json"), "utf8"));
  const out = new Map<string, string>();
  for (const [label, value] of Object.entries(raw)) {
    if (label.startsWith("_") || typeof value !== "string") continue;
    out.set(labelKey(label), value);
  }
  for (const [label, value] of Object.entries(overrides)) out.set(labelKey(label), value);
  return out;
}

/**
 * The one dropdown option that means `want`, or null.
 *
 * Case-insensitive because the defaults file says `Express` and Flipkart's option is `express` —
 * an exact match silently leaves Procurement type unset, which is a field the form requires and a
 * failure that looks like the bot simply skipped it.
 */
export function matchOption(want: string, options: string[]): string | null {
  return options.find((o) => normalize(o) === normalize(want)) ?? null;
}

// ---------------------------------------------------------------- driving the form

/** What a latch tab ended up showing. Four real outcomes, all measured against the live account. */
export type TabState = "form" | "selling" | "approval" | "stuck";

/**
 * Flipkart's answer for this product, read off the catalog card's one action link.
 *
 * All three states use the SAME class, `startSelling`, and differ only in what is beside it — so
 * the text is the thing a human reads and the class is the thing to match:
 *
 *   `startSelling listingsModalLink`   START SELLING       → latchable, click it
 *   `disabled startSelling`            ALREADY SELLING     → this account already has this product
 *   `applyForApprovalLink startSelling` APPLY FOR APPROVAL → not approved for that vertical
 *
 * The first version clicked `a.startSelling` and waited for the form, so **already-selling and
 * not-approved both came back as "could not open the form"** — three products reported as a bug in
 * this tool when Flipkart had answered all three clearly. Half of a label pack is products the
 * account already sells; telling Vansh that IS the useful output, not an error to work around.
 */
export function cardState(className: string): TabState {
  if (/\bdisabled\b/.test(className)) return "selling";
  if (/applyForApprovalLink/.test(className)) return "approval";
  if (/listingsModalLink/.test(className)) return "form";
  return "stuck";
}

/**
 * Get a latch tab from the catalog card to a filled-in form, and say where it ended up.
 *
 * Matched on `a.startSelling`, the link's own class, and NOT on its text as well. A union selector
 * (`a.startSelling, a:has-text('START SELLING')`) is what broke the first live run: `:has-text`
 * matches ancestors too, so `.first()` picked a wrapper higher up the page and every click timed
 * out against an element that was never the button.
 */
export async function openLatchForm(tab: Page, values: Map<string, string>): Promise<TabState> {
  try {
    await tab.waitForSelector("a.startSelling", { timeout: 30_000 });
    const state = cardState((await tab.locator("a.startSelling").first().getAttribute("class")) ?? "");
    if (state !== "form") return state;

    await tab.locator("a.startSelling.listingsModalLink").first().click({ timeout: 20_000 });
    // The form is a modal: the URL never changes, so `sku_id` appearing is the only honest signal.
    await tab.waitForSelector("input[name=sku_id]", { timeout: 25_000 });
    await fillLatchForm(tab, values);
    // Leave the cursor where the one hand-typed value goes. Focus is per tab, so it survives
    // switching between them.
    await tab.locator("input[name=sku_id]").focus().catch(() => {});
    return "form";
  } catch {
    return "stuck";
  }
}

export async function fillLatchForm(tab: Page, values: Map<string, string>): Promise<number> {
  const controls = await tab.evaluate(() =>
    [...document.querySelectorAll("input:not([type=hidden]):not([type=radio]),textarea,select")]
      .map((e) => {
        const el = e as HTMLInputElement | HTMLSelectElement;
        return {
          name: el.name,
          tag: el.tagName,
          label: (el.closest("div")?.parentElement?.querySelector("label")?.textContent ?? "").trim(),
          options: el.tagName === "SELECT" ? [...(el as HTMLSelectElement).options].map((o) => o.text) : [],
        };
      })
      .filter((c) => c.name && c.label),
  );

  let filled = 0;
  for (const c of controls) {
    if (c.name === "sku_id") continue;
    const want = values.get(labelKey(c.label));
    if (want === undefined) continue;
    const el = tab.locator(`[name="${c.name}"]`).first();
    try {
      if (c.tag === "SELECT") {
        const option = matchOption(want, c.options);
        if (!option) continue;
        await el.selectOption({ label: option }, { timeout: 10_000 });
      } else {
        await el.fill(want, { timeout: 10_000 });
      }
      filled++;
    } catch {
      // One field refusing is not worth losing the other twenty — the tab stays open and every
      // value is in front of a human either way.
    }
  }
  return filled;
}



// ---------------------------------------------------------------- the work list, kept on disk

/**
 * Where the latch record lives — beside the orders, on the synced drive, not in settings.
 *
 * Resolved on every call rather than once at import, so an override set by a test or by the app
 * is honoured whenever it arrives. A module-level const bakes in whatever the environment held the
 * instant this file was first imported, which is a load-order trap nothing on screen would reveal.
 *
 * It is a record of what was done in the real world on a date, which is the same argument that put
 * the packing ledger and the packers' rates there. It also has to outlive this machine: the whole
 * point of keeping it is that next month's label pack can be told apart from this one's.
 */
export const latchDir = (): string => process.env.WW_LATCH_DIR ?? path.join(ROOT, "latch");
const LATCH_FILE = () => path.join(latchDir(), "latches.json");

/** One product off a label pack, and everything we have since learnt about it. */
export interface LatchRecord {
  /** The SKU the OTHER seller printed on their label. The identity of the row, and never ours. */
  sku: string;
  /** Their catalog title, truncated by the label. What the search is run on. */
  description: string;
  /** How many labels across every pack carried it — a rough bestseller rank. */
  seen: number;
  /** Flipkart's product id, once the search has found it. */
  fsn: string | null;
  /** The real, untruncated catalog title. Proof the right product was found. */
  title: string | null;
  /** The product page, for its pictures. The FSN alone cannot reach it — see `Result.url`. */
  url?: string | null;
  /**
   * What the seller we would latch onto charges.
   *
   * Kept because our own price is worth deciding against it, and nothing else on this record would
   * show it. **It is a flag, not a rule.** Coming in dearer than the seller already on a listing is
   * a thing to notice, not a reason to skip one: the same catalog page is won on ratings, delivery
   * promise and who holds the buy box too. Nothing in this tool rejects a product on price.
   */
  listed?: Listed | null;
  /**
   * Where this product stands, as Flipkart last answered it. `unknown` means never checked;
   * `ambiguous` and `none` are our own refusals, not Flipkart's answers.
   */
  state: TabState | "unknown" | "ambiguous" | "none";
  /** When Flipkart was last asked. A state with no date behind it is a guess. */
  checkedOn: string | null;
  /** Set the day we opened a latch form for it, so a re-check that fails does not lose the fact. */
  latchedOn?: string;
  /**
   * OUR SKU for this product — the one field of the latch form a person fills in.
   *
   * **This is the join to the costing**, and the only one available: a latch row is named by the
   * other seller's SKU or by an FSN, while a costed kit is named by ours, so without this nothing
   * can say "the thing we latched on Tuesday still has no confirmed price". Nobody is asked to
   * type it twice — `readOurSkus` lifts it out of the tab it was already typed into.
   */
  ourSku?: string;
  /** The candidates, when we refused to choose. Shown so a human can. */
  near?: (Result & { score: number })[];
}

/** `YYYY-MM-DD` in local time — the same day-stamp the packing ledger uses. */
export const todayStamp = (): string => new Date().toLocaleDateString("en-CA");

/** One label pack that was read in, and what was in it. */
export interface LabelPack {
  /** The PDF's filename as dropped. The identity of a pack — re-reading one replaces its entry. */
  file: string;
  /** The day it was read. What the screen sorts on, so the newest pack is the one on top. */
  addedOn: string;
  /** The other seller's SKUs found in it — the join back to the rows. */
  skus: string[];
}

/**
 * Everything the latch screen knows: the packs that were read, and the products they named.
 *
 * **Packs are kept separately from products** because a product is not a pack's property — the
 * same SKU appears in pack after pack, and what we have learnt about it (its FSN, that we already
 * sell it, the day we latched it) belongs to the product and must survive every later pack. The
 * pack is a list of names and a date: enough to ask "what came in on the 9th" without duplicating
 * a single thing that is true of the product itself.
 */
export interface LatchBook {
  packs: LabelPack[];
  rows: LatchRecord[];
}

export async function readLatches(): Promise<LatchBook> {
  const text = await readFile(LATCH_FILE(), "utf8").catch(() => null);
  if (text === null) return { packs: [], rows: [] };
  const parsed = JSON.parse(text) as LatchBook | LatchRecord[];
  // The first version of this file was a bare array of products, written before packs existed.
  // Read it rather than discarding it: it is a real day's work, and the packs it came from are
  // simply unknown — which the screen shows as "before this was recorded", not as an empty list.
  return Array.isArray(parsed) ? { packs: [], rows: parsed } : parsed;
}

export async function writeLatches(book: LatchBook): Promise<void> {
  await mkdir(latchDir(), { recursive: true });
  await writeFile(LATCH_FILE(), JSON.stringify(book, null, 2));
}

/**
 * Put a pack on the list, merging it with one of the same name rather than replacing it.
 *
 * **Union, not replace.** A second hunt on the same term the same day is a CONTINUATION — Vansh
 * stopped the first one, or it ran out of clock — and replacing would throw away everything the
 * first pass found. Re-reading the same label PDF is the same union with the same answer, since
 * its SKUs have not changed.
 *
 * Different days are different packs, which is why a sweep is named with its date: *"we can run
 * multiple hunt with same searches"* — party decoration in September and again in November are two
 * hunts worth telling apart, because what Flipkart offers and what we already sell both move.
 */
function addPack(packs: LabelPack[], file: string, on: string, skus: string[]): LabelPack[] {
  const prev = packs.find((p) => p.file === file);
  const merged = {
    file,
    addedOn: prev && prev.addedOn > on ? prev.addedOn : on,
    skus: [...new Set([...(prev?.skus ?? []), ...skus])],
  };
  return [merged, ...packs.filter((p) => p.file !== file)].sort(
    (a, b) => b.addedOn.localeCompare(a.addedOn) || a.file.localeCompare(b.file),
  );
}

/** What a sweep's pack is called. The date is IN the name so two hunts of one term stay apart. */
export const sweepName = (term: string, on: string): string => `search: ${term} · ${on}`;

/**
 * Fold a freshly-read label pack into what we already know.
 *
 * **Dropping the same pack twice must change nothing, and dropping next month's must add only
 * what is new** — the same rule the manifest reader lives by. The SKU is the identity, so a
 * product already on file keeps its FSN, its state and the day it was latched; only two things
 * move: `seen` takes the larger count (a pack is a snapshot, not an increment, so ADDING would
 * double every product the moment the same file was read twice), and a longer title wins, because
 * the only reason two labels differ is where each one cut it off.
 */
export function mergeLabels(
  book: LatchBook,
  items: LatchItem[],
  /** The PDF this came from, so the screen can show a pack a day at a time. */
  file = "",
  on = todayStamp(),
): { book: LatchBook; added: number } {
  const by = new Map(book.rows.map((r) => [r.sku, { ...r }]));
  let added = 0;
  for (const item of items) {
    const prev = by.get(item.sku);
    if (!prev) {
      added++;
      by.set(item.sku, {
        sku: item.sku,
        description: item.description,
        seen: item.labels,
        fsn: null,
        title: null,
        state: "unknown",
        checkedOn: null,
      });
      continue;
    }
    prev.seen = Math.max(prev.seen, item.labels);
    if (item.description.length > prev.description.length) {
      prev.description = item.description;
      // A better title is a better search, so whatever we concluded from the worse one is stale.
      if (prev.state === "none" || prev.state === "ambiguous") prev.state = "unknown";
    }
  }
  const packs = file ? addPack(book.packs, file, on, items.map((i) => i.sku)) : book.packs;

  return {
    book: { packs, rows: [...by.values()].sort((a, b) => b.seen - a.seen || a.sku.localeCompare(b.sku)) },
    added,
  };
}

// ---------------------------------------------------------------- searching, against a live page

/** Every product on the results page, deduped by FSN, keeping the longest text as the title. */
export async function searchProducts(page: Page, termOrUrl: string): Promise<Result[]> {
  // A bare term is turned into a search URL; anything that already looks like one is used as it
  // stands, which is how the crawler asks for page 2 without a second copy of this function.
  await page.goto(/^https?:/.test(termOrUrl) ? termOrUrl : searchUrl(termOrUrl), { waitUntil: "domcontentloaded" });
  // The grid is rendered client-side; there is no stable selector to wait for that is not also
  // present on an empty result page, so this waits on time like the rest of the tool does.
  await page.waitForTimeout(3500);
  const raw = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/p/"]')]
      .map((a) => ({
        fsn: new URL((a as HTMLAnchorElement).href, location.origin).searchParams.get("pid"),
        title: (a.getAttribute("title") || a.textContent || "").trim(),
        url: (a as HTMLAnchorElement).href,
      }))
      .filter((h): h is { fsn: string; title: string; url: string } => !!h.fsn),
  );
  // Each product is three anchors — image, title, price. The price one starts with ₹ and is never
  // the title, and of the rest the longer is the real name.
  // Each product is three anchors and the PRICE is one of them, so it is collected rather than
  // skipped: it is what "are we cheaper than them" is decided on, and it is free here.
  const best = new Map<string, { title: string; url: string; listed: Listed | null }>();
  for (const h of raw) {
    const prev = best.get(h.fsn) ?? { title: "", url: h.url, listed: null };
    if (/^₹/.test(h.title)) prev.listed ??= parseListed(h.title);
    else if (h.title.length > prev.title.length) {
      prev.title = h.title;
      prev.url = h.url;
    }
    best.set(h.fsn, prev);
  }
  return [...best].filter(([, v]) => v.title).map(([fsn, v]) => ({ fsn, ...v }));
}

/**
 * Search for one label's product and say what Flipkart makes of it — without opening a tab.
 *
 * This is the half the SCREEN needs: forty products can be triaged through one reused tab in a few
 * minutes, and the answer for most of them is "you already sell this", which costs nothing to
 * learn and saves opening a form. Only what comes back `form` is work.
 *
 * `page` is reused across every product on purpose. A tab per product would be forty tabs opened
 * to find out that thirty of them needed none.
 */
export async function resolveProduct(page: Page, row: LatchRecord): Promise<LatchRecord> {
  /**
   * A row that already has an FSN skips the search entirely.
   *
   * Two reasons, and the second is the one that matters. It halves the time of a re-check, which
   * is worth having across forty products. And it is what makes a PASTED list work at all: a
   * partner's message carries the id but no title we could search on usefully — two sellers' kits
   * share a title — so searching would find some other product and answer confidently about it.
   */
  if (row.fsn) {
    return { ...row, ...(await readCard(page, row.fsn)), near: undefined, checkedOn: todayStamp() };
  }

  let pick = null;
  for (const term of searchTerms(row.description)) {
    pick = pickProduct(row.description, await searchProducts(page, term));
    if (pick.hit) break;
  }
  if (!pick?.hit) {
    return {
      ...row,
      fsn: null,
      title: null,
      state: pick?.why === "ambiguous" ? "ambiguous" : "none",
      near: pick?.near,
      checkedOn: todayStamp(),
    };
  }

  return {
    ...row,
    ...(await readCard(page, pick.hit.fsn)),
    title: pick.hit.title,
    url: pick.hit.url,
    listed: pick.hit.listed ?? null,
    near: undefined,
    checkedOn: todayStamp(),
  };
}

/**
 * What the catalog card says about one product — already selling, needs approval, or latchable.
 *
 * Answered by looking, never by clicking, so nothing is created on the account by asking. "stuck"
 * is Flipkart not answering, which is not the same as a No and must not be recorded as one.
 */
export async function readCard(page: Page, fsn: string): Promise<{ fsn: string; state: TabState }> {
  await page.goto(startSellingUrl(fsn), { waitUntil: "domcontentloaded" }).catch(() => {});
  try {
    await page.waitForSelector("a.startSelling", { timeout: 30_000 });
    return { fsn, state: cardState((await page.locator("a.startSelling").first().getAttribute("class")) ?? "") };
  } catch {
    return { fsn, state: "stuck" };
  }
}

// ---------------------------------------------------------------- the contents picture

/**
 * Every gallery photo of ONE listing, biggest first size, in the order Flipkart shows them.
 *
 * **Why the second one matters.** On a party-kit listing the first photo is the styled shot and
 * the SECOND is nearly always the contents laid out — "1 banner, 60 balloons, 1 pump" — which is
 * exactly what the costing prompt reads. So this exists to fetch one picture, not a gallery.
 *
 * **Telling the gallery from the carousel below it.** The page carries thirty-odd `rukminim`
 * images and most belong to *similar products*. Every shot of one listing shares the product slug
 * in its filename (`…-61-pcs-with-original-imahm9s5XXXX.jpeg`) and differs only in the hash after
 * `-original-`; a different product has a different slug. Measured: five gallery shots, twenty
 * strangers, clean separation. Size is NOT the test — the later shots are lazy-loaded and measure
 * 0×0 until scrolled to, while their `src` is already correct.
 *
 * The `/image/<w>/<h>/` segment is a resize Flipkart performs on request, so asking for 2000×2660
 * gets the full-resolution original whatever size the page happened to render.
 */
export async function galleryImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    // No named inner function here, deliberately: esbuild's keepNames injects a `__name` helper
    // that does not exist inside the page, and the call dies with "__name is not defined".
    [...new Set(
      [...document.querySelectorAll("img")]
        .map((i) => i.currentSrc || i.src)
        .filter((s) => /rukminim\d*\.flixcart\.com\/image\//.test(s))
        .map((s) => s.replace(/\/image\/\d+\/\d+\//, "/image/2000/2660/").replace(/\?.*$/, "")),
      // Compared inline rather than through a `const slug = …` helper: esbuild's keepNames wraps
      // any NAMED function in a `__name()` call that does not exist inside the page, and the whole
      // evaluate dies with "__name is not defined". Anonymous callback arguments are fine.
    )].filter(
      (s, _i, all) =>
        s.split("/").pop()!.replace(/-original-.*$/, "") ===
        all[0].split("/").pop()!.replace(/-original-.*$/, ""),
    ),
  );
}

/**
 * Save one gallery photo next to the latch record and hand back the path.
 *
 * Fetched inside the page rather than with `fetch` from Node so it goes out on the same session,
 * with the same cookies and referer — Flipkart's image host is content-delivery and does not
 * really care, but borrowing the tab costs nothing and cannot be the thing that breaks.
 */
export async function saveImage(page: Page, url: string, to: string): Promise<string> {
  const data = await page.evaluate(
    async (u) =>
      [...new Uint8Array(await (await fetch(u)).arrayBuffer())],
    url,
  );
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, Buffer.from(data));
  return to;
}

/** Where a product's contents picture is kept, named so a second run overwrites rather than piles up. */
export const imageFor = (sku: string): string => path.join(latchDir(), "images", `${sku}.jpg`);

// ---------------------------------------------------------------- handing it to ChatGPT

/** What became of an attempt to set a costing chat up. `manual` means the tab is open, do it yourself. */
export type ChatState = "ready" | "login" | "manual";

/**
 * Open a ChatGPT tab with the contents picture attached and the costing prompt typed in.
 *
 * **It does not press send.** The last thing between a picture and a priced kit is a human
 * deciding this is the right picture, and that is a second of looking versus a wrong costing
 * carried into a listing.
 *
 * **The login is not a problem, and is worth stating because it looks like one.** This is the same
 * persistent Chrome profile that holds the Flipkart session: log in to ChatGPT once in that window
 * and it stays logged in, because `connect.ts` closes Chrome gracefully so cookies reach the disk.
 * `login` comes back when it is not logged in yet — uploads are gated behind an account — and the
 * answer is to log in in that very tab, once, ever.
 *
 * `manual` is the honest outcome when the composer is not where it was. ChatGPT's markup changes
 * without notice and this tool is not worth breaking a latch run over: the tab is open and the
 * image is on disk, so the fallback is the thing Vansh offered to do by hand anyway.
 */
export async function askChatGpt(page: Page, image: string, prompt: string): Promise<ChatState> {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(6000);

  // "Log in to …upload files" is the page telling us the next step, so pass it on rather than
  // failing at a file input that was never going to accept anything.
  if (await page.getByText("Log in", { exact: true }).first().isVisible().catch(() => false)) {
    if ((await page.locator("input[type=file]").count()) === 0) return "login";
  }

  try {
    // `setInputFiles` on the hidden input, never a click on the paperclip: the picker it opens is
    // an OS dialog, which is outside the page and cannot be driven from here at all.
    await page.locator("input[type=file]").first().setInputFiles(image, { timeout: 15_000 });
    const composer = page.locator("#prompt-textarea").first();
    await composer.click({ timeout: 15_000 });
    // `fill` on a contenteditable composer is unreliable; typing with no delay is not, and the
    // prompt is pasted as one block rather than keystroke by keystroke.
    await composer.pressSequentially(prompt, { delay: 0, timeout: 60_000 });
    // Give the upload a moment to finish, so the tab he switches to is not mid-spinner.
    await page.waitForTimeout(4000);
    return "ready";
  } catch {
    return "manual";
  }
}

// ---------------------------------------------------------------- what they charge

/** A competitor's listed money, in paise — integers, like every other price in this codebase. */
export interface Listed {
  /** What a buyer pays today. The number our own price has to beat. */
  pricePaise: number;
  /** The struck-through price. Null when the card shows no discount. */
  mrpPaise: number | null;
}

/**
 * Read `₹147₹34957% off` off a search card.
 *
 * **The three numbers run together with nothing between them**, and the join is genuinely
 * ambiguous: `₹349` + `57% off` and `₹3495` + `7% off` are the same string. Splitting at a fixed
 * width would be a guess, and the number it gets wrong is the MRP — which is exactly the figure
 * "how much cheaper are we than them" is worked out from.
 *
 * So every split is tried and the arithmetic decides: a discount is `1 - price/mrp`, and only the
 * true split reproduces the percentage Flipkart printed. `₹147₹349` at 57% off checks out;
 * `₹147₹3495` at 7% off does not, being nowhere near.
 *
 * Null when the card has no price at all — an ad slot, or a product out of stock.
 */
export function parseListed(text: string): Listed | null {
  const m = /₹([\d,]+)₹?([\d,]*)/.exec(text);
  if (!m) return null;
  const price = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(price) || price <= 0) return null;

  const rest = m[2].replace(/,/g, "");
  for (let cut = 1; cut <= 3 && cut < rest.length; cut++) {
    const mrp = Number(rest.slice(0, rest.length - cut));
    const off = Number(rest.slice(rest.length - cut));
    if (!mrp || mrp < price) continue;
    // Flipkart rounds the percentage it prints, so anything within one point is the right split.
    if (Math.abs(Math.round((1 - price / mrp) * 100) - off) <= 1) {
      return { pricePaise: price * 100, mrpPaise: mrp * 100 };
    }
  }
  return { pricePaise: price * 100, mrpPaise: null };
}

/** `₹190` — paise back to something a person reads. */
export const rupees = (paise: number): string => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

// ---------------------------------------------------------------- finding products nobody gave us

/**
 * The words that mean a product is in our trade.
 *
 * **This rail exists because of a real hour wasted.** Sweeping the approved brand `tigorik` on
 * 2026-09-13 returned 251 products and 146 "latchable" — every one a **Tata Tigor car cover**,
 * because Flipkart's search fuzzy-matched the brand name to a car model. Vansh: *"what the hell are
 * we looking for bro… we should hunt for product latch for what we can actually sell."*
 *
 * The brand-prefix filter fixes that particular case. This does not depend on it: a brand can sell
 * in two trades, a search can drift, and a sweep runs unattended for an hour. **Two independent
 * rails, because the cost of a wrong one is an hour of looking and a listing on a car cover.**
 *
 * Deliberately generous — it decides only whether a product is worth OPENING, and a false yes
 * costs one page load while a false no loses a product forever. Widen it rather than narrow it;
 * if WishWorks ever sells something new, this is the list to add the word to.
 */
const SELLS = [
  "balloon", "birthday", "decoration", "decor", "party", "anniversary", "banner", "bunting",
  "confetti", "foil", "garland", "backdrop", "curtain", "topper", "bouquet", "arch", "streamer",
  "baby shower", "annaprashan", "annaprasan", "rice ceremony", "haldi", "mehndi", "bachelorette",
  "groom", "bride", "welcome home", "photo booth", "photobooth", "candle", "cutout", "props",
  "wedding", "festive", "celebration", "theme", "combo kit", "gift wrap",
];

/** Is this something WishWorks actually sells? Title only — it is judged before the page is opened. */
export function weSell(title: string): boolean {
  const t = normalize(title);
  return SELLS.some((w) => t.includes(w));
}

/** One page of Flipkart's search. Page 1 is the bare search URL; later ones take `&page=n`. */
export const searchPage = (term: string, page: number): string =>
  page <= 1 ? searchUrl(term) : `${searchUrl(term)}&page=${page}`;

/**
 * A product found by sweeping a search rather than by reading a label.
 *
 * It has no rival SKU — nobody handed us one — so the FSN is its name. That is the whole reason
 * `LatchRecord.sku` is a free-form id rather than a promise about where it came from.
 */
export interface Found {
  fsn: string;
  title: string;
  url: string;
  listed: Listed | null;
  state: TabState;
}

/**
 * Sweep a search term for products this account could latch onto, until the time runs out.
 *
 * **Why a crawl at all.** A label pack is somebody else's bestseller list, which is a good list
 * but a borrowed one. Searching `party decoration` and asking the same question of everything that
 * comes back finds products nobody handed us — and the cost per product is one page load, because
 * the catalog card answers *already selling / needs approval / latchable* without a click.
 *
 * **The clock is the budget, not the page count.** Vansh asked for an hour of sweeping, stopping
 * early when the results run out. Flipkart's search stops yielding new products somewhere past
 * page twenty, so both ends of that are real.
 *
 * `onFound` is called for every product as it is judged, so the screen fills while it runs rather
 * than after; a sweep this long must show its work.
 */
export async function crawlSearch(
  page: Page,
  term: string,
  opts: {
    /** Wall-clock budget. The sweep stops between products, never mid-page. */
    until: number;
    /** Products already on file, by FSN, so a re-run does not re-ask what we know. */
    known?: Set<string>;
    onFound?: (f: Found, seen: number) => void;
    /** True to stop early. The screen's cancel button. */
    stopped?: () => boolean;
    /**
     * Keep only products whose title STARTS with this brand.
     *
     * **Without it a brand sweep latches the wrong catalog entirely.** Measured, 2026-09-13:
     * sweeping the approved brand `tigorik` returned 251 products and 146 "latchable" — every one
     * of them a **Tata Tigor car cover**, because Flipkart's search fuzzy-matched the brand name
     * to a car model. A product's own brand is the first word of its catalog title (`ZYRIC Solid
     * Happy birthday…`, `Partyfox Birthday…`), so that prefix is what separates a brand's listings
     * from everything the search *thought* we meant.
     */
    brand?: string;
  },
): Promise<Found[]> {
  const out: Found[] = [];
  const seenFsn = new Set(opts.known ?? []);
  let seen = 0;

  for (let n = 1; Date.now() < opts.until && !opts.stopped?.(); n++) {
    const want = opts.brand ? normalize(opts.brand) : null;
    const fresh = (await searchProducts(page, searchPage(term, n))).filter((r) => !seenFsn.has(r.fsn));
    // A page with nothing NEW on it is the end of the results — Flipkart serves the last page over
    // and over rather than 404ing, so that is the only stop signal there is. Judged before the
    // brand filter, because a page that is all other brands is still a page that moved forward.
    if (fresh.length === 0) break;

    // Two rails, and the trade one is not optional. A sweep runs unattended for an hour; the cost
    // of getting this wrong is that hour, plus a live listing on somebody's car cover.
    const results = (want ? fresh.filter((r) => normalize(r.title).startsWith(want)) : fresh).filter(
      (r) => weSell(r.title),
    );
    // Everything on the page counts as seen, matched or not: a product rejected for being another
    // brand must not be reconsidered on page after page.
    for (const r of fresh) seenFsn.add(r.fsn);

    for (const r of results) {
      if (Date.now() >= opts.until || opts.stopped?.()) break;
      seen++;
      await page.goto(startSellingUrl(r.fsn), { waitUntil: "domcontentloaded" }).catch(() => {});
      let state: TabState = "stuck";
      try {
        await page.waitForSelector("a.startSelling", { timeout: 20_000 });
        state = cardState((await page.locator("a.startSelling").first().getAttribute("class")) ?? "");
      } catch {
        /* "stuck" — Flipkart did not answer. Not a No, and not worth abandoning the sweep for. */
      }
      const found = { fsn: r.fsn, title: r.title, url: r.url, listed: r.listed ?? null, state };
      out.push(found);
      opts.onFound?.(found, seen);
    }
  }
  return out;
}

/** Fold a sweep's results into the book, keeping the FSN as the id where there is no rival SKU. */
export function mergeFound(book: LatchBook, found: Found[], term: string, on = todayStamp()): {
  book: LatchBook;
  added: number;
} {
  const by = new Map(book.rows.map((r) => [r.sku, { ...r }]));
  let added = 0;
  for (const f of found) {
    const prev = by.get(f.fsn);
    if (prev) {
      // A sweep re-confirms what a sweep found: the state and the price are fresher than what is
      // on file. What it must NOT touch is `latchedOn` — that happened, whatever the card says now.
      Object.assign(prev, { state: f.state, listed: f.listed, title: f.title, url: f.url, checkedOn: on });
      continue;
    }
    added++;
    by.set(f.fsn, {
      sku: f.fsn,
      description: f.title,
      seen: 0, // nobody shipped it past us — a sweep carries no sales signal at all
      fsn: f.fsn,
      title: f.title,
      url: f.url,
      listed: f.listed,
      state: f.state,
      checkedOn: on,
    });
  }
  const packs = addPack(book.packs, sweepName(term, on), on, found.map((f) => f.fsn));

  return {
    book: { packs, rows: [...by.values()].sort((a, b) => b.seen - a.seen || a.sku.localeCompare(b.sku)) },
    added,
  };
}

// ---------------------------------------------------------------- telling somebody else

/**
 * The whole list as a message a partner can read on a phone.
 *
 * **Plain text, not a file.** This goes to a business partner on WhatsApp, which is where the
 * business actually talks; a CSV is a thing to open on a computer he may not be at, and a web page
 * is a link to something that needs hosting. Text pastes anywhere and survives forwarding.
 *
 * **Everything, grouped — not just what we can latch.** The first version sent only the latchable
 * ones, on the reasoning that a partner does not need the products we already sell. Vansh,
 * 2026-09-13: *"no it would need all… he will look if any of these 3 are useful or not."* He is
 * right and the reasoning was mine, not the business's: a partner who can see that we already sell
 * eleven of these knows something about the category, and one who is only shown the gaps cannot
 * tell a thin list from a thorough one. Grouping by state keeps it readable without deciding for
 * him what is worth reading.
 *
 * `scope` is one pack — a label pack, or a sweep like `search: party decoration` — or null for
 * everything on file. Those are the three lists Vansh asked for: all, today's hunt, today's label.
 */
export function shareText(book: LatchBook, scope: string | null, oursPaise: number): string {
  const chosen = scope ? book.packs.find((p) => p.file === scope) : null;
  const rows = chosen ? book.rows.filter((r) => chosen.skus.includes(r.sku)) : book.rows;
  const where = chosen ? `${chosen.file} (${chosen.addedOn})` : "everything on file";
  if (rows.length === 0) return `Nothing on file for ${where}.`;

  // The same order the screen uses, and for the same reason: what is actionable first, what is a
  // reason to do nothing after it.
  const order: { state: LatchRecord["state"]; label: string }[] = [
    { state: "form", label: "CAN LATCH" },
    { state: "approval", label: "NEEDS APPROVAL FIRST" },
    { state: "selling", label: "WE ALREADY SELL THESE" },
    { state: "ambiguous", label: "MORE THAN ONE LISTING FITS" },
    { state: "none", label: "COULDN'T FIND ON FLIPKART" },
    { state: "unknown", label: "NOT CHECKED YET" },
    { state: "stuck", label: "FLIPKART DIDN'T ANSWER" },
  ];

  const out = [`${rows.length} product${rows.length === 1 ? "" : "s"} — ${where}.`];
  let priced = false;
  for (const { state, label } of order) {
    const mine = rows.filter((r) => r.state === state);
    if (mine.length === 0) continue;
    out.push("", `${label} (${mine.length})`);
    mine.forEach((r, i) => {
      const theirs = r.listed ? `  they: ${rupees(r.listed.pricePaise)}` : "";
      let gap = "";
      if (r.listed) {
        priced = true;
        gap =
          r.listed.pricePaise < oursPaise
            ? `  us: ${rupees(oursPaise)} (+${rupees(oursPaise - r.listed.pricePaise)} DEARER)`
            : `  us: ${rupees(oursPaise)} (-${rupees(r.listed.pricePaise - oursPaise)})`;
      }
      // The FSN is Flipkart's own id for the product, and putting it in the message is what makes
      // the message EXECUTABLE: whoever receives it pastes it back into their own copy of this app
      // and runs the same latch flow on their own account. A title cannot do that — two sellers'
      // kits share a title — and sixteen characters is a small price for a list that round-trips.
      out.push(`${i + 1}. ${r.title ?? r.description} [${r.fsn ?? "?"}]${theirs}${gap}`);
    });
  }
  // **Every state in this message is an answer about OUR account, and the reader has his own.**
  // Flipkart decides already-selling and brand approval per seller, so a product under "we already
  // sell these" may be wide open to him, and one under "can latch" may need an approval he does not
  // have. Without this line the list reads as facts about the products; it is facts about us.
  out.push(
    "",
    "Can-latch / already-selling / needs-approval are answers for OUR seller account.",
    "Flipkart decides those per seller, so on your account they may come out differently — worth checking your side.",
  );
  if (priced) {
    out.push("", "DEARER = we would be pricier than the seller already on that listing — worth a look, not a no.");
  }
  return out.join("\n");
}



/**
 * Pull the products back out of a list somebody was sent.
 *
 * The other half of `shareText`: a partner receives the message, pastes it into his own copy of
 * this app, and runs the latch flow against HIS account — where "already selling" and "needs
 * approval" will answer differently, which is the whole reason he cannot just act on our states.
 *
 * **Matched on the FSN, not on the line's shape.** A message that has been through WhatsApp has
 * been wrapped, quoted, forwarded and had `>` prefixes added; anything that insists on
 * `N. Title [FSN]` breaks on the first of those. A Flipkart FSN is sixteen uppercase alphanumerics
 * and nothing else in the message looks like one, so finding those and reading the title backwards
 * from each survives every mangling that matters.
 *
 * A stray sixteen-character token would come through as a product that no catalog page answers
 * for — which the check reports as "Flipkart didn't answer" and is exactly right for a typo.
 */
export function parseSharedList(text: string): { fsn: string; title: string }[] {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/\b([A-Z0-9]{16})\b/g)) {
      // The title is whatever sits before the id on that line, stripped of the list number and of
      // any quoting the messenger added. Empty is fine — the catalog page knows its own name.
      const before = line.slice(0, m.index).replace(/^[>\s]*\d+[.)]\s*/, "").replace(/\[$/, "").trim();
      if (!out.has(m[1]) || (out.get(m[1]) ?? "").length < before.length) out.set(m[1], before);
    }
  }
  return [...out].map(([fsn, title]) => ({ fsn, title }));
}

/** Fold a pasted list into the book. Nothing is known about these yet except that they exist. */
export function mergeShared(book: LatchBook, items: { fsn: string; title: string }[], on = todayStamp()): {
  book: LatchBook;
  added: number;
} {
  const by = new Map(book.rows.map((r) => [r.sku, { ...r }]));
  let added = 0;
  for (const it of items) {
    const prev = by.get(it.fsn);
    if (prev) {
      // Already ours — a partner sending back a product we know does not reset what we know about
      // it. Only the title is worth taking, and only when theirs is fuller.
      if (it.title.length > (prev.title ?? "").length) prev.title = it.title;
      continue;
    }
    added++;
    by.set(it.fsn, {
      sku: it.fsn,
      description: it.title || it.fsn,
      seen: 0,
      fsn: it.fsn,
      title: it.title || null,
      // No product page came with the list — only the id did. That costs the contents photo for
      // these, and nothing else: the latch itself needs the FSN alone.
      url: null,
      state: "unknown",
      checkedOn: null,
    });
  }
  const packs = addPack(book.packs, `shared list ${on}`, on, items.map((i) => i.fsn));

  return {
    book: { packs, rows: [...by.values()].sort((a, b) => b.seen - a.seen || a.sku.localeCompare(b.sku)) },
    added,
  };
}


/** Every search term ever swept, newest hunt first — what has already been looked at, and when. */
export function searchHistory(book: LatchBook): { term: string; on: string; found: number }[] {
  return book.packs
    .filter((p) => p.file.startsWith("search: "))
    .map((p) => {
      const [term, on] = p.file.slice("search: ".length).split(" · ");
      return { term, on: on ?? p.addedOn, found: p.skus.length };
    })
    .sort((a, b) => b.on.localeCompare(a.on) || a.term.localeCompare(b.term));
}


// ---------------------------------------------------------------- joining a latch to its costing

/**
 * Read back the SKUs a human typed into the latch tabs that are still open.
 *
 * **The SKU is the one thing this tool deliberately does not fill in**, which leaves it the one
 * thing it does not know — and it is exactly the key the costing is filed under. Asking for it a
 * second time in the app would be asking a person to retype something correct, which is how wrong
 * data gets in. So it is lifted straight out of the form.
 *
 * Tabs are matched by the `fsn=` in their URL, not by their order: they are opened in one order
 * and worked in another, and pairing by position would file a costing under the wrong product.
 *
 * A tab that has been closed is simply not read. Nothing here is a failure — it just means that
 * one will have to be typed, or the tab reopened.
 */
export async function readOurSkus(pages: Page[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const page of pages) {
    if (page.isClosed()) continue;
    const fsn = /[?&]fsn=([^&]+)/.exec(page.url())?.[1];
    if (!fsn) continue;
    const sku = await page
      .locator("input[name=sku_id]")
      .first()
      .inputValue({ timeout: 3000 })
      .catch(() => "");
    if (sku.trim()) out[decodeURIComponent(fsn)] = sku.trim();
  }
  return out;
}

/**
 * What the costing of one of OUR SKUs looks like, as far as the queue needs to care.
 *
 * Passed in rather than read here, so this file never has to know about kits, materials or the
 * shelf — the join between the three engines happens once, in the handler.
 */
export interface KitHealth {
  costed: boolean;
  confirmed: boolean;
  /** Lines whose reading matched no material on the price list at all. */
  unmatched: number;
  /** Lines that matched, but loosely enough to be worth checking against the picture. */
  flagged: number;
  lines: number;
  /** Materials this kit needs that the shelf says we have none of, or has never seen. */
  short: string[];
}

/** A latched product whose price nobody has signed off yet. */
export interface Pending {
  fsn: string;
  title: string;
  /** Ours, once it is known. Null means we cannot even look the costing up yet. */
  ourSku: string | null;
  /** Which label pack or sweep it came from — how Vansh traces it back. */
  from: string[];
  latchedOn: string;
  /** What the seller we latched from charges, for deciding where ours should land. */
  listed: Listed | null;
  /** `none` = no costing at all; `unconfirmed` = costed, but nobody has checked it. */
  why: "no-sku" | "none" | "unconfirmed";
  /**
   * Materials this kit needs that are not on the shelf.
   *
   * Carried as data, not folded into `reasons`, because something ACTS on it: a listing whose kit
   * is short has to be paused, and deciding that by matching words in a sentence is how a pause
   * silently stops happening the day the sentence is reworded.
   */
  short: string[];
  /** How urgently this one needs a human, 0–100. The order of the list. */
  risk: number;
  /** Why it scored that, in words. A number nobody can read is a number nobody acts on. */
  reasons: string[];
}

/**
 * How urgent one latched-but-unpriced listing is.
 *
 * **The thing that makes this more than a to-do list: a latched listing is LIVE.** It can take an
 * order tonight. Vansh, 2026-09-13: *"maybe we get orders for this, and maybe we don't have this
 * at our inventory… accepting the order and then doing the cancellation downgrades our Flipkart
 * account."* So the queue is not sorted by when it was latched — it is sorted by what it would
 * cost to be caught out.
 *
 * The weights, worst first, and each is a different kind of trouble:
 *
 *  - **A material the shelf has none of (50).** The only failure here that cannot be fixed after
 *    the order arrives. Everything else costs attention; this costs a cancellation.
 *  - **No costing at all (30).** Live, and nobody has even looked at what it is made of.
 *  - **A line matching nothing on the price list (25).** Usually a material we have never bought —
 *    which is precisely what latching keeps introducing, and what the supplier call exists to
 *    catch. Not knowing the price is the small half; not owning it is the large one.
 *  - **Loose matches (up to 15, by share of the kit).** Vansh's own example: *"if we name like
 *    feroggi color balloon then it's going to match for balloon."* A kit held together by loose
 *    matches is a kit whose materials list is a guess, and a guess cannot be shopped from.
 *  - **No SKU known (20).** Nothing can be checked at all until somebody says which kit it is.
 *  - **Costed but unconfirmed (5).** The ordinary case, and the reason the list exists — but the
 *    least dangerous thing on it.
 *
 * ponytail: hand-weighted, and deliberately. The alternative is a model nobody can argue with; a
 * person needs to be able to say "a stockout is worth more than two loose matches" and change it.
 */
export function riskOf(health: KitHealth | null): { risk: number; reasons: string[] } {
  const reasons: string[] = [];
  let risk = 0;
  if (!health) {
    return { risk: 20, reasons: ["SKU not known — nothing can be checked yet"] };
  }
  if (health.short.length) {
    risk += 50;
    reasons.push(
      `no stock of ${health.short.slice(0, 3).join(", ")}` +
        (health.short.length > 3 ? ` and ${health.short.length - 3} more` : ""),
    );
  }
  if (!health.costed) {
    risk += 30;
    reasons.push("no costing yet — live, and we do not know what it is made of");
  }
  if (health.unmatched) {
    risk += 25;
    reasons.push(`${health.unmatched} line${health.unmatched === 1 ? "" : "s"} on no price row — likely a material we have never bought`);
  }
  if (health.lines && health.flagged) {
    const share = health.flagged / health.lines;
    risk += Math.round(share * 15);
    reasons.push(`${health.flagged} of ${health.lines} lines matched loosely — check them against the picture`);
  }
  if (health.costed && !health.confirmed) {
    risk += 5;
    reasons.push("costed, but nobody has signed the price off");
  }
  return { risk: Math.min(risk, 100), reasons };
}

/**
 * Everything we have latched that is not yet priced with a price somebody stands behind,
 * **worst first**.
 *
 * This is the buffer Vansh asked for, and it exists because the two halves of the job happen days
 * apart: the latch is a minute's work and the costing waits on a photo, a ChatGPT reply and a
 * human checking it. Without a list, what falls through is silent — a live listing at the default
 * ₹220 that nobody ever went back to, possibly for a kit we cannot even pack.
 *
 * `health` is our own SKUs to what their costing looks like; a SKU absent from it has no costing.
 */
export function pendingPrices(book: LatchBook, health: Map<string, KitHealth>): Pending[] {
  const packsOf = (sku: string) => book.packs.filter((p) => p.skus.includes(sku)).map((p) => p.file);
  return book.rows
    .filter((r) => r.latchedOn)
    .map((r) => {
      const ourSku = r.ourSku ?? null;
      const mine = ourSku ? (health.get(ourSku) ?? null) : null;
      const { risk, reasons } = riskOf(ourSku ? (mine ?? { costed: false, confirmed: false, unmatched: 0, flagged: 0, lines: 0, short: [] }) : null);
      // Three different reasons, because they need three different actions: find the SKU, cost the
      // kit, or go and check a costing. One "not done" would hide which.
      const why: Pending["why"] = !ourSku ? "no-sku" : mine?.costed ? "unconfirmed" : "none";
      return {
        fsn: r.fsn ?? r.sku,
        title: r.title ?? r.description,
        ourSku,
        from: packsOf(r.sku),
        latchedOn: r.latchedOn!,
        listed: r.listed ?? null,
        why,
        short: mine?.short ?? [],
        risk,
        reasons,
      };
    })
    .filter((p) => !(p.ourSku && health.get(p.ourSku)?.confirmed && !health.get(p.ourSku)?.short.length))
    // **Worst first, not newest first.** The whole point is that one of these can cost a
    // cancellation and the rest cost attention.
    .sort((a, b) => b.risk - a.risk || b.latchedOn.localeCompare(a.latchedOn) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- brands we have been approved for

/** One row of Track Approval Requests. */
export interface Approval {
  /** Flipkart's own request id — nine digits, and the only stable name a row has. */
  id: string;
  brand: string;
  /** Flipkart's category word: `Balloon`, `Decoration`, `Birthday Combo`. */
  vertical: string;
  /** `Approved`, `Pending`, and whatever else Flipkart decides to print. Kept verbatim. */
  status: string;
  /** `Sep 9, 2026 1:27 PM`, as printed. Not parsed — nothing here does arithmetic on it. */
  updatedAt: string;
}

/** The page that lists them. `requestState=ALL` so pending ones show beside the approved. */
export const APPROVALS_URL =
  "https://seller.flipkart.com/index.html#dashboard/listings/trackApprovalRequestsV2?requestState=ALL";

/**
 * Read the approvals table out of the page's text.
 *
 * **Anchored on the request id, not on the table's markup.** The id is nine digits on a line of its
 * own and nothing else on that page looks like one, so the five cells after it are the row. Reading
 * `tr`/`td` would be the obvious way and is the fragile one: this table is styled-components divs
 * whose class names change with every deploy, and the cells collapse into a single string when you
 * walk up the DOM looking for a row — measured, that is what the first attempt returned.
 *
 * A row with no `Add Listings` (one still pending) has one line fewer, which is exactly why the
 * fields are counted FORWARD from the id and the action column is never read.
 */
export function parseApprovals(pageText: string): Approval[] {
  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Approval[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d{9}$/.test(lines[i])) continue;
    const [brand, vertical, , updatedAt, status] = lines.slice(i + 1, i + 6);
    if (!brand || !vertical || !status) continue;
    out.push({ id: lines[i], brand, vertical, status, updatedAt: updatedAt ?? "" });
  }
  return out;
}

/** Every approval request on the account, as Flipkart currently reports it. */
export async function readApprovals(page: Page): Promise<Approval[]> {
  await page.goto(APPROVALS_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  // The table arrives after the shell; there is no selector that is absent on an empty account,
  // so this waits on time like the rest of the tool.
  await page.waitForTimeout(11_000);
  return parseApprovals(await page.evaluate(() => document.body.innerText));
}

/**
 * The brands we may now list, that Flipkart's own button will not actually take us to.
 *
 * **Why this exists at all.** `Add Listings` on an approved row navigates to
 * `#dashboard/listingsInProgress?vertical=…&brand=…&sourceid=TRACK_APPROVAL_PAGE` and the page
 * immediately re-navigates to the same screen with a bare `filters={…}` — dropping the brand and
 * the vertical. Recorded, 2026-09-13: that is why Vansh lands on an unfiltered list and cannot
 * find the product he was just approved for. It is not a thing he is doing wrong.
 *
 * `listingsInProgress` is the wrong destination anyway: those are our own drafts, not the catalog.
 * The thing an approval actually unlocks is *every catalog product of that brand*, and the way to
 * those is the search we already sweep — so an approved brand becomes a search term.
 */
export const approvedBrands = (all: Approval[]): Approval[] =>
  all.filter((a) => /approved/i.test(a.status));


/**
 * Listings to take down until the delivery lands.
 *
 * **Pausing is the cheap way to be out of stock.** The alternative — letting a live listing take an
 * order we cannot pack and cancelling it — costs account health on Flipkart, and Vansh named that
 * as the thing to avoid: *"we should know what we have to pause before the delivery is given to
 * us."* A paused listing costs nothing but the sales it would have made, and it comes back with one
 * field the day the materials arrive.
 *
 * This is deliberately NOT the same list as "needs a price". A kit can be costed, signed off and
 * priced exactly right and still be unpackable — and that one is the most dangerous listing on the
 * account precisely because every other screen says it is finished.
 */
export function toPause(pending: Pending[]): Pending[] {
  return pending.filter((p) => p.short.length > 0);
}

/**
 * Which materials are holding live listings down, and which listings each one blocks.
 *
 * The supplier call already asks for these — `nextCall` reads every costed kit — but it cannot say
 * that a line is blocking something ALREADY SELLING rather than a kit that is still an idea. That
 * is the difference between ordering it this week and ordering it today, so it is worth saying.
 */
export function blocking(pending: Pending[]): { material: string; skus: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const p of toPause(pending)) {
    for (const m of p.short) {
      if (!by.has(m)) by.set(m, new Set());
      by.get(m)!.add(p.ourSku ?? p.fsn);
    }
  }
  return [...by]
    .map(([material, skus]) => ({ material, skus: [...skus].sort() }))
    // Most listings blocked first: one material holding four listings down is one phone call.
    .sort((a, b) => b.skus.length - a.skus.length || a.material.localeCompare(b.material));
}

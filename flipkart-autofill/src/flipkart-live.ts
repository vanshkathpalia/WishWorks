/**
 * flipkart-live.ts — what is actually live on OUR Flipkart account, and where each kit's photos belong.
 *
 * **The account is the truth, not our notes.** Measured 2026-09-18: the latch list said HBD102 twice
 * and HBD-sonic101, while Flipkart had HBD008, HBD009 and HBD-sonic-org — the app had recorded the SKU
 * it SUGGESTED, not the one Vansh saved. And "has a Flipkart price in its kit" missed GTB10 and HA002,
 * both live. So the sync reads the seller's own listings (the Listings page's data call, replayed with
 * a bigger page) and everything downstream keys off that.
 *
 * **Three photo roots in Downloads**, one per answer to "where is it sold": `Whatsapp DW` for both,
 * `Flipkart only`, `Meesho only`. On Meesho = the kit carries a Meesho price (Meesho has no API to ask).
 * Folders are never moved without a person seeing the plan first — they were sorted by hand.
 */

import type { Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { latchDir, type LatchBook, type LatchRecord } from "./latch-core.js";

export interface LiveListing {
  /** OUR SKU, as saved on Flipkart. */
  sku: string;
  fsn: string;
  state: string;
  brand: string;
  title: string;
  sellingPaise: number;
  mrpPaise: number;
  /** The shopper page. */
  url: string;
  releasedOn: string;
}

/** One raw row of `listingsDataForStates` → the fields we keep. */
export function toLive(raw: Record<string, unknown>): LiveListing {
  return {
    sku: String(raw.sku_id),
    fsn: String(raw.product_id),
    state: String(raw.internal_state),
    brand: String(raw.brand ?? ""),
    title: String(raw.title ?? ""),
    sellingPaise: Math.round(Number(raw.ssp ?? 0) * 100),
    mrpPaise: Math.round(Number(raw.mrp ?? 0) * 100),
    url: raw.url ? `https://www.flipkart.com${raw.url}` : `https://www.flipkart.com/product/p/itme?pid=${raw.product_id}`,
    releasedOn: String(raw.fk_release_date ?? "").slice(0, 10),
  };
}

const STATES = ["ACTIVE", "READY_FOR_ACTIVATION", "INACTIVE", "INACTIVATED_BY_FLIPKART", "ARCHIVED"];

/**
 * Every listing on the account, from a logged-in seller tab.
 *
 * The page's own call carries a CSRF header we cannot make up, so we open the Listings page, borrow
 * the headers off the request it makes, and replay it once per state with room for 500 rows.
 */
export async function fetchLive(page: Page): Promise<LiveListing[]> {
  const first = page.waitForRequest(/\/napi\/listing\/listingsDataForStates/, { timeout: 60_000 });
  await page.goto("https://seller.flipkart.com/index.html#dashboard/listings-management?listingState=ACTIVE", {
    waitUntil: "domcontentloaded",
  });
  const headers = Object.fromEntries(
    Object.entries((await first).headers()).filter(([k]) => !k.startsWith(":") && !["content-length", "cookie", "host"].includes(k)),
  );
  const out: LiveListing[] = [];
  for (const state of STATES) {
    const body = JSON.stringify({
      search_text: "",
      search_filters: { internal_state: state },
      column: { sort: { column_name: "demand_weight", sort_by: "DESC" }, pagination: { batch_no: 0, batch_size: 500 } },
    });
    const text = await page.evaluate(
      async ([h, b]) =>
        (await fetch("/napi/listing/listingsDataForStates", { method: "POST", headers: h, body: b, credentials: "include" })).text(),
      [headers, body] as const,
    );
    const rows = (JSON.parse(text) as { listing_data_response?: Record<string, unknown>[] }).listing_data_response ?? [];
    out.push(...rows.map(toLive));
  }
  return out;
}

/**
 * The key two spellings of one SKU share. `ANP015` = `ANP15`, `HBD-sonic01 - 8yr` = `HBD-sonic01 - 8 yr`,
 * and a kit saved as `WKU001-ANP001` is the listing `ANP001` — the WKU prefix is an old kit numbering.
 */
export const skuKey = (sku: string): string =>
  sku.toUpperCase().replace(/[^A-Z0-9]+/g, "").replace(/([A-Z])0+(\d)/g, "$1$2").replace(/^WKU\d+(?=[A-Z])/, "");

/**
 * Put what the account says into the latch list: each live listing's row gets the SKU it was SAVED
 * with and counts as latched; a live listing the list never heard of (latched by hand, or our own
 * catalog) is added under a pack of its own, so the costing and photo steps can reach it.
 */
export function syncBook(book: LatchBook, live: LiveListing[], on: string): {
  book: LatchBook;
  fixed: { fsn: string; was: string | undefined; now: string }[];
  added: number;
} {
  const fixed: { fsn: string; was: string | undefined; now: string }[] = [];
  const byFsn = new Map(live.map((l) => [l.fsn, l]));
  const rows: LatchRecord[] = book.rows.map((r) => {
    const l = r.fsn ? byFsn.get(r.fsn) : undefined;
    if (!l) return r;
    if (r.ourSku !== l.sku) fixed.push({ fsn: l.fsn, was: r.ourSku, now: l.sku });
    return { ...r, ourSku: l.sku, latchedOn: r.latchedOn ?? l.releasedOn, state: "selling", checkedOn: on };
  });
  const known = new Set(book.rows.map((r) => r.fsn));
  const fresh: LatchRecord[] = live
    .filter((l) => !known.has(l.fsn))
    .map((l) => ({
      sku: l.fsn, description: l.title, seen: 0, fsn: l.fsn, title: l.title, url: l.url,
      state: "selling", checkedOn: on, latchedOn: l.releasedOn, ourSku: l.sku,
    }));
  const packs = fresh.length
    ? [...book.packs.filter((p) => p.file !== "live on Flipkart"), {
        file: "live on Flipkart", addedOn: on,
        skus: [...(book.packs.find((p) => p.file === "live on Flipkart")?.skus ?? []), ...fresh.map((r) => r.sku)],
      }]
    : book.packs;
  return { book: { packs, rows: [...rows, ...fresh] }, fixed, added: fresh.length };
}

// ---------------------------------------------------------------- which folder

export type Where = "both" | "flipkart" | "meesho" | "none";

export const ROOT_FOR: Record<Exclude<Where, "none">, string> = {
  both: "Whatsapp DW",
  flipkart: "Flipkart only",
  meesho: "Meesho only",
};

export interface Placed {
  /** The SKU to show: the live one when there is one, else the kit's. */
  sku: string;
  /** The kit's own name when it differs (`WKU001-ANP001` for `ANP001`). */
  kitSku: string | null;
  where: Where;
  live: boolean;
  hasKit: boolean;
}

/** Every SKU we know — live listings and costed kits — and which marketplaces carry it. */
export function place(kits: { sku: string; meesho: boolean }[], live: LiveListing[]): Placed[] {
  const on = new Map<string, Placed>();
  for (const l of live.filter((l) => l.state !== "ARCHIVED")) {
    on.set(skuKey(l.sku), { sku: l.sku, kitSku: null, where: "flipkart", live: true, hasKit: false });
  }
  for (const k of kits) {
    const p = on.get(skuKey(k.sku));
    if (p) {
      Object.assign(p, { hasKit: true, kitSku: k.sku === p.sku ? null : k.sku, where: k.meesho ? "both" : "flipkart" });
    } else {
      on.set(skuKey(k.sku), { sku: k.sku, kitSku: null, where: k.meesho ? "meesho" : "none", live: false, hasKit: true });
    }
  }
  return [...on.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/** A folder move a person approves: `from`/`to` are relative to Downloads. */
export interface Move {
  sku: string;
  from: string;
  to: string;
}

/**
 * Which folders to move, and which folders no SKU claims.
 *
 * `find(sku)` answers where that SKU's folder is TODAY, as `<root>/<rel>` or null — the same matcher
 * the photo filing uses (`photoFolder`), tried across all three roots. Only a folder that exists and
 * is in the wrong root becomes a move; "none" (priced nowhere yet) stays wherever it is.
 */
export function planMoves(placed: Placed[], find: (sku: string) => string | null): Move[] {
  const moves: Move[] = [];
  for (const p of placed) {
    if (p.where === "none") continue;
    const from = find(p.sku) ?? (p.kitSku ? find(p.kitSku) : null);
    if (!from) continue;
    const [root, ...rel] = from.split("/");
    const want = ROOT_FOR[p.where];
    if (root !== want) moves.push({ sku: p.sku, from, to: path.posix.join(want, ...rel) });
  }
  return moves;
}

// ---------------------------------------------------------------- kept between runs

const LIVE_FILE = () => path.join(latchDir(), "flipkart-live.json");

/** The listings as of the last sync. Empty before the first one — nothing is then "on Flipkart". */
export async function readLive(): Promise<LiveListing[]> {
  return JSON.parse(await readFile(LIVE_FILE(), "utf8").catch(() => "[]"));
}

export async function writeLive(live: LiveListing[]): Promise<void> {
  await mkdir(latchDir(), { recursive: true });
  await writeFile(LIVE_FILE(), JSON.stringify(live, null, 1));
}

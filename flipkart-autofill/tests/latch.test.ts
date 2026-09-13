/**
 * latch.test.ts — the label reader turns a pack of parcel labels into the day's latch work list,
 * and every way it can be wrong is SILENT: a product missed is a product never listed, and a
 * mangled title is a search that finds the wrong catalog entry.
 *
 * The text below is a real label pack's `pdftotext -layout` output with the customer names and
 * addresses removed — the layout quirks are what is being tested, and nobody's address needs to be
 * in the repo to test them.
 *
 *   1. The QTY column sits at the end of the FIRST line, so a title that wraps has it in the
 *      MIDDLE. That is what put "Pastel 1 Balloons" in the first run's output.
 *   2. A wrapped title is one title.
 *   3. 86 labels are 39 products — a tab per label would be work already done.
 *   4. Where two labels cut a title at different lengths, the longer one wins.
 *   5. Nothing from the address block becomes a SKU.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cardState, labelKey, latchValues, matchOption, mergeFound, mergeLabels, parseLabelText, parseListed, pendingPrices, pickProduct, readLatches, searchHistory, searchPage, shareText,
  searchTerms,
  startSellingUrl,
  type LatchBook,
} from "../src/latch-core.js";

const LABELS = `
Sold By:First leap Financial Services, Dalmiya House, Asha Ram Gate ,
Lohar Chopta , Near Naya Bazaar Main Road , BHIWANI - 127021

GSTIN: 06BZTPS8436H1ZK
                    SKU ID | Description                                         QTY
1 FKUL017 | Fundots Printed Transparent Balloons with Gold                       1
  Confetti

      FMPC6479377612                                    Use Transparent Packaging

                    SKU ID | Description                                         QTY
1 FKUP005 | Partyfox Annaprashan Decoration Kit - Pastel 1
  Balloons, Cutouts

                    SKU ID | Description                                         QTY
1 FKUL017 | Fundots Printed Transparent Balloons with                            1

                    SKU ID | Description                                         QTY
1 FKUL171 | ZYRIC Solid Happy birthday black and gold                            1
`;

describe("reading a Flipkart label pack", () => {
  const items = parseLabelText(LABELS);

  it("counts products, not labels", () => {
    expect(items.map((i) => i.sku)).toEqual(["FKUL017", "FKUL171", "FKUP005"]);
    expect(items.find((i) => i.sku === "FKUL017")!.labels).toBe(2);
  });

  it("does not leave the QTY column inside a wrapped title", () => {
    expect(items.find((i) => i.sku === "FKUP005")!.description).toBe(
      "Partyfox Annaprashan Decoration Kit - Pastel Balloons, Cutouts",
    );
  });

  it("keeps the longest cut of a title, because a longer title searches better", () => {
    expect(items.find((i) => i.sku === "FKUL017")!.description).toBe(
      "Fundots Printed Transparent Balloons with Gold Confetti",
    );
  });

  it("reads nothing out of the address block", () => {
    // "Lohar Chopta , Near Naya Bazaar Main Road , BHIWANI - 127021" has no `N x |` shape, and
    // neither does the `SKU ID | Description` header itself.
    expect(items.some((i) => /BHIWANI|SKU|Description/i.test(i.sku))).toBe(false);
  });
});

/**
 * Choosing the listing. Every case below is a REAL result set off flipkart.com, because the whole
 * risk here is latching onto the wrong product — a listing that then has to be found and deleted,
 * on someone else's catalog entry.
 */
describe("picking which search result to latch onto", () => {
  it("takes the listing whose title starts with the label's", () => {
    const pick = pickProduct("Maithili decors Solid 1st Happy Birthday Baby", [
      { fsn: "BLNHFZDFCMGYS77Z", title: "Maithili decors Solid 1st Happy Birthday Super Combo/Kit Pack Material", url: "https://www.flipkart.com/x/p/itm?pid=BLNHFZDFCMGYS77Z" },
      { fsn: "BLNHH3ZA2735X2G6", title: "Maithili decors Solid 1st Happy Birthday Baby Boy Decoration Kit For Baby Boys", url: "https://www.flipkart.com/x/p/itm?pid=BLNHH3ZA2735X2G6" },
    ]);
    expect(pick.why).toBe("found");
    expect(pick.hit!.fsn).toBe("BLNHH3ZA2735X2G6");
  });

  it("refuses the best-scoring result when it is not the product", () => {
    // Both of these scored 0.83 against the label and NEITHER is it — the label's product was not
    // in the results at all. Highest-score-wins would have latched onto the Inispire2Fashion arch.
    const pick = pickProduct("Partyfox Birthday Decoration Items For Girls Pink", [
      { fsn: "BLNHZ4JHUHBQENGD", title: "Inispire2Fashion Solid Baby Girl 1st Birthday Balloon Arch Kit Balloon", url: "https://www.flipkart.com/x/p/itm?pid=BLNHZ4JHUHBQENGD" },
      { fsn: "BCBGVGTVYFUGZMTG", title: "Kapoor stores Pink Theme Birthday decoration Item for girls with Pink balloons", url: "https://www.flipkart.com/x/p/itm?pid=BCBGVGTVYFUGZMTG" },
    ]);
    expect(pick.why).toBe("none");
    expect(pick.hit).toBeNull();
    expect(pick.near).toHaveLength(2); // still shown, so it can be done by hand
  });

  it("refuses when the label was cut before the word that told two listings apart", () => {
    const pick = pickProduct("ZYRIC Solid Happy birthday black and gold", [
      { fsn: "BLNGW3PYVDUDPXBM", title: "ZYRIC Solid Happy birthday black and gold decoration kit Balloon", url: "https://www.flipkart.com/x/p/itm?pid=BLNGW3PYVDUDPXBM" },
      { fsn: "BLNGW3TFYYTWGZRR", title: "ZYRIC Solid Happy birthday black and gold balloons set Balloon", url: "https://www.flipkart.com/x/p/itm?pid=BLNGW3TFYYTWGZRR" },
    ]);
    expect(pick.why).toBe("ambiguous");
    expect(pick.hit).toBeNull();
    expect(pick.near.map((n) => n.fsn)).toEqual(["BLNGW3PYVDUDPXBM", "BLNGW3TFYYTWGZRR"]);
  });

  it("builds the latch URL Seller Lens's own button opens", () => {
    expect(startSellingUrl("BLNGW3PYVDUDPXBM")).toBe(
      "https://seller.flipkart.com/index.html#dashboard/listings/product/na" +
        "?fsn=BLNGW3PYVDUDPXBM&sourceid=SELECTION_INSIGHTS_UI",
    );
  });

  it("falls back to a shorter term, because a label cuts titles mid-word", () => {
    expect(searchTerms("Partyfox Sonic Theme Foil Balloons Set of")).toEqual([
      "Partyfox Sonic Theme Foil Balloons Set of",
      "Partyfox Sonic Theme Foil Balloons Set",
    ]);
  });
});

/**
 * The values typed into the latch form. These are money and tax fields on a live marketplace, so
 * the failure that matters is a QUIET one — a dropdown left unset, or an HSN that drifted out of
 * step with the one the 66-field bot uses.
 */
describe("what goes into the latch form", () => {
  const values = latchValues({ MRP: "999", "Your selling price": "220" });

  it("reads the same defaults file the fill bot does, not a second copy", () => {
    expect(values.get(labelKey("HSN"))).toBe("95030020");
    expect(values.get(labelKey("Tax Code"))).toBe("GST_5");
    expect(values.get(labelKey("Procurement SLA"))).toBe("2");
    // PartyDreams on Flipkart, WishWorks on Meesho — the distinction that file exists to hold.
    expect(values.get(labelKey("Manufacturer Details"))).toBe("PartyDreams");
  });

  it("matches the form's label to the file's, asterisk and all", () => {
    expect(labelKey("HSN*")).toBe(labelKey("HSN"));
    expect(labelKey("Minimum Order Quantity (MinOQ)")).toBe("minimum order quantity minoq");
    // Flipkart's own typo. The correctly spelt label matches no row on the form.
    expect(values.get(labelKey("Fullfilment by*"))).toBe("Seller");
  });

  it("takes the price off the command line, not the file", () => {
    expect(values.get(labelKey("MRP"))).toBe("999");
    expect(values.get(labelKey("Your selling price"))).toBe("220");
  });

  it("finds a dropdown option whose case does not match the defaults file", () => {
    // The file says `Express`; Flipkart's option is `express`. Exact matching left Procurement
    // type — a required field — silently unset.
    expect(matchOption("Express", ["Select One", "instock", "express"])).toBe("express");
    expect(matchOption("Seller", ["Select One", "Seller"])).toBe("Seller");
    expect(matchOption("Courier", ["Select One", "Flipkart"])).toBeNull();
  });
});

/**
 * Reading Flipkart's answer off the catalog card. All three class strings below were copied from
 * the live account — the first version of this tool knew only one of them and reported the other
 * two as "could not open the form", which is a bug report about three products that were fine.
 */
describe("what the catalog card is telling us", () => {
  it("knows a latchable product", () => {
    expect(cardState("startSelling listingsModalLink  width-50-pr  ")).toBe("form");
  });

  it("knows one this account already sells", () => {
    expect(cardState("disabled startSelling  width-50-pr ")).toBe("selling");
  });

  it("knows a vertical this account is not approved for", () => {
    expect(cardState("applyForApprovalLink startSelling")).toBe("approval");
  });

  it("does not read `disabled` out of another word", () => {
    // `startSelling listingsModalLink` must not become "selling" because some class contains the
    // letters — the states are one substring apart and the wrong one skips a real latch.
    expect(cardState("startSelling listingsModalLink notdisabledish")).toBe("form");
  });
});

/**
 * The work list on disk. The rule it exists to keep is the manifest's: **dropping the same pack
 * twice must change nothing.** Getting that wrong is invisible — the list still looks right, it
 * just claims a product shipped twice as often as it did, and that ordering is what decides which
 * ones get latched first.
 */
describe("folding a label pack into the list already on file", () => {
  const empty = { packs: [], rows: [] };
  const pack = [
    { sku: "FKUL451", description: "ballooooify Solid Royal Rose Gold", labels: 11 },
    { sku: "FKUP015", description: "Partyfox Birthday Decoration Items", labels: 9 },
  ];

  it("adds everything the first time", () => {
    const { book, added } = mergeLabels(empty, pack, "sept.pdf", "2026-09-13");
    expect(added).toBe(2);
    expect(book.rows.map((r) => r.sku)).toEqual(["FKUL451", "FKUP015"]); // best-seller first
    expect(book.rows[0].state).toBe("unknown");
    expect(book.packs).toEqual([{ file: "sept.pdf", addedOn: "2026-09-13", skus: ["FKUL451", "FKUP015"] }]);
  });

  it("adds nothing, and counts nothing twice, the second time", () => {
    const once = mergeLabels(empty, pack, "sept.pdf", "2026-09-13").book;
    const twice = mergeLabels(once, pack, "sept.pdf", "2026-09-14");
    expect(twice.added).toBe(0);
    expect(twice.book.rows.find((r) => r.sku === "FKUL451")!.seen).toBe(11);
    // One pack, not two: the filename is its identity, so a re-read replaces rather than piles up.
    expect(twice.book.packs).toHaveLength(1);
    expect(twice.book.packs[0].addedOn).toBe("2026-09-14");
  });

  it("keeps packs newest first, which is the order the screen offers them in", () => {
    let book = mergeLabels(empty, pack, "august.pdf", "2026-08-30").book;
    book = mergeLabels(book, pack, "september.pdf", "2026-09-13").book;
    expect(book.packs.map((p) => p.file)).toEqual(["september.pdf", "august.pdf"]);
  });

  it("keeps what Flipkart told us, and the day we latched it", () => {
    const before = mergeLabels(empty, pack, "a.pdf", "2026-09-13").book;
    before.rows = before.rows.map((r) =>
      r.sku === "FKUP015"
        ? { ...r, state: "selling" as const, fsn: "BCBHNG7C", checkedOn: "2026-09-13", latchedOn: "2026-09-13" }
        : r,
    );
    const after = mergeLabels(before, pack, "b.pdf", "2026-09-14").book.rows.find((r) => r.sku === "FKUP015")!;
    expect(after.state).toBe("selling");
    expect(after.fsn).toBe("BCBHNG7C");
    expect(after.latchedOn).toBe("2026-09-13");
  });

  it("re-opens a product a longer title might now find", () => {
    // "Couldn't find it" was a conclusion about a SHORTER title. A pack that cut the same title
    // less short is new evidence, and leaving the old verdict would bury the product for good.
    const before = mergeLabels(empty, pack, "a.pdf", "2026-09-13").book;
    before.rows = before.rows.map((r) => ({ ...r, state: "none" as const }));
    const after = mergeLabels(before, [
      { sku: "FKUL451", description: "ballooooify Solid Royal Rose Gold Pink White", labels: 11 },
    ], "b.pdf", "2026-09-14").book.rows.find((r) => r.sku === "FKUL451")!;
    expect(after.state).toBe("unknown");
    expect(after.description).toBe("ballooooify Solid Royal Rose Gold Pink White");
  });
});


/**
 * Reading the file written before packs existed. There is a real one on Vansh's disk with 39
 * products in it — a day of checking against Flipkart — and the shape changed underneath it.
 * Discarding that is not a migration, it is silently making him do the work again.
 */
describe("the file the first version wrote", () => {
  it("reads a bare array as a book with no packs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "latch-"));
    process.env.WW_LATCH_DIR = dir;
    writeFileSync(
      path.join(dir, "latches.json"),
      JSON.stringify([
        { sku: "FKUL451", description: "x", seen: 11, fsn: "B1", title: "X", state: "selling", checkedOn: "2026-09-13" },
      ]),
    );
    const book = await readLatches();
    expect(book.packs).toEqual([]);
    expect(book.rows).toHaveLength(1);
    expect(book.rows[0].state).toBe("selling"); // the day's checking survives
  });
});

/**
 * Reading a competitor's price off a search card. This is the number our own price is set against
 * — Vansh's rule is to come in at or under the seller we latched from — so a misread MRP is a
 * margin decision made on a wrong figure, and nothing on screen would look wrong.
 */
describe("what the other seller charges", () => {
  it("splits price, MRP and discount when they run together", () => {
    // ₹349 at 57% off is ₹150, near enough to ₹147. ₹3495 at 7% off would be ₹3250 — not it.
    expect(parseListed("₹147₹34957% off")).toEqual({ pricePaise: 14700, mrpPaise: 34900 });
  });

  it("handles a thousands comma and a two-digit discount", () => {
    expect(parseListed("₹253₹1,49983% off")).toEqual({ pricePaise: 25300, mrpPaise: 149900 });
  });

  it("takes the price alone when there is no struck-through MRP", () => {
    expect(parseListed("₹194")).toEqual({ pricePaise: 19400, mrpPaise: null });
  });

  it("is null for a card with no price", () => {
    expect(parseListed("Sponsored")).toBeNull();
  });

  it("does not invent an MRP below the asking price", () => {
    // A split that makes the "MRP" cheaper than the price is arithmetic nonsense, not a discount.
    expect(parseListed("₹500₹10050% off")?.mrpPaise).toBeNull();
  });
});

/**
 * Sweeping a search. The sweep itself needs a browser, but the two decisions that can quietly go
 * wrong do not: which page of results to ask for, and what a sweep is allowed to overwrite.
 */
describe("sweeping a search term", () => {
  it("asks for page 2 without mangling page 1", () => {
    expect(searchPage("party decoration", 1)).toBe("https://www.flipkart.com/search?q=party%20decoration");
    expect(searchPage("party decoration", 2)).toBe("https://www.flipkart.com/search?q=party%20decoration&page=2");
  });

  it("names a swept product by its FSN, because nobody gave us a SKU for it", () => {
    const { book, added } = mergeFound(
      { packs: [], rows: [] },
      [{ fsn: "BLNH1", title: "Some kit", url: "u", listed: { pricePaise: 19000, mrpPaise: 99900 }, state: "form" }],
      "party decoration",
      "2026-09-13",
    );
    expect(added).toBe(1);
    expect(book.rows[0].sku).toBe("BLNH1");
    // A sweep is not a sales signal: nobody shipped this past us, so it must not claim they did.
    expect(book.rows[0].seen).toBe(0);
    expect(book.packs[0].file).toBe("search: party decoration · 2026-09-13");
  });

  it("refreshes price and state, but never forgets a latch that happened", () => {
    const before: LatchBook = {
      packs: [],
      rows: [{
        sku: "BLNH1", description: "Some kit", seen: 0, fsn: "BLNH1", title: "Some kit",
        state: "form", checkedOn: "2026-09-01", latchedOn: "2026-09-01",
        listed: { pricePaise: 22000, mrpPaise: null },
      }],
    };
    const after = mergeFound(before, [
      { fsn: "BLNH1", title: "Some kit", url: "u", listed: { pricePaise: 18000, mrpPaise: null }, state: "selling" },
    ], "party decoration", "2026-09-13").book;
    expect(after.rows[0].listed!.pricePaise).toBe(18000); // they dropped their price; that is news
    expect(after.rows[0].state).toBe("selling");
    expect(after.rows[0].latchedOn).toBe("2026-09-01"); // it still happened
  });
});

/**
 * The message a partner gets. It is read on a phone, by somebody who was not here and who has his
 * OWN seller account — so the two failures that matter are sending him a filtered list he cannot
 * judge from, and letting our account's answers read as facts about the products.
 */
describe("telling a partner what we found", () => {
  const book: LatchBook = {
    packs: [{ file: "search: party decoration", addedOn: "2026-09-13", skus: ["A", "B", "C"] }],
    rows: [
      { sku: "A", description: "a", seen: 0, fsn: "A", title: "Cheap kit", state: "form", checkedOn: null,
        listed: { pricePaise: 30000, mrpPaise: null } },
      { sku: "B", description: "b", seen: 0, fsn: "B", title: "Dear kit", state: "form", checkedOn: null,
        listed: { pricePaise: 19000, mrpPaise: null } },
      { sku: "C", description: "c", seen: 0, fsn: "C", title: "Already ours", state: "selling", checkedOn: null },
    ],
  };

  it("sends everything, grouped — not only what we can latch", () => {
    // The first version sent the latchable ones alone. A partner cannot tell a thin category from
    // a thorough one without the rest, and it is his call what is useful.
    const text = shareText(book, null, 220_00);
    expect(text).toContain("CAN LATCH (2)");
    expect(text).toContain("WE ALREADY SELL THESE (1)");
    expect(text).toContain("Already ours");
    expect(text).toContain("3 products");
  });

  it("says the states are ours, because his account will answer differently", () => {
    const text = shareText(book, null, 220_00);
    expect(text).toContain("answers for OUR seller account");
    expect(text).toContain("on your account they may come out differently");
  });

  it("flags a dearer price without dropping the product", () => {
    const text = shareText(book, null, 220_00);
    expect(text).toContain("Dear kit");
    expect(text).toContain("worth a look, not a no");
  });

  it("says which side of their price we land on", () => {
    const text = shareText(book, null, 220_00);
    expect(text).toMatch(/Cheap kit.*they: ₹300.*us: ₹220 \(-₹80\)/);
    expect(text).toMatch(/Dear kit.*they: ₹190.*us: ₹220 \(\+₹30 DEARER\)/);
  });

  it("names which list it is — all, today's hunt, or today's label", () => {
    expect(shareText(book, "search: party decoration", 220_00)).toContain("search: party decoration (2026-09-13)");
    expect(shareText(book, null, 220_00)).toContain("everything on file");
  });

  it("says so plainly when there is nothing to send", () => {
    expect(shareText({ packs: [], rows: [] }, null, 220_00)).toBe("Nothing on file for everything on file.");
  });
});

/**
 * Packs, and the history of what has been hunted. Two failures matter here and both are quiet: a
 * second hunt wiping out the first one's findings, and two hunts months apart collapsing into one
 * so nobody can tell what was looked at when.
 */
describe("keeping track of what has been hunted", () => {
  const found = (fsn: string) => ({ fsn, title: fsn, url: "u", listed: null, state: "form" as const });

  it("continues a hunt rather than replacing it", () => {
    // Vansh stops a sweep, or it runs out of clock, and runs it again the same day. The second
    // pass must ADD to the first, not throw it away.
    let book = mergeFound({ packs: [], rows: [] }, [found("A"), found("B")], "party decoration", "2026-09-13").book;
    book = mergeFound(book, [found("C")], "party decoration", "2026-09-13").book;
    expect(book.packs).toHaveLength(1);
    expect(book.packs[0].skus.sort()).toEqual(["A", "B", "C"]);
  });

  it("keeps the same term on two days as two hunts", () => {
    let book = mergeFound({ packs: [], rows: [] }, [found("A")], "party decoration", "2026-09-13").book;
    book = mergeFound(book, [found("B")], "party decoration", "2026-11-01").book;
    expect(book.packs.map((p) => p.file)).toEqual([
      "search: party decoration · 2026-11-01",
      "search: party decoration · 2026-09-13",
    ]);
  });

  it("lists what has already been searched, newest first", () => {
    let book = mergeFound({ packs: [], rows: [] }, [found("A")], "party decoration", "2026-09-13").book;
    book = mergeFound(book, [found("B"), found("C")], "birthday balloons", "2026-11-01").book;
    expect(searchHistory(book)).toEqual([
      { term: "birthday balloons", on: "2026-11-01", found: 2 },
      { term: "party decoration", on: "2026-09-13", found: 1 },
    ]);
  });

  it("does not call a label pack a search", () => {
    const book = mergeLabels({ packs: [], rows: [] }, [{ sku: "X", description: "x", labels: 1 }], "labels.pdf", "2026-09-13").book;
    expect(searchHistory(book)).toEqual([]);
  });
});

/**
 * The buffer: what we latched but have not priced. The two halves of the job happen days apart —
 * the latch is a minute, the costing waits on a photo, a ChatGPT reply and a human checking it —
 * so anything that falls through here is a LIVE listing sitting at the default ₹220 forever.
 */
describe("what we latched but have not priced", () => {
  const book: LatchBook = {
    packs: [{ file: "labels.pdf", addedOn: "2026-09-13", skus: ["R1", "R2", "R3"] }],
    rows: [
      { sku: "R1", description: "One", seen: 1, fsn: "F1", title: "One", state: "form",
        checkedOn: "2026-09-13", latchedOn: "2026-09-13", ourSku: "ANP001" },
      { sku: "R2", description: "Two", seen: 1, fsn: "F2", title: "Two", state: "form",
        checkedOn: "2026-09-13", latchedOn: "2026-09-13", ourSku: "ANP002" },
      { sku: "R3", description: "Three", seen: 1, fsn: "F3", title: "Three", state: "form",
        checkedOn: "2026-09-13", latchedOn: "2026-09-13" },
      { sku: "R4", description: "Never latched", seen: 1, fsn: "F4", title: "Four", state: "form",
        checkedOn: "2026-09-13" },
    ],
  };

  it("drops the ones whose price somebody has signed off", () => {
    const p = pendingPrices(book, new Set(["ANP001", "ANP002"]), new Set(["ANP001"]));
    // Newest latch first, then by title — "Three" before "Two".
    expect(p.map((r) => r.fsn)).toEqual(["F3", "F2"]);
  });

  it("says WHICH thing is missing, because each needs a different action", () => {
    const p = pendingPrices(book, new Set(["ANP002"]), new Set());
    // ANP001 is latched but has no costing at all; R3 has no SKU so we cannot even look one up.
    expect(p.find((r) => r.fsn === "F1")!.why).toBe("none");
    expect(p.find((r) => r.fsn === "F2")!.why).toBe("unconfirmed");
    expect(p.find((r) => r.fsn === "F3")!.why).toBe("no-sku");
  });

  it("ignores products we never latched", () => {
    expect(pendingPrices(book, new Set(), new Set()).some((r) => r.fsn === "F4")).toBe(false);
  });

  it("traces each one back to the pack it came from", () => {
    expect(pendingPrices(book, new Set(), new Set())[0].from).toEqual(["labels.pdf"]);
  });
});

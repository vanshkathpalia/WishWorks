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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  approvedBrands, blocking, cardState, forMeesho, imageJobs, labelKey, markMeesho, nextBatch, latchValues, matchOption, mergeFound, mergeLabels, parseApprovals, parseLabelText, parseListed, pendingPrices, riskOf, pickProduct, readLatches, searchHistory, searchPage, shareText, survivors, toPause, weSell,
  searchTerms,
  startSellingUrl,
  type LatchBook,
  type LatchRecord,
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
 * The buffer, and the order it comes in. A latched listing is LIVE — it can take an order tonight
 * — so the list is sorted by what being caught out would COST, not by when it was latched. The
 * failure that matters: a kit we cannot pack sitting below one that merely needs a price signed.
 */
describe("what we latched but have not priced", () => {
  const ok = { costed: true, confirmed: true, unmatched: 0, flagged: 0, lines: 5, short: [] };
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

  it("puts a kit we cannot pack above everything else", () => {
    // ANP002 is fully costed and signed off — and we have none of one of its materials. That
    // outranks ANP001, which is merely uncosted, because only one of them ends in a cancellation.
    const p = pendingPrices(book, new Map([
      ["ANP002", { ...ok, short: ["Red Fringes"] }],
    ]));
    expect(p[0].ourSku).toBe("ANP002");
    expect(p[0].reasons[0]).toContain("no stock of Red Fringes");
    expect(p[0].risk).toBeGreaterThan(p[1].risk);
  });

  it("drops the ones that are costed, confirmed and in stock", () => {
    const p = pendingPrices(book, new Map([["ANP001", ok], ["ANP002", ok]]));
    expect(p.map((r) => r.fsn)).toEqual(["F3"]); // only the one with no SKU is left
  });

  it("keeps a confirmed kit in the list when we have none of its materials", () => {
    // Signed off is not safe. The price is right and we still cannot pack it.
    const p = pendingPrices(book, new Map([["ANP001", { ...ok, short: ["Gold Foil"] }], ["ANP002", ok]]));
    expect(p.map((r) => r.ourSku)).toContain("ANP001");
  });

  it("says WHICH thing is missing, because each needs a different action", () => {
    const p = pendingPrices(book, new Map([["ANP002", { ...ok, confirmed: false }]]));
    expect(p.find((r) => r.fsn === "F1")!.why).toBe("none");
    expect(p.find((r) => r.fsn === "F2")!.why).toBe("unconfirmed");
    expect(p.find((r) => r.fsn === "F3")!.why).toBe("no-sku");
  });

  it("scores a loose match by how much of the kit is guesswork", () => {
    // "feroggi color balloon" matches "balloon" — a kit held together by those is a kit whose
    // materials list is a guess, and a guess cannot be shopped from.
    const few = riskOf({ ...ok, confirmed: false, flagged: 1, lines: 10 });
    const most = riskOf({ ...ok, confirmed: false, flagged: 9, lines: 10 });
    expect(most.risk).toBeGreaterThan(few.risk);
    expect(most.reasons.some((r) => r.includes("9 of 10"))).toBe(true);
  });

  it("treats a line on no price row as a material we may never have bought", () => {
    const r = riskOf({ ...ok, confirmed: false, unmatched: 2 });
    expect(r.reasons.some((x) => x.includes("never bought"))).toBe(true);
  });

  it("ignores products we never latched", () => {
    expect(pendingPrices(book, new Map()).some((r) => r.fsn === "F4")).toBe(false);
  });

  it("traces each one back to the pack it came from", () => {
    expect(pendingPrices(book, new Map())[0].from).toEqual(["labels.pdf"]);
  });
});

/**
 * Reading the approvals table. The text below is the live page's own `innerText` with the account's
 * rows in it. Anchoring on the nine-digit request id is the point: the table is styled-components
 * divs whose classes change each deploy, and a pending row has one line fewer than an approved one.
 */
describe("brands we have been approved for", () => {
  const PAGE = `Connect with Buyers
Approval Requests
Action Required
0
Pending
0
Approved
12
All Requests
Request ID
Brand
Vertical
Comments
Updated At
Status
642434773
tigorik
Balloon
-
Sep 9, 2026 1:27 PM
Approved
Add Listings
642427672
Partymash
Birthday Combo
-
Sep 9, 2026 11:54 AM
Approved
Add Listings
639173165
Maithili decors
Decoration
-
Aug 28, 2026 11:31 AM
Pending`;

  it("reads a row without touching the markup", () => {
    const rows = parseApprovals(PAGE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      id: "642434773", brand: "tigorik", vertical: "Balloon",
      status: "Approved", updatedAt: "Sep 9, 2026 1:27 PM",
    });
  });

  it("reads a pending row too, which has no Add Listings line", () => {
    // Fields are counted FORWARD from the id for exactly this reason — the action column is last
    // and is missing on a pending row, so counting backwards would shift every field.
    expect(parseApprovals(PAGE)[2]).toMatchObject({ brand: "Maithili decors", status: "Pending" });
  });

  it("does not mistake the counts at the top of the page for rows", () => {
    expect(parseApprovals(PAGE).some((r) => r.brand === "12")).toBe(false);
  });

  it("picks out only what we may actually list", () => {
    expect(approvedBrands(parseApprovals(PAGE)).map((a) => a.brand)).toEqual(["tigorik", "Partymash"]);
  });
});

/**
 * The trade rail. A sweep runs unattended for an hour, so the thing that must not happen is it
 * spending that hour on a category we do not sell — which is exactly what it did on 2026-09-13,
 * returning 146 "latchable" Tata Tigor car covers from the approved brand `tigorik`.
 */
describe("only hunting what we actually sell", () => {
  it("rejects the car covers that started this", () => {
    expect(weSell("carphoenix Car Cover For Tata Tigor (Without Mirror Pockets)")).toBe(false);
    expect(weSell("RKPSP 2 Ton Car Hydraulic Trolley Jack For Tigor Vehicle Jack")).toBe(false);
    expect(weSell("RKPSP Waterproof/HD/Night Vision Reverse Assist Camera System")).toBe(false);
  });

  it("keeps what we do sell, from the same sweep", () => {
    expect(weSell("tigorik Solid Happy Birthday Banner Decoration 51 pcs Balloon")).toBe(true);
    expect(weSell("tigorik Royal Burgundy Bliss Birthday Arch")).toBe(true);
    expect(weSell("Partyfox Annaprashan Decoration Kit - Pastel Balloons, Cutouts")).toBe(true);
    expect(weSell("ZYOZIQUE Multicolor Rice Ceremony Decorations Items- Banner")).toBe(true);
  });

  it("is generous, because a false no loses a product forever", () => {
    // One page load is the cost of a false yes. A product never opened is one never listed.
    expect(weSell("Some Brand Wedding Photo Booth Props Set of 20")).toBe(true);
    expect(weSell("Some Brand Haldi Ceremony Backdrop")).toBe(true);
  });
});

/**
 * Pausing. **A paused listing costs the sales it would have made; a cancelled order costs account
 * health** — Flipkart's, which is the thing that cannot be bought back. So the list of what to take
 * down before the van arrives is its own answer, and it is NOT the same list as "needs a price".
 */
describe("what to pause until the delivery lands", () => {
  const base = {
    fsn: "F", title: "T", ourSku: "ANP001", from: [], latchedOn: "2026-09-13",
    listed: null, why: "unconfirmed" as const, risk: 0, reasons: [],
  };

  it("is exactly the ones short of a material", () => {
    const p = toPause([
      { ...base, fsn: "F1", ourSku: "A", short: ["Red Fringes"] },
      { ...base, fsn: "F2", ourSku: "B", short: [] },
    ]);
    expect(p.map((r) => r.fsn)).toEqual(["F1"]);
  });

  it("includes a kit whose price is signed off — that one is the most dangerous", () => {
    // Every other screen calls this listing finished. It is live, correctly priced, and unpackable.
    const p = toPause([{ ...base, fsn: "F3", ourSku: "C", why: "unconfirmed", short: ["Gold Foil"] }]);
    expect(p).toHaveLength(1);
  });

  it("groups by material, most listings blocked first — that is one phone call", () => {
    const rows = [
      { ...base, fsn: "F1", ourSku: "A", short: ["Gold Foil", "Red Fringes"] },
      { ...base, fsn: "F2", ourSku: "B", short: ["Gold Foil"] },
      { ...base, fsn: "F3", ourSku: "C", short: ["Gold Foil"] },
    ];
    expect(blocking(rows)).toEqual([
      { material: "Gold Foil", skus: ["A", "B", "C"] },
      { material: "Red Fringes", skus: ["A"] },
    ]);
  });

  it("says nothing when everything can be packed", () => {
    expect(blocking([{ ...base, short: [] }])).toEqual([]);
  });
});

/**
 * Look before latching. Sixty latchable products are not sixty worth selling, so a batch of ten is
 * opened as shopper pages and CLOSING a tab is the "no". Two things must hold or the review is
 * worse than useless: the user's own tabs must not count as approval, and a product he closed must
 * not come back in the next ten.
 */
describe("reviewing a batch before listing it", () => {
  const batch = ["F1", "F2", "F3"];

  it("keeps only the ones still open, in the order they were shown", () => {
    const open = [
      "https://www.flipkart.com/some-kit/p/itm9?pid=F3&lid=L",
      "https://www.flipkart.com/other-kit/p/itm1?pid=F1",
    ];
    expect(survivors(batch, open)).toEqual(["F1", "F3"]);
  });

  it("ignores every other tab in Chrome", () => {
    // WhatsApp, the seller dashboard, a manifest, and someone else's product page. None of these
    // is a decision about this batch.
    const open = [
      "https://web.whatsapp.com/",
      "https://seller.flipkart.com/index.html#dashboard",
      "https://www.flipkart.com/unrelated/p/itm2?pid=ZZZZZZZZZZZZZZZZ",
      "about:blank",
    ];
    expect(survivors(batch, open)).toEqual([]);
  });

  it("counts a product once however many tabs show it", () => {
    const open = ["https://www.flipkart.com/a/p/i?pid=F2", "https://www.flipkart.com/a/p/i?pid=F2&x=1"];
    expect(survivors(batch, open)).toEqual(["F2"]);
  });

  it("offers ten at a time, skipping what was already turned down", () => {
    const rows = ["A", "B", "C", "D"].map((f) => ({
      sku: f, description: f, seen: 0, fsn: f, title: f, state: "form" as const, checkedOn: null,
    }));
    const book = { packs: [], rows };
    expect(nextBatch(book, 2).map((r) => r.fsn)).toEqual(["A", "B"]);
    expect(nextBatch(book, 2, new Set(["A"])).map((r) => r.fsn)).toEqual(["B", "C"]);
  });

  it("never offers something already latched", () => {
    const book = {
      packs: [],
      rows: [
        { sku: "A", description: "A", seen: 0, fsn: "A", title: "A", state: "form" as const,
          checkedOn: null, latchedOn: "2026-09-13" },
        { sku: "B", description: "B", seen: 0, fsn: "B", title: "B", state: "form" as const, checkedOn: null },
      ],
    };
    expect(nextBatch(book, 10).map((r) => r.fsn)).toEqual(["B"]);
  });
});

/**
 * **The latch flow never submits a listing.** Vansh, 2026-09-13: *"but yet not submit the latch
 * listing — i will still verify it."*
 *
 * Every field is filled, including the SKU, and then it stops: a human reads the form and presses
 * Save. That is not a missing feature, it is the feature — a latch puts a live product on the
 * account, and the one thing this tool must never do is put one there unseen.
 *
 * Asserted against the SOURCE, which is unusual and deliberate. The behaviour being protected is
 * the ABSENCE of a call, and absence is what a normal test cannot observe: a test that drives the
 * form and checks nothing saved passes just as happily when the save silently failed. One day
 * somebody will reach for `clickSave` to "finish the job"; this is what tells them not to.
 */
describe("the latch flow stops before Save", () => {
  const source = readFileSync(new URL("../src/latch-core.ts", import.meta.url), "utf8");

  it("never calls the thing that presses Flipkart's Save", () => {
    expect(source).not.toMatch(/\bclickSave\b/);
  });

  it("never presses Enter on a Flipkart page", () => {
    // `chat-core` presses Enter to send a ChatGPT prompt. Nothing in the latch path may.
    expect(source).not.toMatch(/keyboard\.press\(\s*["'`]Enter/);
  });

  it("never clicks a submit control", () => {
    expect(source).not.toMatch(/type=submit|\[type="submit"\]/);
  });
});

/**
 * The Meesho queue. A latch is half the job: the same product sells on both marketplaces, and
 * Meesho has no catalog to attach to — it is a bulk sheet and an image upload, done in batches.
 * The failure this prevents is the quiet one: a product latched three weeks ago that nobody ever
 * put on Meesho, which is three weeks of sales not taken and nothing on screen to say so.
 */
describe("what is waiting to go on Meesho", () => {
  const row = (sku: string, latchedOn: string, extra: Partial<LatchRecord> = {}): LatchRecord => ({
    sku: `R${sku}`, description: sku, seen: 0, fsn: `F${sku}`, title: sku,
    state: "form", checkedOn: null, latchedOn, ourSku: sku, ...extra,
  });

  const book: LatchBook = {
    packs: [],
    rows: [
      row("ANP018", "2026-09-13"),
      row("ANP017", "2026-08-20"),
      row("ANP016", "2026-09-01", { meeshoOn: "2026-09-02" }),
      { ...row("ANP015", "2026-09-01"), ourSku: undefined },
      { ...row("ANP014", "2026-09-01"), latchedOn: undefined },
    ],
  };

  it("takes only what is latched, has our SKU, and is not done yet", () => {
    expect(forMeesho(book).map((r) => r.ourSku)).toEqual(["ANP017", "ANP018"]);
  });

  it("puts the longest wait first, unlike the price queue", () => {
    // Oldest first on purpose: here the question is what has been waiting, not what is riskiest.
    expect(forMeesho(book)[0].ourSku).toBe("ANP017");
  });

  it("leaves out a row with no SKU of ours, which is not ready to prepare", () => {
    expect(forMeesho(book).some((r) => r.title === "ANP015")).toBe(false);
  });

  it("marking a batch takes it out of the next one", () => {
    const after = markMeesho(book, ["ANP017"], "2026-09-14");
    expect(forMeesho(after).map((r) => r.ourSku)).toEqual(["ANP018"]);
    expect(after.rows.find((r) => r.ourSku === "ANP017")!.meeshoOn).toBe("2026-09-14");
  });
});

/**
 * Which latched products can have their images made. Four prompts is minutes of somebody else's
 * compute, so the point is to find out what would fail BEFORE spending it — and to say why, rather
 * than quietly dropping the row.
 */
describe("what qualifies for the image run", () => {
  const row = (sku: string, extra: Partial<LatchRecord> = {}): LatchRecord => ({
    sku, description: sku, seen: 0, fsn: `F${sku}`, title: `${sku} kit`,
    state: "form", checkedOn: null, latchedOn: "2026-09-13", ourSku: `ANP${sku}`, ...extra,
  });
  const book: LatchBook = {
    packs: [],
    rows: [
      row("001"),
      row("002"),
      row("003", { ourSku: undefined }),
      row("004", { latchedOn: undefined }),
    ],
  };
  const jobs = (photos: string[], have: Record<string, number> = {}) =>
    imageJobs(book, {
      photoFor: (s) => (photos.includes(s) ? `/latch/images/${s}.jpg` : null),
      haveFor: (s) => have[s] ?? 0,
    });

  it("is only what we latched", () => {
    expect(jobs(["001", "002", "004"]).some((j) => j.sku === "004")).toBe(false);
  });

  it("says why a product cannot run, instead of hiding it", () => {
    // One download away from ready. Filtering it out means nobody notices the download never
    // happened, and the product sits there for ever.
    const all = jobs(["001"]);
    expect(all.find((j) => j.sku === "002")!.blockedBy).toEqual([
      "no contents photo — it was never downloaded",
    ]);
    expect(all.find((j) => j.sku === "003")!.blockedBy).toEqual(["no SKU of ours yet"]);
  });

  it("puts what can run first, and what has nothing yet before what is part done", () => {
    const all = jobs(["001", "002"], { ANP001: 2 });
    expect(all.map((j) => j.sku)).toEqual(["002", "001", "003"]);
  });

  it("reports what is already there, so a finished one is not re-run by accident", () => {
    // Four prompts again, overwriting images somebody may already have corrected by hand.
    expect(jobs(["001"], { ANP001: 3 }).find((j) => j.sku === "001")!.have).toBe(3);
  });
});

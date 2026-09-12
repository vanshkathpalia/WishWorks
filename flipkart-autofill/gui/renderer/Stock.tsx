/**
 * Stock.tsx — the raw material in the building, and what is about to run out.
 *
 * **Two lists of the same delivery, in two people's handwriting.** The supplier sends his claim,
 * Vansh counts the boxes and writes his own, and the job this removes is comparing them by eye —
 * *"i will verify and send you the list… we shall tally, flagging the maybe meaning the same
 * thing, and eventually at final mismatch too I should be able to edit."*
 *
 * Three things it will not do, each a deliberate choice:
 *
 * - **It does not match names itself.** That is `candidates`/`score` from the costing panel, the
 *   same matcher against the same 121-row price list, with the same three bands and the same
 *   escape hatch. A second matcher would be a second opinion about which material this is.
 * - **It does not store a stock level.** On-hand is deliveries minus what the packing used, and
 *   both halves are already facts we hold. A stored total is a second answer to a question that
 *   has one, which this repo has been bitten by twice (C-049, C-061).
 * - **It does not decide anything a person can see better.** Every flagged row is a dropdown, the
 *   counted number stays editable, and a pick is remembered so the next delivery matches itself.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CallLine, Delivery, OnHand, TallyRow } from "../shared.js";
import { Fold, MaterialPicker } from "./ui.js";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type MaterialRow = { key: string; name: string; category: string };

/**
 * How confident the match is, in a word — the same three bands the costing panel uses.
 *
 * The point of showing it at all is that *no row matched* and *a row matched loosely* are different
 * problems with different fixes, and a screen that showed both as blank would get one of them
 * silently wrong. `sure` rows are the ones nobody needs to look at.
 */
function Band({ row }: { row: TallyRow }) {
  if (row.overridden) return <span className="pill">you picked this</span>;
  if (row.key === null) return <span className="pill bad">not on the list</span>;
  if (row.score < 0.85) return <span className="pill warn">check this — {Math.round(row.score * 100)}%</span>;
  return <span className="muted">matched</span>;
}

/**
 * Which group a not-on-the-list name probably belongs in.
 *
 * The matcher already found the closest rows; the closest one's group is a far better default than
 * blank — *green peanut banner* has no row but its nearest is a Banner. It is only a DEFAULT: the
 * picker beside it is what decides, and a wrong group is now fixable in place anyway.
 */
const guessGroup = (r: TallyRow): string => r.choices[0]?.material.category ?? "";

/**
 * A value kept in the browser across restarts — the ticks and typed quantities on the supplier call.
 *
 * Deliberately NOT a file in the account's folder: a line ticked off is a decision about this one
 * call, not a fact about the business, and the list itself is re-derived from the shelf every time
 * so there is nothing here that can go stale into a wrong number.
 */
function remembered<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(name);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback; // storage off, or something else wrote junk under this name
  }
}

/**
 * The next order to place with the supplier — the whole point of keeping a shelf at all.
 *
 * Vansh, 2026-09-12: *"you will maintain the next call order list I send to my supplier — the stuff
 * you think is under 30% and should be ordered more, and how much… also these new SKU listings have
 * undelivered products, those should be in the maintained order call too."*
 *
 * **Two lists, not one, because they are answers to different questions.** The top half is arithmetic
 * — a rate, a shelf, and a quantity that follows from them. The bottom half is a gap in the records:
 * a material a costed kit is built on that no delivery note carries. Merging them would put a
 * confident number next to a thing nobody has ever counted.
 *
 * **Nothing here is stored.** The list is re-derived from the shelf and the kits every time, so it
 * cannot go stale the way a saved shopping list does. What IS remembered is only his edits on top —
 * lines he ticked off and quantities he overrode — in the browser, per material, because a decision
 * to skip something is about THIS call and not a fact about the business.
 */
function NextCall({
  call,
  untallied,
  coverWeeks,
  thin,
}: {
  call: CallLine[];
  /** Materials the packing has eaten that no note accounts for — a records gap, never an order. */
  untallied: { key: string; name: string; pieces: number }[];
  coverWeeks: number;
  thin: number;
}) {
  /** Material keys ticked OFF this call. Kept in the browser: it is about this call, not the shelf. */
  const [skip, setSkip] = useState<string[]>(() => remembered<string[]>("ww.call.skip", []));
  /** His own quantity, in whatever unit the line is counted in, overriding the worked-out one. */
  const [qty, setQty] = useState<Record<string, string>>(() => remembered<Record<string, string>>("ww.call.qty", {}));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("ww.call.skip", JSON.stringify(skip));
      localStorage.setItem("ww.call.qty", JSON.stringify(qty));
    } catch {
      // A browser with storage off loses the ticks on reload and nothing else. Not worth a warning.
    }
  }, [skip, qty]);

  const low = call.filter((l) => l.why !== "untried");
  const gap = call.filter((l) => l.why === "untried");
  const on = (l: CallLine) => !skip.includes(l.key);
  const toggle = (k: string) =>
    setSkip((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  /** What he actually asks for: his number if he typed one, the worked-out one otherwise. */
  const asking = (l: CallLine) => {
    const typed = Number(qty[l.key]);
    const n = qty[l.key] !== undefined && qty[l.key] !== "" && !Number.isNaN(typed) ? typed : (l.packs ?? l.pieces);
    return { n, unit: l.packs !== null ? "pkt" : "pcs" };
  };

  /**
   * The order as plain text, ready to paste into WhatsApp.
   *
   * Built here rather than in the engine because the engine cannot see the two things that make
   * this HIS order: the lines he ticked off, and the quantities he changed. A list that can only be
   * screenshotted is not an order.
   */
  const text = () =>
    call
      .filter(on)
      .map((l, i) => {
        const { n, unit } = asking(l);
        return `${i + 1}. ${l.name} — ${n} ${unit}`;
      })
      .join("\n");

  async function copy() {
    await navigator.clipboard.writeText(text());
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  const Qty = ({ l }: { l: CallLine }) => {
    const { n, unit } = asking(l);
    return (
      <span className="ask">
        <input
          type="number"
          min={0}
          value={qty[l.key] ?? String(n)}
          onChange={(e) => setQty({ ...qty, [l.key]: e.target.value })}
        />
        {unit}
        {/* Both units, always: a packet is what he orders and a piece is what the shelf is in,
            and the whole class of bug this panel sits on top of is the two being confused. */}
        {l.packs !== null && l.perPack !== null && (
          <small className="muted"> = {n * l.perPack} pcs</small>
        )}
      </span>
    );
  };

  if (call.length === 0) {
    return (
      <>
        <h3>Next supplier call</h3>
        <p className="muted">
          Nothing to order. Everything on the shelf has more than {coverWeeks} weeks of cover at the
          rate it is going, and every material your kits use is on a delivery note.
        </p>
      </>
    );
  }

  return (
    <>
      <h3>
        Next supplier call
        <button className="tiny" onClick={() => void copy()} title="Copy the list to send on WhatsApp">
          {copied ? "copied" : "copy the list"}
        </button>
      </h3>

      {low.length > 0 && (
        <Fold id="call-low" summary={`Running out — ${low.filter(on).length} of ${low.length} on the call`} open>
          <p className="muted">
            Enough to last about {coverWeeks} weeks, worked out at the faster of the recent rate and
            the rate since the first note. Anything under {Math.round(thin * 100)}% of what came in is
            here too, even if it is going slowly.
          </p>
          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Send</th>
                <th>Material</th>
                <th>Left</th>
                <th>Going at</th>
                <th>Lasts</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {low.map((l) => (
                <tr key={l.key} className={on(l) ? "" : "off"}>
                  <td>
                    <input type="checkbox" checked={on(l)} onChange={() => toggle(l.key)} />
                  </td>
                  <td>
                    {l.name}
                    {l.why === "out" && <span className="pill bad">out</span>}
                    {l.why === "thin" && <span className="pill warn">under {Math.round(thin * 100)}%</span>}
                  </td>
                  <td className="num">{l.left} pcs</td>
                  <td className="num">
                    {l.perWeek > 0 ? `${l.perWeek}/wk` : <span className="muted">never packed</span>}
                    {/* The working, because the number chose itself between two rates. */}
                    {l.perWeek > 0 && l.recentPerWeek !== l.lifetimePerWeek && (
                      <small className="muted">
                        {" "}
                        recent {l.recentPerWeek}, all {l.lifetimePerWeek}
                      </small>
                    )}
                  </td>
                  <td className="num">{l.weeksLeft === null ? "—" : `${l.weeksLeft} wk`}</td>
                  <td>
                    <Qty l={l} />
                    {l.guess && <span className="pill warn">your call</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>
      )}

      {/**
        * **The records gap, kept well away from the order.** He owns every one of these — something
        * was packed out of it — so a supplier call containing them buys a second set of the shelf.
        * Vansh saw this coming: *"maybe it will automatically fix when I upload the delivery match
        * for previous deliveries I had got."* It does, and this is the list that empties.
        */}
      {untallied.length > 0 && (
        <Fold id="call-untallied" summary={`Used but never tallied in — ${untallied.length}`} open={false}>
          <p className="muted">
            Your packing has used these, so you have them — but no delivery note on record accounts
            for a single one, so the shelf cannot count them. <strong>They are not an order.</strong>{" "}
            Paste your earlier delivery notes at the top of this tab, with their real dates, and each
            one moves onto the shelf and out of this list.
          </p>
          <ul className="delivery-list">
            {untallied.map((u) => (
              <li key={u.key}>
                <span className="lid">{u.name}</span>
                <span className="muted">{u.pieces} pcs packed, none accounted for</span>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {gap.length > 0 && (
        <Fold id="call-gap" summary={`For kits you have never packed — ${gap.length}`} open={false}>
          {/**
           * **What this list is, stated exactly.** Not *you have none of these* — with few notes
           * saved nothing here can know that, and a list read that way sends him buying a second
           * set of his own shelf. What is true of every row: a costed kit needs it, no note carries
           * it, and nothing has ever been packed out of it. That is the question he asked — *"I am
           * going to plan some listings for products that don't even exist in my inventory yet"* —
           * and the honest instruction is to CHECK, not to order.
           */}
          <p className="muted">
            Every one of these belongs to a kit that has never gone out, and no delivery note
            carries it. Check you have them before you list those kits. Nothing can be worked out
            about the quantity, so each is one packet until you change it.
          </p>
          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Send</th>
                <th>Material</th>
                <th>Needed by</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {gap.map((l) => (
                <tr key={l.key} className={on(l) ? "" : "off"}>
                  <td>
                    <input type="checkbox" checked={on(l)} onChange={() => toggle(l.key)} />
                  </td>
                  <td>{l.name}</td>
                  <td className="muted">
                    {l.forSkus.slice(0, 3).join(", ")}
                    {l.forSkus.length > 3 && ` +${l.forSkus.length - 3} more`}
                  </td>
                  <td>
                    <Qty l={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>
      )}
    </>
  );
}

export function Stock({ n }: { n: number }) {
  const [date, setDate] = useState(iso(new Date()));
  const [claimedNote, setClaimedNote] = useState("");
  const [countedNote, setCountedNote] = useState("");
  const [rows, setRows] = useState<TallyRow[] | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [stock, setStock] = useState<
    {
      deliveries: Delivery[]; from: string | null; onHand: OnHand[]; reorderWeeks: number;
      nextCall: CallLine[]; coverWeeks: number; thin: number;
      untallied: { key: string; name: string; pieces: number }[];
    } | null
  >(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Which group each not-on-the-list name would go into, keyed by the wording it was written in. */
  const [newGroups, setNewGroups] = useState<Record<string, string>>({});
  const [addingAll, setAddingAll] = useState(false);
  /**
   * Names ticked OFF the batch — the ones not to add.
   *
   * Vansh, 2026-09-12: *"here I should have the option to unselect what we are actually going to
   * send to the inventory… there could be any reason to not send it, but we should have the
   * freedom is the point."* His case was a line that turned out to be a ring foil already added
   * under another name, but the reason does not matter: an all-or-nothing batch is one you stop
   * using the first time it contains something you do not want.
   *
   * Held as the EXCLUSIONS rather than the selections, so a name that appears after a re-tally is
   * included by default — the common case stays one click.
   */
  const [skip, setSkip] = useState<Record<string, boolean>>({});

  /**
   * Put every unmatched line on the price list in one go.
   *
   * Vansh, 2026-09-04: *"I thought we did make an automatic listing logic after taking 1
   * verification — these many new inventory items were found this time, do you want to have them
   * in the list."* His 44-line count had **16** of them; adding those one at a time is how a
   * screen stops being used.
   *
   * **One confirmation, never one click.** Every row goes into the file both machines ship with,
   * so the batch is shown first with the group each will land in — and the group is a PICKER, for
   * the same reason the add form's is: a typed one put a category called `2 age foil` in the list.
   *
   * **No price is invented.** They land as *price not set*, which the panel already draws in
   * orange and counts as uncosted — a real material nobody has priced, never a free one.
   */
  async function addAllMissing() {
    const missing = (rows ?? []).filter((r) => r.key === null && !skip[r.name]);
    if (missing.length === 0) return;
    if (!window.confirm(
      `Add ${missing.length} material${missing.length === 1 ? "" : "s"} to the price list?\n\n` +
      `They go into the list both machines use, with no price set — you fill those in when you ` +
      `know them.`,
    )) return;

    setAddingAll(true);
    let added = 0;
    const failed: string[] = [];
    for (const r of missing) {
      const category = (newGroups[r.name] ?? guessGroup(r)).trim();
      if (category === "") { failed.push(`${r.name} (no group chosen)`); continue; }
      const res = await window.ww.addMaterial({ category, material: r.name.trim(), paise: null });
      if (res.ok) added++;
      else failed.push(`${r.name} — ${res.message}`);
    }
    setAddingAll(false);
    setError(failed.length === 0 ? null : `Added ${added}. Not added: ${failed.join("; ")}`);
    run(); // re-tally, so what just landed shows as matched
  }

  /**
   * Delete a whole saved delivery.
   *
   * Vansh, 2026-09-12: *"do I have the freedom to delete some of the whole delivery later on,
   * because my testing plan requires it."* It asks first, with both things it moves named: the
   * quantities, and — when it is the earliest one — the DAY USAGE IS COUNTED FROM, which changes
   * what every material shows as used, not only the ones on that note.
   */
  async function dropDelivery(date: string, earliest: boolean) {
    const also = earliest
      ? "\n\nIt is the earliest one on record, so packing will be counted from the next delivery " +
        "instead — that changes what EVERY material shows as used, not just these."
      : "";
    if (!window.confirm(`Delete the delivery of ${date}?\n\nIts quantities come straight off the shelf.${also}`)) {
      return;
    }
    await window.ww.removeDelivery(date);
    loadStock();
  }

  const loadStock = useCallback(() => {
    void window.ww.stock().then(setStock, (e: Error) => setError(e.message));
  }, []);
  useEffect(loadStock, [loadStock]);

  const run = () => {
    setSaved(null);
    void window.ww.tallyNotes(claimedNote, countedNote).then(
      (r) => {
        setRows(r.rows);
        setMaterials(r.materials);
      },
      (e: Error) => setError(e.message),
    );
  };

  /** A pick is remembered, then the tally is re-run so the row moves out of the worklist. */
  const pick = (name: string, key: string) => {
    void window.ww.setAlias(name, key === "" ? null : key).then(run, (e: Error) => setError(e.message));
  };

  const save = () => {
    if (rows === null) return;
    const d: Delivery = {
      date,
      claimedNote,
      countedNote,
      picks: Object.fromEntries(rows.filter((r) => r.overridden && r.key).map((r) => [r.name, r.key!])),
      // **What is stored is the COUNT, not the claim** — the count is the one somebody did with
      // their hands, and an edit made on screen is the most recent count of all.
      lines: rows.map((r) => ({
        key: r.key,
        name: r.name,
        qty: edits[r.name] ?? r.counted ?? r.claimed ?? 0,
        unit: r.unit,
        // The claim rides along with the count, so the saved delivery still knows what he said.
        claimed: r.claimed,
        ...(r.claimedUnit && r.claimedUnit !== r.countedUnit ? { claimedUnit: r.claimedUnit } : {}),
      })),
    };
    void window.ww.saveDelivery(d).then(() => {
      setSaved(date);
      loadStock();
    }, (e: Error) => setError(e.message));
  };

  /**
   * **Four different questions, counted separately.**
   *
   * They used to be one number, and on Vansh's real pair of notes it read *"69 need a look"* —
   * which is not a worklist, it is a wall, and he said so: *"in this way this will be a lot of
   * work for me mate."* 58 of those 69 were rows only ONE of the two notes mentioned, and that is
   * only alarming if both notes describe the SAME delivery. His did not: he pasted what he has in
   * stock against a specific note from 19 August, so of course most rows appear once.
   *
   * Only two of these are chores: a real shortfall, and a unit nobody can convert. The rest are
   * facts about the pair of notes, and they are reported as facts.
   */
  const short = (rows ?? []).filter((r) => r.mismatch);
  const unitQ = (rows ?? []).filter((r) => r.unitsDiffer && r.agreesInPieces === null);
  const oneSided = (rows ?? []).filter((r) => r.claimed === null || r.counted === null);
  const unlisted = (rows ?? []).filter((r) => r.key === null);
  const needsALook = short.length + unitQ.length;

  /**
   * Find a row without scrolling sixty of them.
   *
   * **It searches the matched material as well as the written words**, which is the half that
   * makes it useful: after a delivery you go looking for *"where did the rose gold chrome end
   * up"*, and the supplier wrote `Rosegold chrome`. Matching only what he typed would answer
   * that question with nothing.
   *
   * Case and spacing are ignored on both sides, because the supplier does not capitalise — Vansh:
   * *"he has not cared about 1st letter capital, maybe using computer."*
   */
  /** The price list grouped by category, which is the shape the shared picker takes. */
  const byCategory = useMemo(() => {
    const groups = new Map<string, { category: string; material: string }[]>();
    for (const m of materials) {
      if (!groups.has(m.category)) groups.set(m.category, []);
      groups.get(m.category)!.push({ category: m.category, material: m.name });
    }
    return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  const toOrder = (stock?.onHand ?? []).filter((r) => r.order);
  const asking = (stock?.onHand ?? []).filter((r) => r.needsPackSize);

  /**
   * Answer *how many pieces in a packet* — written onto the material, not onto this delivery.
   *
   * It belongs to the material because it is a fact about the product, true of every delivery of
   * it that has ever arrived and every one still to come; storing it against one note would ask
   * the same question again next week. It is the same `piecesPerPack` the costing panel already
   * uses to keep a 16-piece line from being priced as 16 packs — one number, one meaning, filled
   * in from wherever you happen to notice it is missing.
   */
  const setPackSize = (key: string, pieces: number) => {
    if (!Number.isFinite(pieces) || pieces <= 0) return;
    void window.ww.editMaterial(key, { piecesPerPack: pieces }).then(
      () => loadStock(),
      (e: Error) => setError(e.message),
    );
  };

  const loose = (s2: string) => s2.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hunt = loose(find);
  const shown = (rows ?? []).filter(
    (r) => hunt === "" || loose(r.name).includes(hunt) || loose(r.key ?? "").includes(hunt),
  );

  return (
    <section className="panel orders">
      <header>
        <h1>{n === 0 ? "Raw stock" : `${n}. Raw stock`}</h1>
        <p>
          What is actually in the building — not what a listing is made of. Paste the supplier&apos;s
          note and your own count; the two get matched to the price list and anything that
          disagrees comes to the top. What you pick is remembered, so the next delivery matches
          itself.
        </p>
      </header>
      {error && <p className="error">{error}</p>}

      <div className="notes-pair">
        <label>
          <b>What the supplier says</b>
          <textarea
            rows={12}
            spellCheck={false}
            placeholder={"Vansh 19.8.26\nGroom to be foil 5 pkt ok\n1 pkt silver chrome ok\nBlue no foil. 0 to9 450 pcs ok"}
            value={claimedNote}
            onChange={(e) => setClaimedNote(e.target.value)}
          />
        </label>
        <label>
          <b>What you counted</b>
          <textarea
            rows={12}
            spellCheck={false}
            placeholder={"Paste or type your own count.\nThe wording does not have to match his."}
            value={countedNote}
            onChange={(e) => setCountedNote(e.target.value)}
          />
        </label>
      </div>

      <div className="two-picks">
        <label className="muted">
          Delivered on <input type="date" value={date} max={iso(new Date())} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="go" onClick={run} disabled={claimedNote.trim() === "" && countedNote.trim() === ""}>
          Tally the two
        </button>
      </div>

      {rows !== null && (
        <>
          <p className={needsALook > 0 ? "warnpill block" : "muted"}>
            {rows.length} materials read.{" "}
            {needsALook === 0
              ? "Nothing is short and every unit lines up."
              : [
                  short.length > 0 && `${short.length} short`,
                  unitQ.length > 0 && `${unitQ.length} counted in different units`,
                ].filter(Boolean).join(" · ") + " — at the top."}
            <small>
              {oneSided.length > 0 && (
                <>
                  <b>{oneSided.length}</b> appear on only one of the two notes. That is normal
                  unless both notes are about the <i>same</i> delivery — a stock list against one
                  day&apos;s note will look like this and is not a shortfall.{" "}
                </>
              )}
              A number in <b>bold</b> is one only one of you listed. Blank is <i>not counted</i>,
              which is not the same as none arriving.
            </small>
          </p>

          {/* The batch offer. It counts every unmatched row, not the ones on screen: a filter is
              for looking, and adding only what is visible would quietly leave the rest out. */}
          {unlisted.length > 0 && (
            <div className="add-missing">
              <p className="warnpill block">
                <b>{unlisted.length} of these are not on the price list</b>{" "}
                — until they are, they cannot be costed and they will not come off the shelf.
                <small>
                  They go in with no price. Check the group on each one first; the group is a guess
                  from the closest row we did find.
                </small>
              </p>
              <ul>
                {unlisted.map((r) => (
                  <li key={r.name} className={skip[r.name] ? "left-out" : ""}>
                    <label className="take-it" title="Leave this one off the list">
                      <input
                        type="checkbox"
                        checked={!skip[r.name]}
                        onChange={(e) => setSkip({ ...skip, [r.name]: !e.target.checked })}
                      />
                    </label>
                    <span className="lid">{r.name}</span>
                    <select
                      value={newGroups[r.name] ?? guessGroup(r)}
                      onChange={(e) => setNewGroups({ ...newGroups, [r.name]: e.target.value })}
                    >
                      <option value="">— which group? —</option>
                      {[...new Set(materials.map((m) => m.category))].sort().map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <button
                className="go"
                disabled={addingAll || unlisted.every((r) => skip[r.name])}
                onClick={() => void addAllMissing()}
              >
                {addingAll
                  ? "Adding…"
                  : `Add ${unlisted.filter((r) => !skip[r.name]).length} to the price list`}
              </button>
              {unlisted.some((r) => skip[r.name]) && (
                <span className="muted">
                  {unlisted.filter((r) => skip[r.name]).length} left off — they stay unmatched, which
                  is a state the tally already shows.
                </span>
              )}
            </div>
          )}

          <div className="two-picks">
            <input
              className="hunt"
              type="search"
              placeholder="Find a material — his words or ours"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            {hunt !== "" && (
              <span className="muted">
                {shown.length} of {rows.length}
              </span>
            )}
          </div>

          {/**
            * **Four groups, not one list of 84 rows.** Vansh, looking at the real thing: *"this is
            * not telling us what I mentioned extra and what he does"* — one sorted table made
            * *only he listed it* and *we disagree* look like the same kind of row, when only the
            * second is a problem. The order is the order of what it costs you to ignore.
            */}
          {[
            {
              title: "Needs a decision",
              why: "The two of you do not agree, or you counted in units that cannot be compared.",
              rows: shown.filter((r) => r.mismatch || (r.unitsDiffer && r.agreesInPieces === null)),
            },
            {
              title: "Only on his note",
              why: "He says he sent it and your count does not mention it. If both notes are about the same delivery, this is what to check on the shelf.",
              rows: shown.filter((r) => r.claimed !== null && r.counted === null),
            },
            {
              title: "Only on your count",
              why: "You have it and his note does not list it — an earlier delivery, or something he forgot to write.",
              rows: shown.filter((r) => r.claimed === null && r.counted !== null),
            },
            {
              title: "Agreed",
              why: "Both notes say the same number. Nothing to do.",
              rows: shown.filter((r) => r.claimed !== null && r.counted !== null && !r.mismatch
                && !(r.unitsDiffer && r.agreesInPieces === null)),
            },
          ].filter((g) => g.rows.length > 0).map((g) => (
            /**
              * **Folded unless it needs you.** Vansh: *"all listings are opening everywhere, there
              * should be a toggle at each step that opens any sort of lists."* Eighty rows in four
              * open groups is the wall this screen exists to replace — so only *needs a decision*
              * starts open, and the rest say how many they hold and wait to be asked.
              */
            <Fold
              key={g.title}
              id={g.title}
              className="tally-group"
              open={g.title === "Needs a decision"}
              summary={
                <>
                  {g.title}
                  <small>{g.rows.length} · {g.why}</small>
                </>
              }
            >
              <table className="rows inv-table">
                <thead>
                  <tr>
                    <th>As written</th>
                    <th>Which material</th>
                    <th>He says</th>
                    <th>You counted</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.name} className={r.mismatch ? "bad-row" : ""}>
                      <td>
                        {r.name}
                        <br />
                        <Band row={r} />
                      </td>
                      <td>
                        {/**
                          * **The closest row, one click away.** Measured on Vansh's real notes: the
                          * right answer for an unmatched line is usually its top candidate at
                          * 50-57%, just under the 60% floor — `cocomellon set` -> Cocomelon Set at
                          * 57%, `peppa` -> Peppa Pig Set at 57%. The floor is right to keep (a
                          * quiet wrong match is the one thing worse than a blank), but burying the
                          * good guess in a list of 178 made every one of them a hunt.
                          */}
                        {r.key === null && r.choices[0] && (
                          <button
                            className="tiny take-closest"
                            onClick={() =>
                              pick(r.name, `${r.choices[0].material.category}|${r.choices[0].material.material}`)
                            }
                          >
                            use {r.choices[0].material.material} · {Math.round(r.choices[0].score * 100)}%
                          </button>
                        )}
                        {/* The SAME control Cost a kit uses — type to search, near misses first.
                            It was a plain `<select>` here, which opens 178 rows over half the
                            screen and can only be searched by first letter. */}
                        <MaterialPicker
                          id={`tally-${r.name}`}
                          name={r.key ? (r.key.split("|")[1] ?? "") : ""}
                          flagged={r.key !== null && r.score < 0.85}
                          choices={r.choices}
                          byCategory={byCategory}
                          onPick={(k) => pick(r.name, k)}
                        />
                      </td>
                      <td className={r.counted === null ? "strong" : ""}>{r.claimed ?? "—"}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          placeholder={r.counted === null ? "—" : ""}
                          value={edits[r.name] ?? r.counted ?? ""}
                          onChange={(e) => setEdits({ ...edits, [r.name]: Number(e.target.value || 0) })}
                        />
                      </td>
                      <td className="muted">
                        {r.unitsDiffer
                          ? `${r.claimedUnit || "?"} vs ${r.countedUnit || "?"}`
                          : r.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fold>
          ))}
          {shown.length === 0 && (
            <p className="muted">
              Nothing matches “{find}”. The search covers what he wrote and what it matched.
            </p>
          )}

          <div className="two-picks">
            {/* Saves EVERY row, not the ones on screen — a filter is for looking, and a delivery
                that saved only what was visible would quietly lose the rest. */}
            <button className="go" onClick={save}>
              Save this delivery
            </button>
            {saved !== null && <span className="muted">Saved {saved}. It is in the stock below.</span>}
          </div>
        </>
      )}

      {/* Every delivery saved, newest first — the record the shelf is built from, and the only
          way back out of one saved against the wrong date or tallied twice. */}
      {stock !== null && stock.deliveries.length > 0 && (
        <>
          <h3>Deliveries saved</h3>
          <ul className="delivery-list">
            {stock.deliveries.map((dv) => (
              <li key={dv.date}>
                <span className="lid">{dv.date}</span>
                <span className="muted">
                  {dv.lines.length} material{dv.lines.length === 1 ? "" : "s"}
                  {dv.date === stock.from && " · usage is counted from this one"}
                </span>
                <button className="drop-one" onClick={() => void dropDelivery(dv.date, dv.date === stock.from)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {stock !== null && (
        <NextCall
          call={stock.nextCall}
          untallied={stock.untallied}
          coverWeeks={stock.coverWeeks}
          thin={stock.thin}
        />
      )}

      {/**
        * **Recount, on demand.** The shelf is derived from two things that change elsewhere — the
        * deliveries here, and the packing on the orders screen — and this panel only ever read them
        * when it was opened. Vansh, 2026-09-12: *"there is a latency at what's left thing, add a
        * refresh button that recalculates the present manifest vs the stuff we have at inventory."*
        * Tick a manifest off, come back, press this.
        */}
      <h3>
        On the shelf
        <button className="tiny" onClick={loadStock} title="Recount against the manifests as they stand now">
          recount
        </button>
      </h3>
      {stock === null ? (
        <p className="muted">Working it out…</p>
      ) : stock.onHand.length === 0 ? (
        <p className="muted">
          No delivery saved yet. Tally one above and it appears here, with the packing taken off it
          as the days go.
        </p>
      ) : (
        <>
          {/* The one sentence the panel exists for. A count of rows, not a list of them: the list
              is right below, already sorted so those rows are the first ones. */}
          {/* Above the reorder line, because until these are answered the reorder line is
              incomplete — a material whose shelf cannot be worked out cannot be flagged either. */}
          {asking.length > 0 && (
            <p className="warnpill block">
              <b>
                {asking.length} material{asking.length === 1 ? "" : "s"} counted in packets
              </b>{" "}
              — say how many pieces are in one and the shelf works itself out. Until then those rows
              are left blank rather than guessed at.
              <small>
                The note says <i>5 pkt</i> and the packing uses pieces; without the pack size those
                two are not the same unit and subtracting them would put most of the shelf below
                zero at once.
              </small>
            </p>
          )}
          {toOrder.length > 0 && (
            <p className="warnpill block">
              <b>
                Order {toOrder.length} material{toOrder.length === 1 ? "" : "s"} now.
              </b>{" "}
              {toOrder.map((r) => r.name).join(", ")}.
              <small>
                Less than {stock.reorderWeeks} weeks left at the recent rate, and the supplier takes
                about one — so ordering later means running out.
              </small>
            </p>
          )}
          <p className="muted">
            Received since {stock.from}, less what the packing used — the same arithmetic{" "}
            <b>How it sells</b> shows, so there is no second count. <b>Everything is in pieces</b>:
            a packet of 50 that one kit takes 4 from is 46 left, not none. Soonest to run out first.
          </p>
          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Came in</th>
                <th>Used</th>
                <th>Left</th>
                <th>A week</th>
                <th>Weeks left</th>
              </tr>
            </thead>
            <tbody>
              {stock.onHand.map((r) => (
                <tr key={r.key} className={r.order ? "bad-row" : ""}>
                  <td>
                    {r.name}
                    {/* Always "a packet": `piecesPerPack` counts what is in a PACK, whatever unit
                        the delivery note happened to be written in — "50 in a pcs" is nonsense. */}
                    {r.perPack !== null && <small className="muted"> · {r.perPack} in a packet</small>}
                  </td>
                  <td>{r.received}</td>
                  <td>{r.used || "—"}</td>

                  {r.needsPackSize ? (
                    /* One cell across the three number columns: there is no left, no weekly rate
                       and no weeks left until the question in it is answered. */
                    <td colSpan={3} className="ask-pack">
                      <label>
                        Pieces in one packet?
                        <input
                          type="number"
                          min={1}
                          placeholder="50"
                          onKeyDown={(e) =>
                            e.key === "Enter" && setPackSize(r.key, Number(e.currentTarget.value))
                          }
                          onBlur={(e) => setPackSize(r.key, Number(e.target.value))}
                        />
                      </label>
                      <small className="muted">
                        {r.received} {r.unit || "pkt"} in so far
                      </small>
                    </td>
                  ) : (
                    <>
                      <td className={r.left <= 0 ? "bad" : r.order ? "warn" : ""}>
                        {r.left}
                        {/* Percent left, because that is how Vansh reads a shelf — "half gone". It
                            is of what has EVER come in, so it drops back after every delivery. */}
                        {r.received > 0 && r.used > 0 && (
                          <small className="muted"> · {Math.round((r.left / r.received) * 100)}%</small>
                        )}
                      </td>
                      <td className="muted">{r.perWeek || "—"}</td>
                      <td className={r.order ? "bad" : ""}>
                        {r.weeksLeft === null ? "—" : r.left <= 0 ? "out" : r.weeksLeft}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            <small>
              A blank week rate means no kit that uses it has been packed since {stock.from}, so
              there is no rate to run out at — not that it is safe.
            </small>
          </p>
        </>
      )}
    </section>
  );
}

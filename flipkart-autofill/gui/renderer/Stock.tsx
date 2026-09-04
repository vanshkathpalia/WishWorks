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
import type { Delivery, OnHand, TallyRow } from "../shared.js";
import { MaterialPicker } from "./ui.js";

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

export function Stock({ n }: { n: number }) {
  const [date, setDate] = useState(iso(new Date()));
  const [claimedNote, setClaimedNote] = useState("");
  const [countedNote, setCountedNote] = useState("");
  const [rows, setRows] = useState<TallyRow[] | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [stock, setStock] = useState<
    { deliveries: Delivery[]; from: string | null; onHand: OnHand[]; reorderWeeks: number } | null
  >(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Which group each not-on-the-list name would go into, keyed by the wording it was written in. */
  const [newGroups, setNewGroups] = useState<Record<string, string>>({});
  const [addingAll, setAddingAll] = useState(false);

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
    const missing = (rows ?? []).filter((r) => r.key === null);
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
                  <li key={r.name}>
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
              <button className="go" disabled={addingAll} onClick={() => void addAllMissing()}>
                {addingAll ? "Adding…" : "Add them all to the price list"}
              </button>
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
            <div key={g.title} className="tally-group">
              <h3>
                {g.title}
                <small>{g.rows.length} · {g.why}</small>
              </h3>
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
            </div>
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

      <h3>On the shelf</h3>
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

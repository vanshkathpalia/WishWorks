/**
 * Orders.tsx — what is left to pack, off the marketplace's own manifest.
 *
 * What it replaces: reading the acceptance page and writing every order and SKU onto paper.
 * Vansh, 2026-08-19: *"we are checking which order had come and we are manually writing it on a
 * page — that is a very time consuming thing, it can cause errors."*
 *
 * **It is a queue, not a day.** Orders arrive across an afternoon and get packed the next morning,
 * and tomorrow's dispatch often gets packed today. So the left-hand list is *everything still to
 * pack*, and the date only decides who gets paid for it — see `SubOrder` in the engine for why
 * `firstSeen` and `packedOn` are two different dates.
 *
 * **Counting is by parcel, never by SKU total** (WW-181). Meesho's manifest is a snapshot of
 * everything ready to ship, so the 2pm download repeats the 12pm one with more added; two
 * couriers' manifests on one day, by contrast, are genuinely different parcels. Those two cases
 * are identical at SKU level and need opposite answers. Every parcel carries a sub-order number,
 * so the engine counts ids and neither case needs a rule.
 *
 * The screen holds no arithmetic of its own: `window.ww.orders()` returns what to draw and every
 * action returns it again. What "outstanding" or "this month's packets" mean is a fact about
 * somebody's wages, and it belongs in one place.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DaySummary, OrdersView } from "../shared.js";
import { fileUrl } from "./ui.js";

/**
 * Which SKU has which picture, remembered for as long as the app is open.
 *
 * Module-level rather than component state on purpose: the point is that it survives the picture
 * pane being re-rendered for a different SKU, which is the whole of hovering down a list.
 */
const seenImages = new Map<string, string | null>();

/** `2026-08-19` → `19 Aug 2026`. The panel shows dates the way the manifest prints them. */
const showDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * The picture for the SKU on screen, or a plain reason there isn't one.
 *
 * Reloaded per SKU rather than fetched for the whole list up front: the ready folder is on a
 * shared drive, and walking it on a click is cheaper than walking it at launch for a screen that
 * might not be opened.
 *
 * **Opens on image 2**, the one that shows what goes in the packet. Image 1 is the shop-window
 * photo and is one click away. **Adding a picture is here** rather than in a settings screen
 * because this is where the gap is discovered: listings finished in this app arrive named and
 * grouped, and the partner's never went through it at all.
 */
function SkuImage({ sku, qty, tick }: { sku: string; qty: number; tick: React.ReactNode }) {
  const [position, setPosition] = useState(2);
  const [file, setFile] = useState<string | null | undefined>(undefined);

  // `.catch(() => null)` is not tidiness: an IPC call that rejects never settles, so without it a
  // failure leaves this on "Looking…" for ever — which is indistinguishable from a frozen app and
  // is exactly what WW-182 looked like. No picture is the honest answer to any failure here.
  //
  // Cached because the list is now HOVERABLE: running a cursor down ten SKUs would otherwise walk
  // the ready folder ten times, and that folder is on a shared drive.
  const load = useCallback((fresh = false) => {
    const key = `${sku}|${position}`;
    if (!fresh && seenImages.has(key)) {
      setFile(seenImages.get(key)!);
      return;
    }
    setFile(undefined);
    void window.ww.skuImage(sku, position).catch(() => null).then((found) => {
      seenImages.set(key, found);
      setFile(found);
    });
  }, [sku, position]);
  useEffect(() => load(), [load]);

  async function add() {
    const [picked] = await window.ww.pick("orders-image", "files");
    if (!picked) return;
    await window.ww.addSkuImage(sku, position, picked);
    load(true); // a picture was just added, so the remembered "there isn't one" is now wrong
  }

  return (
    <div className="sku-pictures">
      <div className="picks">
        <button className={position === 2 ? "chosen" : ""} onClick={() => setPosition(2)}>
          What is in the packet
        </button>
        <button className={position === 1 ? "chosen" : ""} onClick={() => setPosition(1)}>
          Main photo
        </button>
        <button onClick={() => void add()}>
          {file ? "Replace this picture…" : "Add a picture…"}
        </button>
        {/* The tick sits at the end of this row on Vansh's call — it used to be a panel of its own
            above the picture, pushing the one thing the packer needs to see off the screen. */}
        {tick}
      </div>

      {file === undefined ? (
        <div className="sku-image empty">Looking for the picture…</div>
      ) : file === null ? (
        /**
         * No picture, so the packet count IS the screen — Vansh: *"in this case just show the
         * number of packing and not image"*. Plenty of SKUs will never have one: the partner's
         * listings never went through this app, and some are named differently in the ready
         * folder. A big empty box for every one of those reads as something being broken.
         */
        <div className="sku-nopic">
          <b>{qty}</b>
          <span>
            packet{qty === 1 ? "" : "s"} to pack
            <small>
              no picture for {sku} — add one above and it shows here from then on
            </small>
          </span>
        </div>
      ) : (
        <figure className="sku-image">
          <img src={fileUrl(file)} alt={position === 2 ? `What goes in a ${sku} packet` : `${sku} main photo`} />
          <figcaption className="path">{file}</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * Done — all of them, or a number.
 *
 * **It no longer holds the packer menu**, and that is the fix for WW-183: ticking takes the SKU out
 * of the queue, so the pane this control lives in unmounts a moment later and took the menu with
 * it — the menu opened and vanished in the same frame, and thirty-four packets were recorded with
 * nobody named. Naming is now a step of its own in the pane, which survives because it is not
 * hanging off the row that just disappeared.
 *
 * The number box is for the ordinary morning where half a SKU gets done — Vansh: *"if not all 2 or
 * all x, we should be able to enter a number for now, that we packed y, so x−y is left."*
 */
function PackedTick({ qty, onPack }: { qty: number; onPack: (limit?: number) => void }) {
  const [part, setPart] = useState("");
  const some = Number(part);
  const valid = Number.isFinite(some) && some > 0 && some < qty;

  return (
    <div className="packed-tick-wrap">
      <label className="packed-tick">
        <input type="checkbox" checked={false} onChange={() => onPack()} />
        <span>Packed{qty > 1 ? ` — all ${qty}` : ""}</span>
      </label>
      {qty > 1 && (
        <span className="part-packed">
          or
          <input
            type="number"
            min={1}
            max={qty - 1}
            placeholder="0"
            value={part}
            onChange={(e) => setPart(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !valid) return;
              onPack(some);
              setPart("");
            }}
          />
          of {qty}
          <button disabled={!valid} onClick={() => { onPack(some); setPart(""); }}>
            Packed
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * Who packed the batch just ticked — a step in the pane, not a menu on a vanishing row.
 *
 * **Skipping is a first-class answer.** *Not now* leaves the packets recorded and unnamed, and the
 * tally counts them so they can be named before pay day; the left-hand list offers them back. What
 * must never happen is the tick waiting for a name, which is how a morning gets packed and nothing
 * gets recorded at all.
 *
 * `replacing` is what keeps two batches of one SKU apart: the morning's two credited to Asha stay
 * hers when the afternoon's two are credited to Ravi.
 */
function WhoPacked({
  sku,
  qty,
  workers,
  chosen,
  onPick,
  onAddWorker,
  onDone,
}: {
  sku: string;
  qty: number;
  workers: string[];
  chosen: string[];
  onPick: (names: string[]) => void;
  onAddWorker: (name: string) => void;
  onDone: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const share = chosen.length > 0 ? qty / chosen.length : 0;

  return (
    <div className="who-packed">
      <h2>
        {qty} packet{qty === 1 ? "" : "s"} of {sku} packed
        <small>Who did it?</small>
      </h2>

      <div className="who">
        {workers.map((name) => {
          const on = chosen.includes(name);
          return (
            <button
              key={name}
              className={on ? "chosen" : ""}
              onClick={() => onPick(on ? chosen.filter((n) => n !== name) : [...chosen, name])}
            >
              {name}
              {on && <em> {Number(share.toFixed(2))}</em>}
            </button>
          );
        })}

        {adding === null ? (
          <button className="add" onClick={() => setAdding("")}>+ someone new</button>
        ) : (
          <input
            type="text"
            autoFocus
            placeholder="their name"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(null);
              if (e.key !== "Enter" || !adding.trim()) return;
              onAddWorker(adding.trim());
              onPick([...chosen, adding.trim()]);
              setAdding(null);
            }}
          />
        )}
      </div>

      <p className="muted">
        {chosen.length > 1
          ? `Split ${chosen.length} ways — ${Number(share.toFixed(2))} packets each toward this month's pay.`
          : "Pick as many as shared it. You can also leave it and name them later."}
      </p>

      <div className="picks">
        <button className="primary" onClick={onDone}>
          {chosen.length > 0 ? "Done" : "Not now"}
        </button>
      </div>
    </div>
  );
}

/** The tally: what went out today, who packed it, where it is going, and what is still waiting. */
function Summary({ summary, onClose }: { summary: DaySummary; onClose: () => void }) {
  const rows = (title: string, list: { name: string; qty: number }[]) =>
    list.length === 0 ? null : (
      <div>
        <h3>{title}</h3>
        <ul>
          {list.map((r) => (
            <li key={r.name}>
              <span className="lid">{r.name}</span>
              <span className="qty">{r.qty}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet summary" onClick={(e) => e.stopPropagation()}>
        <h2>{showDate(summary.date)}</h2>
        <p className="muted">
          <b>{summary.packets}</b> packed today · <b>{summary.left}</b> still to pack
          {summary.unnamed > 0 && (
            <>
              {" · "}
              <span className="warnpill">{summary.unnamed} with nobody named</span>
            </>
          )}
        </p>
        <div className="summary-cols">
          {rows("By SKU", summary.bySku)}
          {rows("By packer", summary.byPacker)}
          {rows("By courier", summary.byCourier)}
        </div>
        <button className="close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export function Orders() {
  const [view, setView] = useState<OrdersView | null>(null);
  const [sku, setSku] = useState<string | null>(null);
  const [workers, setWorkers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState(false);
  /**
   * The SKU under the cursor. Hovering the queue shows that SKU's picture without moving the
   * selection — Vansh: *"if I hover over any listing then its inventory image opens"* — which is
   * how you check what a code IS while looking for the one you are about to pack.
   */
  const [hover, setHover] = useState<string | null>(null);
  /**
   * The batch waiting to be named: what was just ticked, or a SKU picked back out of *nobody
   * named*. It lives HERE and not in the tick, because ticking removes the SKU from the queue and
   * anything hanging off that row is unmounted with it (WW-183).
   */
  const [naming, setNaming] = useState<{ sku: string; qty: number } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    // Same rule as the picture below: an IPC rejection never settles, so it must be caught here or
    // the screen waits for ever on a call that has already failed.
    void window.ww.orders().then(setView, (e: Error) => setError(e.message));
    void window.ww.workers().then(setWorkers, () => setWorkers([]));
  }, []);

  const row = view?.outstanding.find((r) => r.sku === sku) ?? null;
  const packets = view?.outstanding.reduce((n, r) => n + r.qty, 0) ?? 0;
  /** The picture follows the cursor when there is one, and the selection otherwise. */
  const showing = hover ?? sku;
  const showingQty = view?.outstanding.find((r) => r.sku === showing)?.qty ?? 0;

  /** Tick a batch off and go straight to naming it — the two halves of one action. */
  function pack(target: string, qty: number, limit?: number) {
    setNaming({ sku: target, qty: limit ?? qty });
    setChosen([]);
    void window.ww
      .packing("pack", target, view!.today, limit === undefined ? {} : { limit })
      .then(setView, (e: Error) => setError(e.message));
  }

  /** Name (or rename) the batch on screen. `replacing` keeps a second batch off the first one's. */
  function credit(names: string[]) {
    if (!naming || !view) return;
    const replacing = chosen;
    setChosen(names);
    void window.ww
      .packing("credit", naming.sku, view.today, { by: names, replacing })
      .then(setView, (e: Error) => setError(e.message));
  }

  function addWorker(name: string) {
    if (workers.includes(name)) return;
    const next = [...workers, name];
    setWorkers(next);
    void window.ww.setWorkers(next);
  }

  async function load(files: string[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of files) {
      try {
        const r = await window.ww.addManifest(file);
        if (!r.ok) setError(r.message);
        else setView(r.result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setSku(null);
    setBusy(false);
  }

  return (
    <section className="panel orders">
      <header>
        <h1>Still to pack</h1>
        <p>
          Drop the supplier manifest in — as often as you like, including the same one twice. Every
          parcel carries its own order number, so re-reading a manifest adds only what is new. Pick
          a SKU to see what goes in the packet, tick it off, and say who packed it: that tick is
          what the month&apos;s pay is worked out from.
        </p>
      </header>

      <div
        className={`drop small ${over ? "over" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
          if (paths.length) void load(paths);
          else setError("Couldn't read that. Use the button instead.");
        }}
      >
        <strong>{busy ? "Reading the manifest…" : "Drop the manifest PDF here"}</strong>
        <div className="picks">
          <button onClick={() => void window.ww.pick("orders", "files").then(load)}>
            Choose a manifest…
          </button>
          {view && <button onClick={() => setTally(true)}>Today&apos;s tally</button>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {view === null ? (
        <p className={error ? "error" : "muted"}>{error ?? "Looking…"}</p>
      ) : view.outstanding.length === 0 ? (
        <p className="muted">
          {view.summary.packets > 0
            ? `Nothing left to pack — ${view.summary.packets} done today.`
            : "Nothing to pack. Download the manifest from the seller panel and drop it in."}
        </p>
      ) : (
        <div className="orders-body">
          <aside className="sku-list">
            <h3>
              To pack
              <small>
                {view.outstanding.length} SKUs · {packets} packets · {view.summary.packets} packed
                today
              </small>
            </h3>
            <ul onMouseLeave={() => setHover(null)}>
              {view.outstanding.map((r) => (
                <li key={r.sku}>
                  <button
                    className={r.sku === sku ? "chosen" : ""}
                    onMouseEnter={() => setHover(r.sku)}
                    onClick={() => {
                      setSku(r.sku);
                      setNaming(null);
                    }}
                  >
                    <span className="qty">{r.qty}</span>
                    <span className="lid">{r.sku}</span>
                  </button>
                </li>
              ))}
            </ul>

            {view.summary.unnamedBySku.length > 0 && (
              /* Packed today with nobody named. Naming is allowed to lag the tick, which only
                 works if there is a way back to what was ticked — otherwise "later" means never
                 and the month ends with packets nobody is paid for. */
              <div className="month-pay">
                <h3>
                  Nobody named yet
                  <small>packed today · click one to say who</small>
                </h3>
                <ul>
                  {view.summary.unnamedBySku.map((r) => (
                    <li key={r.name}>
                      <button
                        className={`unnamed ${naming?.sku === r.name ? "chosen" : ""}`}
                        onClick={() => {
                          setNaming({ sku: r.name, qty: r.qty });
                          setChosen([]);
                        }}
                      >
                        <span className="lid">{r.name}</span>
                        <span className="qty">{r.qty}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {view.monthPay.length > 0 && (
              <div className="month-pay">
                <h3>
                  This month
                  <small>packets each, for pay</small>
                </h3>
                <ul>
                  {view.monthPay.map((p) => (
                    <li key={p.name}>
                      <span className="lid">{p.name}</span>
                      <span className="qty">{p.qty}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          <div className="sku-detail">
            {naming !== null ? (
              <WhoPacked
                sku={naming.sku}
                qty={naming.qty}
                workers={workers}
                chosen={chosen}
                onPick={credit}
                onAddWorker={addWorker}
                onDone={() => setNaming(null)}
              />
            ) : showing === null ? (
              <p className="muted">Pick a SKU on the left, or hover one to see its picture.</p>
            ) : (
              <>
                <h2>
                  {showing}
                  <small>
                    {showingQty} packet{showingQty === 1 ? "" : "s"} to make
                  </small>
                </h2>
                <SkuImage
                  sku={showing}
                  qty={showingQty}
                  tick={
                    /* Only the SELECTED SKU can be ticked. Hovering shows a picture; it must never
                       arm a control, or running the cursor down the list packs the wrong thing. */
                    row !== null && (hover === null || hover === row.sku) ? (
                      <PackedTick qty={row.qty} onPack={(limit) => pack(row.sku, row.qty, limit)} />
                    ) : null
                  }
                />
              </>
            )}
          </div>
        </div>
      )}

      {tally && view && <Summary summary={view.summary} onClose={() => setTally(false)} />}
    </section>
  );
}

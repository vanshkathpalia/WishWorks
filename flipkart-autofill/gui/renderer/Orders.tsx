/**
 * Orders.tsx — what is left to pack, off the marketplace's own manifest.
 *
 * What it replaces: reading the acceptance page and writing every order and SKU onto paper.
 * Vansh, 2026-08-19: *"we are checking which order had come and we are manually writing it on a
 * page — that is a very time consuming thing, it can cause errors."*
 *
 * **One manifest date at a time** (WW-254). It used to be a queue of everything unticked, and then a
 * guessed window of two days; Vansh, 2026-09-26: *"why are you having your own logic there… just
 * give option to select 25 or 26."* A chip per date with something open; the list, the ticks and
 * the tally are all about the chosen date, and a tick is recorded under it.
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
const seenImages = new Map<string, string>();

/**
 * A SKU's picture, from the remembered answer when there is one.
 *
 * `.catch(() => null)` is not tidiness: an IPC call that rejects never settles, so without it a
 * failure leaves the caller on "Looking…" for ever — indistinguishable from a frozen app, which is
 * exactly what WW-182 looked like. No picture is the honest answer to any failure here.
 */
function findPicture(sku: string, position: number, fresh = false): Promise<string | null> {
  const key = `${sku}|${position}`;
  const seen = seenImages.get(key);
  if (!fresh && seen !== undefined) return Promise.resolve(seen);
  return window.ww.skuImage(sku, position).catch(() => null).then((found) => {
    // Only a FOUND picture is remembered. Remembering "none" meant a folder renamed or added while
    // the app was open never showed up — FBD01, 2026-09-26, after renaming its folder to `FBD 1`.
    if (found) seenImages.set(key, found);
    return found;
  });
}

/**
 * The hovered SKU's picture, in a box of its own beside the list.
 *
 * Small, and only the packet picture: it answers *"which one is this?"* while you look for the one
 * you are about to pack. Everything that DOES something — the tick, the position buttons, adding a
 * picture — stays in the main pane, on the SKU you clicked, so running the cursor down the list
 * cannot arm a control or move what you were looking at.
 */
function Peek({ sku }: { sku: string }) {
  const [file, setFile] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setFile(seenImages.get(`${sku}|2`));
    void findPicture(sku, 2).then((found) => live && setFile(found));
    return () => { live = false; }; // a cursor crossing five rows must not paint the third one last
  }, [sku]);

  return (
    <figure className="peek">
      {file ? <img src={fileUrl(file)} alt={`What goes in a ${sku} packet`} /> : null}
      <figcaption>
        {sku}
        <small>{file === undefined ? "looking…" : file === null ? "no picture" : "click to open it"}</small>
      </figcaption>
    </figure>
  );
}

/** `2026-08-19` → `19 Aug`. Short, for a chip that sits inside a queue row. */
const showDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

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

  // The remembered answer is used SYNCHRONOUSLY when there is one — a promise, even a resolved
  // one, settles a tick late, and that tick is a flash of "Looking…" on a picture already in hand.
  const load = useCallback((fresh = false) => {
    const key = `${sku}|${position}`;
    if (!fresh && seenImages.has(key)) {
      setFile(seenImages.get(key)!);
      return;
    }
    setFile(undefined);
    void findPicture(sku, position, fresh).then(setFile);
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
        {/* The tick goes FIRST. Vansh, 2026-09-12: *"the packed button at orders manifest and image
            session is at the right side, I want it on the left."* It is the one control on this row
            pressed every single time, and it was sitting past two that are pressed occasionally. */}
        {tick}
        <button className={position === 2 ? "chosen" : ""} onClick={() => setPosition(2)}>
          What is in the packet
        </button>
        <button className={position === 1 ? "chosen" : ""} onClick={() => setPosition(1)}>
          Main photo
        </button>
        <button onClick={() => void add()}>
          {file ? "Replace this picture…" : "Add a picture…"}
        </button>
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
        qty === 0 ? (
          /* Looked up rather than being packed — there is no count to show, only the answer. */
          <div className="sku-image empty">
            No picture for <b>{sku}</b> in the ready folder. Check the code, or add one above and it
            shows here from then on.
          </div>
        ) : (
          <div className="sku-nopic">
            <b>{qty}</b>
            <span>
              packet{qty === 1 ? "" : "s"} to pack
              <small>
                no picture for {sku} — add one above and it shows here from then on
              </small>
            </span>
          </div>
        )
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
 * Who packed the batch just ticked — a dropdown over the picture, not a screen instead of it.
 *
 * **It is `<details>`, which is a dropdown the browser already has**: it opens, it closes, it
 * needs no outside-click handler and no state. Open by default, because it appears in answer to
 * something you just did and the answer is usually one click away.
 *
 * **It does not live in the tick, and it must not.** Ticking takes the SKU out of the queue, so
 * anything hanging off that row unmounts a moment later — that was WW-183, thirty-four packets
 * recorded with nobody named. It sits in the pane instead, and the pane is now drawn even when the
 * queue is empty, which is the same bug one level up (WW-198).
 *
 * Naming is allowed to lag: *Not now* leaves the batch in **Nobody named yet**, which is how a
 * busy morning actually goes.
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
    <details className="who-packed" open>
      <summary>
        <b>
          {qty} packet{qty === 1 ? "" : "s"} of {sku} packed
        </b>
        {chosen.length === 0 ? (
          <em>who did it?</em>
        ) : (
          <span>
            {chosen.join(", ")}
            {chosen.length > 1 && ` — ${Number(share.toFixed(2))} each`}
          </span>
        )}
      </summary>

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

        <button className="primary" onClick={onDone}>
          {chosen.length > 0 ? "Done" : "Not now"}
        </button>
      </div>
    </details>
  );
}

/** The tally: what went out today, who packed it, where it is going, and what is still waiting. */
function Summary({
  summary,
  onClose,
  onUnpack,
  onRename,
}: {
  summary: DaySummary;
  onClose: () => void;
  /** Put a SKU back in the queue — see the *By SKU* column below. */
  onUnpack: (sku: string) => void;
  /** Re-open naming for a batch already credited, with the current names preloaded. */
  onRename: (sku: string, qty: number, by: string[]) => void;
}) {
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
          {/**
           * By SKU, with a way back — the tick was one click and undoing it should be too.
           *
           * **It is here and nowhere else**, because this is the only list of what was packed
           * today: a ticked SKU leaves the queue, so the screen behind this has nothing left to
           * put an undo on. Only today's tick is undone, and only a SKU that was packed today
           * appears in this column at all, so yesterday's work cannot be reached from here.
           *
           * ponytail: it gives back the whole SKU's packing for the day, not one packet of it —
           * a mis-click is a mis-click on the tick, which was all of them. If un-doing one of six
           * ever comes up, that is a parcel-level control and belongs beside the delete in
           * *Came back*.
           */}
          {summary.bySku.length > 0 && (
            <div>
              <h3>By SKU</h3>
              <ul>
                {summary.bySku.map((r) => (
                  <li key={r.name}>
                    <span className="lid">{r.name}</span>
                    <span className="qty">{r.qty}</span>
                    {/**
                      * **Who is credited, and a way to change it.** Vansh, 2026-09-06: *"kavita has
                      * done packing but its calculation is not appearing"* — 38 packets had gone in
                      * under one name and naming was a ONE-WAY DOOR: the *nobody named yet* list
                      * only ever offered back the batches with no name at all, so a mis-credit was
                      * permanent. It is somebody's wages; it has to be correctable.
                      */}
                    <span className="who-on-it">{r.by.length > 0 ? r.by.join(", ") : "nobody named"}</span>
                    <button
                      className="undo"
                      title="Change who is credited for these"
                      onClick={() => onRename(r.name, r.qty, r.by)}
                    >
                      change
                    </button>
                    <button className="undo" title="Not packed after all — put it back" onClick={() => onUnpack(r.name)}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rows("By packer", summary.byPacker)}
          {rows("By courier", summary.byCourier)}
        </div>
        <p className="muted">
          <small>
            <b>Undo</b> puts that SKU&apos;s packing back in the queue for today only — the packets,
            the names and the money with it. Yesterday&apos;s stays as it was.
          </small>
        </p>
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
  /** What an import just did, when it has something to report. */
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState(false);
  /**
   * A SKU typed in to be LOOKED AT, with no packing involved.
   *
   * Vansh: *"a search where I enter the SKU no. and it gives me the image for it, for a random
   * search without the manifest — nothing packed and all of that, just the image, for when I want
   * to check my main and inventory image for some listing."* It is a different job from working
   * the queue and it has to work when the queue is empty, which is most of the day: everything is
   * packed by mid-morning and this screen is otherwise blank until tomorrow's manifest.
   */
  const [lookup, setLookup] = useState("");
  /**
   * The SKU under the cursor — *"if I hover over any listing then its inventory image opens"*,
   * which is how you check what a code IS while looking for the one you are about to pack.
   *
   * **It shows in a box of its own beside the list, and the main pane never moves.** It used to
   * drive the main pane, and that was the glitching Vansh reported on 2026-08-31: crossing the
   * list to reach the picture you had SELECTED swapped it for every SKU on the way, and the
   * picture, the packet count and the tick all changed under the cursor. A hover is a look; only
   * a click chooses.
   */
  const [hover, setHover] = useState<string | null>(null);
  /**
   * The batch waiting to be named: what was just ticked, or a SKU picked back out of *nobody
   * named*. It lives HERE and not in the tick, because ticking removes the SKU from the queue and
   * anything hanging off that row is unmounted with it (WW-183).
   */
  const [naming, setNaming] = useState<{ skus: string[]; qty: number } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  /**
   * Several SKUs picked at once — Vansh, 2026-09-26: *"select all or left click drag down to select
   * those options."* A morning's packing is done in a pile, and ticking nine SKUs one at a time
   * means nine clicks, nine pictures and nine naming strips for what was one job.
   * Drag down the list, shift-click a range, ctrl/⌘-click one more, or *Select all*.
   */
  const [picked, setPicked] = useState<string[]>([]);
  const dragFrom = useRef<number | null>(null);
  /**
   * *By SKU*, or *By delivery partner* — Vansh, 2026-09-26: *"two options on top… when I click any
   * delivery partner it toggles its dropdown open and the rest close."* Delhivery comes first
   * because his van is the first at the door. Remembered per machine.
   */
  const [byCourier, setByCourier] = useState(() => {
    try {
      return localStorage.getItem("orders.byCourier") === "1";
    } catch {
      return false;
    }
  });
  /** The one courier section open. `undefined` = the first one; `null` = all closed. */
  const [openCourier, setOpenCourier] = useState<string | null | undefined>(undefined);

  /** Show another manifest date. Selection belongs to the date it was made on, so it goes. */
  function openDay(date: string) {
    setPicked([]);
    setSku(null);
    setNaming(null);
    setOpenCourier(undefined);
    void window.ww.orders(date).then(setView, (e: Error) => setError(e.message));
  }

  useEffect(() => {
    // Same rule as the picture below: an IPC rejection never settles, so it must be caught here or
    // the screen waits for ever on a call that has already failed.
    void window.ww.orders().then(setView, (e: Error) => setError(e.message));
    void window.ww.workers().then(setWorkers, () => setWorkers([]));
  }, []);

  const queue = view?.outstanding ?? [];
  type Row = (typeof queue)[number];
  /**
   * One section per courier, in the order they collect. A SKU split across two couriers is in both,
   * showing that courier's count — ticking it still packs every parcel of it on this date.
   */
  const sections: { name: string; rows: { r: Row; qty: number }[] }[] = [];
  if (byCourier) {
    const by = new Map<string, { rank: number; rows: { r: Row; qty: number }[] }>();
    for (const r of queue)
      for (const c of r.byCourier) {
        if (!by.has(c.name)) by.set(c.name, { rank: c.rank, rows: [] });
        by.get(c.name)!.rows.push({ r, qty: c.qty });
      }
    for (const [name, v] of [...by].sort((a, b) => a[1].rank - b[1].rank || a[0].localeCompare(b[0])))
      sections.push({ name, rows: v.rows });
  }
  const open = openCourier === undefined ? (sections[0]?.name ?? null) : openCourier;
  /** What Select all and a drag work over: the open courier's rows, or the whole list. */
  const visible = byCourier ? (sections.find((x) => x.name === open)?.rows.map((x) => x.r) ?? []) : queue;
  const pickedQty = queue.filter((r) => picked.includes(r.sku)).reduce((n, r) => n + r.qty, 0);
  const row = view?.outstanding.find((r) => r.sku === sku) ?? null;
  const packets = view?.outstanding.reduce((n, r) => n + r.qty, 0) ?? 0;
  /** The main pane follows the SELECTION. Hovering has its own box; see `hover`. */
  const showing = sku;
  const showingQty = row?.qty ?? 0;

  /** Tick a batch off and go straight to naming it — the two halves of one action. */
  function pack(target: string, qty: number, limit?: number) {
    setNaming({ skus: [target], qty: limit ?? qty });
    setChosen([]);
    void window.ww
      .packing("pack", target, view!.day, limit === undefined ? {} : { limit })
      .then(setView, (e: Error) => setError(e.message));
  }

  /**
   * Every picked SKU packed, then one naming strip for the lot. One at a time, not in parallel:
   * each call rewrites the same month file, and two at once would lose one of the writes.
   */
  async function packPicked() {
    const rows = queue.filter((r) => picked.includes(r.sku));
    setPicked([]);
    setNaming({ skus: rows.map((r) => r.sku), qty: rows.reduce((n, r) => n + r.qty, 0) });
    setChosen([]);
    try {
      for (const r of rows) setView(await window.ww.packing("pack", r.sku, view!.day, {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Name (or rename) the batch on screen. `replacing` keeps a second batch off the first one's. */
  async function credit(names: string[]) {
    if (!naming || !view) return;
    const replacing = chosen;
    setChosen(names);
    try {
      // Sequential for the same reason as `packPicked`: one file, one writer at a time.
      for (const target of naming.skus)
        setView(await window.ww.packing("credit", target, view.day, { by: names, replacing }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
        else {
          setView(r.result);
          // An orders export says what it DID — new, packed, RTO, cancelled. A manifest carries no
          // note and this stays null, exactly as before.
          if (r.note) setNote(r.note);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setSku(null);
    setPicked([]);
    setBusy(false);
  }

  /** One list of rows — the whole queue, or one courier's section. Drag and shift-click range over it. */
  function rowList(rows: { r: Row; qty: number }[]) {
    const list = rows.map((x) => x.r);
    return (
      <ul onMouseLeave={() => setHover(null)} onMouseUp={() => (dragFrom.current = null)}>
        {rows.map(({ r, qty }, i) => (
          <li key={r.sku}>
            <button
              className={`${r.sku === sku ? "chosen" : ""} ${picked.includes(r.sku) ? "picked" : ""}`}
              onMouseDown={(e) => {
                if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
                dragFrom.current = i;
                // Stop the browser starting a text selection under the drag.
                e.preventDefault();
              }}
              onMouseEnter={(e) => {
                setHover(r.sku);
                // Button released outside the list: the drag is over, not still going.
                if (dragFrom.current === null || e.buttons !== 1) return (dragFrom.current = null);
                const [a, b] = [Math.min(dragFrom.current, i), Math.max(dragFrom.current, i)];
                setPicked(list.slice(a, b + 1).map((q) => q.sku));
              }}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  setPicked(picked.includes(r.sku) ? picked.filter((p) => p !== r.sku) : [...picked, r.sku]);
                  return;
                }
                if (e.shiftKey) {
                  const from = Math.max(0, list.findIndex((q) => q.sku === (picked.at(-1) ?? sku)));
                  const [a, b] = [Math.min(from, i), Math.max(from, i)];
                  setPicked(list.slice(a, b + 1).map((q) => q.sku));
                  return;
                }
                setPicked([]);
                setSku(r.sku);
                setNaming(null);
              }}
            >
              <span className="qty">{qty}</span>
              <span className="lid">{r.sku}</span>
              {/* In a courier section: this courier's share of a SKU split across two. */}
              {qty !== r.qty && <em>of {r.qty}</em>}
              {/* The split, when a SKU sold on both. They are not interchangeable: the money
                  differs per marketplace, and at handover they go to different couriers. */}
              {r.byMarket.length > 1 && (
                <em>{r.byMarket.map((m) => `${m.qty}${m.name[0].toUpperCase()}`).join(" ")}</em>
              )}
            </button>
          </li>
        ))}
      </ul>
    );
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
        <strong>
          {busy ? "Reading it…" : "Drop the manifest PDF — or an orders export (.csv)"}
        </strong>
        <div className="picks">
          <button onClick={() => void window.ww.pick("orders", "files").then(load)}>
            Choose a manifest…
          </button>
          {view && <button onClick={() => setTally(true)}>Today&apos;s tally</button>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="allgood">{note}</p>}

      <div className="sku-lookup">
        <input
          type="text"
          placeholder="Look up a SKU — see its pictures without touching the packing…"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setLookup("")}
        />
        {lookup.trim() !== "" && <button onClick={() => setLookup("")}>Clear</button>}
      </div>

      {lookup.trim() !== "" ? (
        <div className="sku-detail">
          <h2>
            {lookup.trim().toUpperCase()}
            <small>just looking — nothing here is packed or counted</small>
          </h2>
          {/* No tick: this is a look, not a job. Handing it one would put a control that changes
              the pay record next to a box somebody is typing a guess into. */}
          <SkuImage sku={lookup.trim()} qty={0} tick={null} />
        </div>
      ) : view === null ? (
        <p className={error ? "error" : "muted"}>{error ?? "Looking…"}</p>
      ) : (
        /**
         * **Drawn whenever there is a queue OR a batch waiting to be named**, and that second half
         * is the fix for the bug Vansh hit every single manifest: *"the last packing on clicking
         * the packing is not picking up the who packed."*
         *
         * Ticking the LAST SKU empties `outstanding`, and this whole block used to be gated on it
         * being non-empty — so the naming step was unmounted in the same render that created it,
         * and the last batch of every manifest went in with nobody named. Exactly WW-183 again, one
         * level up: the pane a control lives in disappeared underneath it. The queue emptying is
         * not the end of the work; naming it is.
         */
        <div className="orders-body">
          <aside className="sku-list">
            <h3>
              To pack
              <small>
                {queue.length} SKUs · {packets} packets · {view.summary.packets} packed
              </small>
            </h3>
            {/* Which manifest date. Each date's parcels stay that date's — nothing carries into
                another day's list — and a tick here is recorded under this date (WW-254). */}
            <div className="day-chips">
              {view.days.map((d) => (
                <button key={d.date} className={d.date === view.day ? "chosen" : ""} onClick={() => openDay(d.date)}>
                  {showDay(d.date)}
                  {d.qty > 0 && <em>{d.qty}</em>}
                </button>
              ))}
            </div>
            <div className="queue-tools">
              <div className="seg">
                {([false, true] as const).map((c) => (
                  <button
                    key={String(c)}
                    className={byCourier === c ? "chosen" : ""}
                    onClick={() => {
                      setByCourier(c);
                      setPicked([]);
                      try {
                        localStorage.setItem("orders.byCourier", c ? "1" : "0");
                      } catch {
                        // A per-machine convenience; the choice still holds for this session.
                      }
                    }}
                  >
                    {c ? "By partner" : "By SKU"}
                  </button>
                ))}
              </div>
              {visible.length > 0 && (
                <button onClick={() => setPicked(picked.length === visible.length ? [] : visible.map((r) => r.sku))}>
                  {picked.length === visible.length ? "Select none" : "Select all"}
                </button>
              )}
            </div>
            {picked.length > 1 && (
              <div className="picked-bar">
                <span>
                  {picked.length} SKUs · {pickedQty} packets
                </span>
                <button className="primary" onClick={() => void packPicked()}>
                  Mark all packed
                </button>
                <button onClick={() => setPicked([])}>Clear</button>
              </div>
            )}
            {queue.length === 0 && (
              <p className="muted">
                {view.summary.packets > 0
                  ? `Nothing left — ${view.summary.packets} done for ${showDate(view.day)}.`
                  : "Nothing to pack. Drop the manifest in above."}
              </p>
            )}
            {byCourier ? (
              sections.map((sec) => (
                <div key={sec.name} className={`courier-sec ${open === sec.name ? "open" : ""}`}>
                  <button
                    className="courier-head"
                    onClick={() => {
                      setPicked([]);
                      setOpenCourier(open === sec.name ? null : sec.name);
                    }}
                  >
                    <b>{sec.name || "No courier"}</b>
                    <span>
                      {sec.rows.length} SKU{sec.rows.length === 1 ? "" : "s"} · {sec.rows.reduce((n, x) => n + x.qty, 0)} packets
                    </span>
                  </button>
                  {open === sec.name && rowList(sec.rows)}
                </div>
              ))
            ) : (
              rowList(queue.map((r) => ({ r, qty: r.qty })))
            )}

            {/* Sticks to the bottom of the list, so it is in the same place whichever row the
                cursor is on, and it does not reflow the list it sits under. */}
            {/* Only a SKU still in the list: ticking the last one empties the list under the cursor, so no
                mouse-leave ever fires and the old hover would sit here from a previous manifest. */}
            {hover !== null && hover !== sku && queue.some((r) => r.sku === hover) && <Peek sku={hover} />}

            {/* Where a cancelled order goes. Said here because this is where the wrong count is
                noticed — the queue says 19 and the marketplace has cancelled one of them. */}
            <p className="muted">
              <small>
                An order cancelled? Delete it in <b>Came back</b> — search its SKU or order number.
              </small>
            </p>

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
                        className={`unnamed ${naming?.skus.length === 1 && naming.skus[0] === r.name ? "chosen" : ""}`}
                        onClick={() => {
                          setNaming({ skus: [r.name], qty: r.qty });
                          setChosen([]);
                          // And its picture — it has left the queue, but it is what you are naming.
                          setSku(r.name);
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
            {/* A strip ABOVE the picture, never instead of it — Vansh: *"I don't like the UI… it
                was just a dropdown, a multi select dropdown with a plus sign to add someone new."*
                It took the whole pane over, so ticking a SKU replaced the thing you were looking
                at with a form. It is the same multi-select; it just no longer evicts the screen. */}
            {naming !== null && (
              <WhoPacked
                sku={naming.skus.join(", ")}
                qty={naming.qty}
                workers={workers}
                chosen={chosen}
                onPick={(names) => void credit(names)}
                onAddWorker={addWorker}
                onDone={() => setNaming(null)}
              />
            )}
            {showing === null ? (
              /* With an empty queue there is nothing on the left to pick, so the old line —
                 *pick a SKU on the left* — pointed at a list that is not there. */
              naming === null && (
                <p className="muted">
                  {view.outstanding.length === 0
                    ? "Nothing waiting. Drop the next manifest in when it comes, or look a SKU up above."
                    : "Pick a SKU on the left, or hover one to see its picture."}
                </p>
              )
            ) : (
              <>
                <h2>
                  {showing}
                  <small>
                    {row === null
                      ? "nothing left of this one"
                      : `${showingQty} packet${showingQty === 1 ? "" : "s"} to make`}
                  </small>
                </h2>
                <SkuImage
                  sku={showing}
                  qty={showingQty}
                  tick={
                    /* Only the SELECTED SKU can be ticked — and now that hovering cannot change
                       what is on show, the control is never armed for a SKU you merely passed. */
                    row !== null ? (
                      <PackedTick qty={row.qty} onPack={(limit) => pack(row.sku, row.qty, limit)} />
                    ) : null
                  }
                />
              </>
            )}
          </div>
        </div>
      )}

      {tally && view && (
        <Summary
          summary={view.summary}
          onClose={() => setTally(false)}
          onRename={(target, qty, by) => {
            // The names already on it become `chosen`, so `credit` REPLACES them rather than
            // adding a second set beside the first — see `creditSku`'s `replacing`.
            setNaming({ skus: [target], qty });
            setChosen(by);
            setTally(false);
          }}
          onUnpack={(target) => {
            // The batch being named may be the one going back; leaving that strip up would offer
            // to credit packets that no longer exist.
            if (naming?.skus.includes(target)) setNaming(null);
            void window.ww
              .packing("unpack", target, view.day, {})
              .then(setView, (e: Error) => setError(e.message));
          }}
        />
      )}
    </section>
  );
}

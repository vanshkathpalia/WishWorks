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
function SkuImage({ sku, tick }: { sku: string; tick: React.ReactNode }) {
  const [position, setPosition] = useState(2);
  const [file, setFile] = useState<string | null | undefined>(undefined);

  const load = useCallback(() => {
    setFile(undefined);
    void window.ww.skuImage(sku, position).then(setFile);
  }, [sku, position]);
  useEffect(load, [load]);

  async function add() {
    const [picked] = await window.ww.pick("orders-image", "files");
    if (!picked) return;
    await window.ww.addSkuImage(sku, position, picked);
    load();
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
        <div className="sku-image empty">
          No picture for <b>{sku}</b> in the ready folder. Finished listings land there on their
          own; anything else needs one adding above. It is filed under that SKU&apos;s own code, so
          the shared drive stays readable.
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
 * Done, and — only if you want to say — who did it.
 *
 * **Two answers, and the second is optional.** Ticking used to demand a name before it would
 * register at all. Vansh, 2026-08-20: *"as soon as that is checked we give a dropdown only when
 * that is checked to select the packer… and we can even skip filling the packer for now by
 * clicking somewhere else on the screen."*
 *
 * So: ticking marks every outstanding parcel of this SKU packed straight away and opens the packer
 * menu; clicking anywhere else closes the menu and leaves it packed with nobody named, which is a
 * real state — the names can be filled in later, and the tally says how many are waiting for one.
 * More than one name splits the credit evenly, which is what they already do between themselves.
 */
function PackedTick({
  qty,
  onPack,
  onCredit,
  workers,
  onAddWorker,
}: {
  qty: number;
  onPack: () => void;
  onCredit: (by: string[]) => void;
  workers: string[];
  onAddWorker: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Clicking anywhere else IS the skip, so it closes from a click on the whole document — not
  // from a blur, which never fires for a click on plain text.
  useEffect(() => {
    if (!open) return;
    const shut = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", shut);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", shut);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function pick(names: string[]) {
    setChosen(names);
    onCredit(names);
  }

  const share = chosen.length > 0 ? qty / chosen.length : 0;

  return (
    <div className="packed-tick-wrap" ref={box}>
      <label className="packed-tick">
        {/* Never checked: ticking takes the SKU off the list entirely, so the box it was ticked in
            is gone a moment later. Leaving it visually unchecked is honest about that. */}
        <input
          type="checkbox"
          checked={false}
          onChange={() => {
            onPack();
            setChosen([]);
            setOpen(true);
          }}
        />
        <span>Packed{qty > 1 ? ` — all ${qty}` : ""}</span>
      </label>

      {open && (
        <div className="packer-menu">
          <p className="muted">Who packed {qty === 1 ? "it" : `these ${qty}`}?</p>
          {workers.map((name) => {
            const on = chosen.includes(name);
            return (
              <button
                key={name}
                className={on ? "chosen" : ""}
                onClick={() => pick(on ? chosen.filter((n) => n !== name) : [...chosen, name])}
              >
                <span>{name}</span>
                {on && <em>{Number(share.toFixed(2))}</em>}
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
                pick([...chosen, adding.trim()]);
                setAdding(null);
              }}
            />
          )}

          <p className="muted">
            {chosen.length > 1
              ? `Split ${chosen.length} ways — ${Number(share.toFixed(2))} packets each.`
              : "Or click away — it stays packed and you can name them later."}
          </p>
        </div>
      )}
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

  useEffect(() => {
    void window.ww.orders().then(setView);
    void window.ww.workers().then(setWorkers);
  }, []);

  const row = view?.outstanding.find((r) => r.sku === sku) ?? null;
  const packets = view?.outstanding.reduce((n, r) => n + r.qty, 0) ?? 0;

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
      const r = await window.ww.addManifest(file);
      if (!r.ok) setError(r.message);
      else setView(r.result);
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
        <p className="muted">Looking…</p>
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
            <ul>
              {view.outstanding.map((r) => (
                <li key={r.sku}>
                  <button className={r.sku === sku ? "chosen" : ""} onClick={() => setSku(r.sku)}>
                    <span className="qty">{r.qty}</span>
                    <span className="lid">{r.sku}</span>
                  </button>
                </li>
              ))}
            </ul>

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
            {row === null ? (
              <p className="muted">Pick a SKU on the left.</p>
            ) : (
              <>
                <h2>
                  {row.sku}
                  <small>
                    {row.qty} packet{row.qty === 1 ? "" : "s"} to make
                  </small>
                </h2>
                <SkuImage
                  sku={row.sku}
                  tick={
                    <PackedTick
                      qty={row.qty}
                      workers={workers}
                      onAddWorker={addWorker}
                      /* Ticking takes the SKU straight off the list. Anything that arrives for it
                         afterwards is a new parcel and comes back as a new, smaller number. */
                      onPack={() =>
                        void window.ww.packing("pack", row.sku, view.today, []).then(setView)
                      }
                      onCredit={(by) =>
                        void window.ww.packing("credit", row.sku, view.today, by).then(setView)
                      }
                    />
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

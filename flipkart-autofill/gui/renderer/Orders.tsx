/**
 * Orders.tsx — the day's packing list, off the marketplace's own manifest.
 *
 * What it replaces: reading the acceptance page and writing every order and SKU onto paper.
 * Vansh, 2026-08-19: *"we are checking which order had come and we are manually writing it on a
 * page — that is a very time consuming thing, it can cause errors."* The manifest is the same
 * list, already correct, already printed for the courier. **The marketplace's number wins**: it
 * is the one both sides are held to, and a label mismatch shows up at handover, before the parcel
 * leaves.
 *
 * The shape is the one he asked for: the SKUs down the left, and the rest of the screen given to
 * **the picture of what goes in the packet** — the second finished image out of the ready folder,
 * because a person packing needs to see the contents, not read a code. Under it, how many packets
 * to make, and the tick that says it is done and who did it.
 *
 * **Who packed it is not decoration.** The workers are paid monthly on how many packets they did,
 * and that count lives on the same sheet of paper this screen replaces — so it has to be captured
 * at the moment the box is closed, or it is not captured at all. Two people on one SKU is half
 * each, which is exactly how they already split it ("six and four, fifty fifty, no problem").
 */

import React, { useCallback, useEffect, useState } from "react";
import type { OrderDay, OrderRow } from "../shared.js";
import { fileUrl } from "./ui.js";

/** Packets per worker over the days given — the only number pay day needs. */
function credit(days: OrderDay[]): [string, number][] {
  const out = new Map<string, number>();
  for (const day of days) {
    for (const row of day.rows) {
      for (const who of row.packedBy) out.set(who, (out.get(who) ?? 0) + row.qty / row.packedBy.length);
    }
  }
  return [...out].sort((a, b) => b[1] - a[1]);
}

const monthOf = (date: string) => date.slice(0, 7);

/** `2026-08-19` → `19 Aug 2026`. The panel shows dates the way the manifest prints them. */
const showDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * The picture for the SKU on screen, or a plain reason there isn't one.
 *
 * Reloaded per SKU rather than fetched for the whole list up front: the ready folder is on a
 * shared drive, and walking it seven times on a click is cheaper than walking it once at launch
 * for a screen that might not be opened.
 *
 * **Opens on image 2 and stays there**, because that is the one that shows what goes in the
 * packet. Image 1 is the shop-window photo and is one click away — Vansh, 2026-08-19: *"I want an
 * option to see the 1st image of that SKU too, by default inventory, but if I want to then there
 * only I should have the option."*
 *
 * **Adding a picture is here rather than in a settings screen** because this is where the gap is
 * discovered: his own listings come out of the finish step named and grouped, his partner's never
 * went through it at all, so the first anyone knows about a missing picture is standing in front
 * of a parcel. The file is copied into the ready folder under the SKU's own code.
 */
function SkuImage({ sku }: { sku: string }) {
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
      </div>

      {file === undefined ? (
        <div className="sku-image empty">Looking for the picture…</div>
      ) : file === null ? (
        <div className="sku-image empty">
          No picture for <b>{sku}</b> in the ready folder. Finished listings land there on their
          own; anything else — a SKU that was never listed through this app — needs one adding
          above. It is filed under <b>{sku.replace(/[^A-Za-z0-9]+/g, "-")}</b> in that SKU&apos;s
          own folder, so the shared drive stays readable.
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
 * Who packed this SKU. Names are clicked, never typed — the same rule the whole app follows for
 * IDs and paths, and here it is also what keeps one worker from becoming two spellings in the
 * monthly total.
 */
function PackedBy({
  row,
  workers,
  onChange,
  onAddWorker,
}: {
  row: OrderRow;
  workers: string[];
  onChange: (packedBy: string[]) => void;
  onAddWorker: (name: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const share = row.packedBy.length > 0 ? row.qty / row.packedBy.length : 0;

  return (
    <div className="packed-by">
      <label className="packed-tick">
        <input
          type="checkbox"
          checked={row.packedBy.length > 0}
          /* Unticking clears the names: "not packed" and "packed by nobody" must not be one state
             that quietly keeps paying somebody. */
          onChange={(e) => onChange(e.target.checked ? workers.slice(0, 1) : [])}
        />
        <span>Packed{row.packedBy.length > 0 ? ` — ${row.qty} done` : ""}</span>
      </label>

      <div className="who">
        {workers.map((name) => {
          const on = row.packedBy.includes(name);
          return (
            <button
              key={name}
              className={on ? "chosen" : ""}
              onClick={() => onChange(on ? row.packedBy.filter((n) => n !== name) : [...row.packedBy, name])}
            >
              {name}
              {on && <em> {Number(share.toFixed(2))}</em>}
            </button>
          );
        })}
        <input
          type="text"
          placeholder="add a packer…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !adding.trim()) return;
            onAddWorker(adding.trim());
            setAdding("");
          }}
        />
      </div>
      {row.packedBy.length > 1 && (
        <p className="muted">
          Split {row.packedBy.length} ways — {Number(share.toFixed(2))} packets each toward this
          month&apos;s pay.
        </p>
      )}
    </div>
  );
}

export function Orders() {
  const [days, setDays] = useState<OrderDay[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [sku, setSku] = useState<string | null>(null);
  const [workers, setWorkers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.ww.orderDays().then((d) => {
      setDays(d);
      setDate((now) => now ?? d[0]?.date ?? null);
    });
    void window.ww.workers().then(setWorkers);
  }, []);

  const day = days?.find((d) => d.date === date) ?? null;
  const row = day?.rows.find((r) => r.sku === sku) ?? null;
  const packets = day?.rows.reduce((n, r) => n + r.qty, 0) ?? 0;
  const done = day?.rows.filter((r) => r.packedBy.length > 0).reduce((n, r) => n + r.qty, 0) ?? 0;

  /** Write the day back and keep the screen on the same object — no reload, no lost click. */
  function patch(next: OrderDay) {
    setDays((all) => (all ?? []).map((d) => (d.date === next.date ? next : d)));
    void window.ww.saveDay(next);
  }

  function setPackedBy(target: OrderRow, packedBy: string[]) {
    if (!day) return;
    patch({ ...day, rows: day.rows.map((r) => (r === target ? { ...r, packedBy } : r)) });
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
      const r = await window.ww.addManifest(file);
      if (!r.ok) {
        setError(r.message);
        continue;
      }
      setDate(r.result.date);
      setSku(null);
    }
    setDays(await window.ww.orderDays());
    setBusy(false);
  }

  const month = date ? credit((days ?? []).filter((d) => monthOf(d.date) === monthOf(date))) : [];

  return (
    <section className="panel orders">
      <header>
        <h1>Today&apos;s orders</h1>
        <p>
          Drop the supplier manifest in. It lists every SKU and how many of each, so nothing gets
          copied out by hand. Pick a SKU to see what goes in the packet, then tick it off and say
          who packed it — that tick is what the month&apos;s pay is worked out from.
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
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {days !== null && days.length > 1 && (
        <div className="picks days">
          {days.slice(0, 14).map((d) => (
            <button key={d.date} className={d.date === date ? "chosen" : ""} onClick={() => setDate(d.date)}>
              {showDate(d.date)}
            </button>
          ))}
        </div>
      )}

      {day === null ? (
        <p className="muted">
          {days === null ? "Looking…" : "No manifest read yet. Download it from the seller panel and drop it in."}
        </p>
      ) : (
        <div className="orders-body">
          <aside className="sku-list">
            <h3>
              {showDate(day.date)}
              <small>
                {day.rows.length} SKUs · {packets} packets · {done} packed
              </small>
            </h3>
            <ul>
              {day.rows.map((r) => (
                <li key={r.sku}>
                  <button
                    className={`${r.sku === sku ? "chosen" : ""} ${r.packedBy.length > 0 ? "done" : ""}`}
                    onClick={() => setSku(r.sku)}
                  >
                    <span className="qty">{r.qty}</span>
                    <span className="lid">{r.sku}</span>
                    {r.packedBy.length > 0 && <em>{r.packedBy.join(", ")}</em>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted from-where">
              From {day.sources.join(", ")}. Drop the other courier&apos;s manifest in too — it
              adds to this day, and the same file twice changes nothing.
            </p>

            {month.length > 0 && (
              <div className="month-pay">
                <h3>
                  This month
                  <small>packets each, for pay</small>
                </h3>
                <ul>
                  {month.map(([who, n]) => (
                    <li key={who}>
                      <span className="lid">{who}</span>
                      <span className="qty">{Number(n.toFixed(2))}</span>
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
                <PackedBy
                  row={row}
                  workers={workers}
                  onChange={(packedBy) => setPackedBy(row, packedBy)}
                  onAddWorker={addWorker}
                />
                <SkuImage sku={row.sku} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

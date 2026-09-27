/**
 * NewListing.tsx — a costed kit to a filled Flipkart draft, with one press per stage (WW-267).
 *
 * Four steps, two of them his:
 *   1. Make images      — pick up to 10 kits, press once; ChatGPT makes them one kit at a time
 *   2. Your check       — each image side by side: Redo with a note, answer the sizes question
 *   3. To Flipkart      — one press: listing text, files, finish, new draft, images, every tab
 *   4. Your read        — open the draft, read it, press Send to QC yourself
 *
 * **The next button to press is lit** (`next-up`), and a click on empty space scrolls to it — the
 * partner should never have to hunt for what comes next. What the screen shows is the job file on disk,
 * re-read whenever the engine says a row changed, so it is never ahead of what really happened.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NlRow } from "../shared.js";
import { fileUrl } from "./ui.js";

const MAX_PICK = 10;

const STAGE: Record<string, string> = {
  queued: "waiting its turn",
  images: "ChatGPT is making the images",
  review: "your check",
  listing: "going to Flipkart",
  done: "draft filled — your read",
  failed: "stopped",
};

export function NewListing({ n }: { n: number }) {
  const [rows, setRows] = useState<NlRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState<Record<string, string>>({});
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const root = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    void window.ww.nlList().then((r) => {
      setRows(r.rows);
      setBusy(r.busy);
    });
  }, []);
  useEffect(() => {
    load();
    return window.ww.onNlChanged(load);
  }, [load]);

  /** Every button press goes through here: one message at the top, the list re-read after. */
  const act = (p: Promise<{ ok: boolean; message?: string; note?: string } | void>) => {
    setError(null);
    setNote(null);
    void p.then((r) => {
      if (r && !r.ok) setError(r.message ?? "Stopped.");
      else if (r?.note) setNote(r.note);
      load();
    });
    setTimeout(load, 300);
  };

  /** A click on empty space brings the lit button into view — the "what now?" answer. */
  const toNext = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea, label, a, img, summary")) return;
    root.current?.querySelector<HTMLElement>(".next-up")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const inFlow = rows.filter((r) => r.job && r.job.stage !== "queued");
  const canStart = rows.filter((r) => !r.blocked && (!r.job || r.job.stage === "queued"));
  const shown = showAll ? rows : rows.filter((r) => !r.live);
  const running = !!busy;
  // Only ONE button on the screen is lit: the first kit that needs a person, else "make images".
  const litSku = inFlow.find((r) => r.next && r.next !== "start")?.sku ?? null;

  return (
    <section className="panel new-listing" ref={root} onClick={toNext}>
      <header>
        <h1>{n ? `${n}. New listing` : "New listing"}</h1>
        <p>
          From a costed kit to a filled Flipkart draft. You do two things: <b>check the images</b>, and{" "}
          <b>read the draft before Send to QC</b>. Everything else runs by itself. Click any empty space
          to jump to the next button to press.
        </p>
        <ol className="nl-steps">
          <li>Make images <small>automatic</small></li>
          <li className="yours">Your check <small>redo anything wrong</small></li>
          <li>To Flipkart <small>automatic, one press</small></li>
          <li className="yours">Your read <small>then Send to QC yourself</small></li>
        </ol>
      </header>

      {busy && <p className="allgood">Working on {busy} — ChatGPT and Chrome are busy; leave them be.</p>}
      {note && <p className="allgood">{note}</p>}
      {error && <p className="error">{error}</p>}

      {inFlow.map((r) => {
        const j = r.job!;
        const lit = r.sku === litSku && !running;
        const v = `?v=${encodeURIComponent(j.updatedAt)}`;
        return (
          <div key={r.sku} className={`nl-card stage-${j.stage}`}>
            <h2>
              {r.sku} <span className="count">{STAGE[j.stage] ?? j.stage}</span>
            </h2>
            {j.error && <p className="error">{j.error}</p>}

            {Object.keys(j.images).length > 0 && (
              <div className="nl-images">
                {Object.entries(j.images)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([num, file]) => (
                    <figure key={num}>
                      <img src={fileUrl(file) + v} alt={`image ${num}`} />
                      <figcaption>
                        <b>{num === "1" ? "1 · main photo" : num === "2" ? "2 · what's in the box" : `${num} · sizes`}</b>
                        {j.stage === "review" && (
                          <>
                            <input
                              placeholder="what is wrong? e.g. 6 hearts, kit has 8"
                              value={wrong[`${r.sku}-${num}`] ?? ""}
                              onChange={(e) => setWrong({ ...wrong, [`${r.sku}-${num}`]: e.target.value })}
                            />
                            <button disabled={running} onClick={() => act(window.ww.nlRedo(r.sku, Number(num), wrong[`${r.sku}-${num}`] ?? ""))}>
                              Redo {num}
                            </button>
                            {Number(num) > 2 && (
                              <button disabled={running} onClick={() => act(window.ww.nlDrop(r.sku, Number(num)))}>
                                Leave out
                              </button>
                            )}
                          </>
                        )}
                      </figcaption>
                    </figure>
                  ))}
              </div>
            )}

            {j.stage === "review" && j.sizesQuestion && (
              <div className="nl-sizes">
                <p>
                  <b>ChatGPT asks about sizes for image 3.</b> Answer below, or leave image 3 out — it is optional.
                </p>
                <pre>{j.sizesQuestion}</pre>
                <textarea
                  rows={3}
                  placeholder="e.g. Hearts 18 inch inflated. Everything else as you listed. Generate the image."
                  value={sizes[r.sku] ?? ""}
                  onChange={(e) => setSizes({ ...sizes, [r.sku]: e.target.value })}
                />
                <button disabled={running} onClick={() => act(window.ww.nlSizes(r.sku, sizes[r.sku] ?? ""))}>
                  Send sizes, make image 3
                </button>
              </div>
            )}

            <div className="picks">
              {r.next === "continue" && (
                <button className={lit ? "primary next-up" : "primary"} disabled={running} onClick={() => act(window.ww.nlContinue(r.sku))}>
                  Images are right — continue to Flipkart
                </button>
              )}
              {r.next === "open-draft" && (
                <>
                  <button className={lit ? "primary next-up" : "primary"} onClick={() => act(window.ww.nlOpenDraft(r.sku))}>
                    Open the draft in Chrome
                  </button>
                  <span className="muted">Draft {j.draftId}. Read every tab, then press Send to QC in Chrome yourself.</span>
                </>
              )}
              {r.next === "retry" && (
                <button className={lit ? "next-up" : ""} disabled={running} onClick={() => act(window.ww.nlRetry(r.sku))}>
                  Try again from {j.failedAt === "listing" ? "the Flipkart step" : "the images"}
                </button>
              )}
            </div>

            <details>
              <summary>What happened ({j.log.length})</summary>
              <ul className="nl-log">
                {j.log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}

      <h2>
        Kits <span className="count">{canStart.length} can start</span>
      </h2>
      <div className="picks">
        <button
          className={!litSku && picked.length && !running ? "primary next-up" : "primary"}
          disabled={running || picked.length === 0}
          onClick={() => {
            act(window.ww.nlStart(picked));
            setPicked([]);
          }}
        >
          Make images for {picked.length || "the"} picked kit{picked.length === 1 ? "" : "s"}
        </button>
        <label className="inline">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show kits already live on Flipkart
        </label>
      </div>
      <table className="latch-table">
        <tbody>
          {shown.map((r) => {
            const can = !r.blocked && (!r.job || r.job.stage === "queued");
            return (
              <tr key={r.sku} className={r.blocked ? "blocked" : ""}>
                <td>
                  <input
                    type="checkbox"
                    disabled={!can || running || (!picked.includes(r.sku) && picked.length >= MAX_PICK)}
                    checked={picked.includes(r.sku)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, r.sku] : picked.filter((s) => s !== r.sku))}
                  />
                </td>
                <td className="sku">{r.sku}</td>
                <td className="thumb">{r.photo && <img src={fileUrl(r.photo)} alt="" />}</td>
                <td className="why">{r.blocked ?? (r.job ? STAGE[r.job.stage] : "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Latch.tsx — turn a rival's label pack into the list of their products we can still list against.
 *
 * **The shape of the screen is the shape of the answer.** Drop a Flipkart label pack in; it
 * becomes a list of their products, best-seller first. Ask Flipkart where each one stands, and
 * most come back *already selling* — which is the useful half, because it is work not to do. What
 * is left under "New" is the actual job, and one button opens a filled form for every one of them.
 *
 * Nothing here saves a listing. Every form lands with the SKU blank, because the SKU on their
 * label is theirs; only Vansh knows which of his it should be.
 */

import { useEffect, useState } from "react";
import type { ImageJob, LabelPack, LatchBook, LatchRecord, Pending } from "../shared.js";

/**
 * `₹190` — paise back to something a person reads.
 *
 * A copy of the engine's `rupees`, and deliberately so: importing the VALUE from `latch-core.ts`
 * pulls `node:fs` into a browser bundle and the build fails. Four lines duplicated is the price of
 * that boundary, and it is the second time this file has had to learn it.
 */
const rupees = (paise: number): string => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * The headings, and the order they appear in. Presentation, so it lives here — and NOT in
 * `latch-core.ts`: the renderer is a browser bundle, and importing a value from the engine drags
 * `node:fs` and `node:child_process` in with it. Types cross that line (they are erased); values
 * do not. The build fails loudly rather than shipping a broken bundle, which is how this was found.
 *
 * "New" is first because it is the only group that is work. "Already selling" is the one most rows
 * land in, and it is below the fold on purpose: it is a reason to do nothing.
 */
const GROUPS = [
  { state: "form", label: "New — ready to latch" },
  { state: "unknown", label: "Not checked yet" },
  { state: "selling", label: "Already selling" },
  { state: "approval", label: "Needs approval for that vertical" },
  { state: "ambiguous", label: "More than one listing fits — pick one" },
  { state: "none", label: "Couldn't find it on Flipkart" },
  { state: "stuck", label: "Flipkart didn't answer" },
] as const;

/**
 * What we list at, in paise — the 220 the latch form is filled with.
 *
 * Here so the screen can say how we compare; it is NOT the source of the figure, which is the
 * `latchNew` handler's. **This is the first thing to change when the price stops being one number
 * for every product** — the margin work Vansh described sets it per kit, from its costing.
 */
const OURS = 220_00;

/** How far a check or a latch run has got. Null when nothing is running. */
type Progress = { done: number; of: number; sku: string } | null;

export function Latch({ n }: { n: number }) {
  const [book, setBook] = useState<LatchBook>({ packs: [], rows: [] });
  /**
   * Which pack is being looked at, by filename, or null for everything at once.
   *
   * **A pack filters the view; it never becomes a separate list.** What we know about a product —
   * that it is already selling, the day it was latched — belongs to the product and is true no
   * matter which pack reminded us of it, so there is one set of rows and this decides which of
   * them are on screen.
   */
  const [pack, setPack] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "checking" | "latching" | "sweeping" | "showing">("");
  const [progress, setProgress] = useState<Progress>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  /**
   * Also open a costing chat per product. On by default because it is the reason the second photo
   * is worth fetching at all — but a switch, because it is the half that depends on ChatGPT's
   * markup and on being signed in, and a latch run should never wait on either.
   */
  const [costing, setCosting] = useState(true);
  const [term, setTerm] = useState("party decoration");
  const [minutes, setMinutes] = useState(60);
  /** What the sweep is up to. Its own state because it reports per product, not per batch. */
  const [swept, setSwept] = useState<{ seen: number; title: string; can: number } | null>(null);
  /** A list a partner sent, pasted straight back in. Empty until somebody uses it. */
  const [shared, setShared] = useState("");
  /**
   * The batch under review, as it was opened. Non-empty means ten shopper tabs are up and the
   * next press should be "latch the ones still open", not "show me ten more".
   */
  const [batch, setBatch] = useState<{ fsn: string; title: string }[]>([]);
  /** Latched but not yet priced. Loaded on demand — it reads the open Chrome tabs. */
  const [pending, setPending] = useState<Pending[] | null>(null);
  /** Live listings we cannot pack, and the materials doing it. Loaded with the pending list. */
  const [pause, setPause] = useState<Pending[]>([]);
  const [blocking, setBlocking] = useState<{ material: string; skus: string[] }[]>([]);
  /** Latched products that could have their images made. Loaded on demand — it reads the disk. */
  const [jobs, setJobs] = useState<ImageJob[] | null>(null);
  /** Which product's run is going, and what step it is on. */
  const [running, setRunning] = useState<{ sku: string; step: string } | null>(null);
  /** Brand approvals on the account. Null until asked — it reads Flipkart. */
  const [approvals, setApprovals] = useState<
    { id: string; brand: string; vertical: string; status: string; updatedAt: string }[] | null
  >(null);

  useEffect(() => void window.ww.latches().then(setBook), []);
  useEffect(
    () => window.ww.onLatchRow((p) => setProgress({ done: p.done, of: p.of, sku: p.row.sku })),
    [],
  );
  useEffect(
    () =>
      window.ww.onImageStep((p) =>
        setRunning({ sku: p.sku, step: `${p.prompt}${p.file ? " ✓" : p.missing ? " — nothing came back" : ""}` }),
      ),
    [],
  );
  useEffect(
    () =>
      window.ww.onCrawlRow((p) =>
        setSwept((was) => ({
          seen: p.seen,
          title: p.found.title,
          can: (was?.can ?? 0) + (p.found.state === "form" ? 1 : 0),
        })),
      ),
    [],
  );

  /** Every call here returns the WHOLE list, so the screen never recomputes what the engine knows. */
  async function run(what: typeof busy, call: () => Promise<{ ok: boolean } & Record<string, unknown>>) {
    setBusy(what);
    setError(null);
    setNote(null);
    setProgress(null);
    let ok = true;
    try {
      const r = await call();
      if (!r.ok) {
        setError(r.message as string);
        ok = false;
      } else {
        setBook(r.result as LatchBook);
        if (r.note) setNote(r.note as string);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      ok = false;
    }
    setBusy("");
    setProgress(null);
    return ok;
  }

  /**
   * Read a pack and SHOW that pack, not everything. Its filename is the pack's name in the book.
   * Landing on "Everything" put a fresh pack among an old hunt's leftovers.
   */
  function readPack(file: string) {
    void run("reading", () => window.ww.addLabels(file)).then((ok) => ok && setPack(file.split(/[\\/]/).pop()!));
  }

  /** Search terms already swept, newest first — derived, never stored twice. */
  const hunts = book.packs
    .filter((p) => p.file.startsWith("search: "))
    .map((p) => {
      const [term, on] = p.file.slice("search: ".length).split(" · ");
      return { term, on: on ?? p.addedOn, found: p.skus.length };
    })
    .sort((a, b) => b.on.localeCompare(a.on) || a.term.localeCompare(b.term));

  const chosen: LabelPack | null = book.packs.find((p) => p.file === pack) ?? null;
  const rows = chosen ? book.rows.filter((r) => chosen.skus.includes(r.sku)) : book.rows;
  const unchecked = rows.filter((r) => r.state === "unknown").length;
  // Already-latched rows are never offered again, so they are not counted as ready either.
  const ready = rows.filter((r) => r.state === "form" && r.fsn && !r.latchedOn).length;

  return (
    <section className="panel latch">
      <header>
        <h1>{n ? `${n}. ` : ""}Latch on</h1>
        <p>
          Drop another seller&apos;s Flipkart label pack in. Every label carries their SKU and the
          catalog title it sold under, so a pack is their bestseller list — and latching is putting
          our own offer on the same catalog entry. Drop the same pack twice or next month&apos;s
          beside it; only what is genuinely new is added.
        </p>
      </header>

      <div
        className={`drop small ${over ? "over" : ""} ${busy === "reading" ? "busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
          if (paths.length) readPack(paths[0]);
          else setError("Couldn't read that. Use the button instead.");
        }}
      >
        <strong>{busy === "reading" ? "Reading it…" : "Drop the label pack (.pdf)"}</strong>
        <div className="picks">
          <button
            disabled={!!busy}
            onClick={() =>
              void window.ww
                .pick("labels", "files")
                .then((f) => {
                  if (f.length) readPack(f[0]);
                })
            }
          >
            Choose a label pack…
          </button>
        </div>
      </div>

      {book.packs.length > 0 && (
        <div className="latch-packs">
          <button className={pack === null ? "on" : ""} onClick={() => setPack(null)}>
            Everything <span className="count">{book.rows.length}</span>
          </button>
          {book.packs.map((p) => (
            <button key={p.file} className={pack === p.file ? "on" : ""} onClick={() => setPack(p.file)}>
              {p.addedOn} <span className="file">{p.file}</span> <span className="count">{p.skus.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sweeping a search finds products nobody handed us. Same question, same three answers —
          only the source of the list is different, which is why it lives beside the drop zone
          rather than on a screen of its own. */}
      <div className="latch-sweep">
        <input
          type="text"
          value={term}
          disabled={!!busy}
          placeholder="…or sweep Flipkart's own search — party decoration, birthday balloons…"
          onChange={(e) => setTerm(e.target.value)}
        />
        <label>
          for{" "}
          <input
            type="number"
            min={1}
            max={180}
            value={minutes}
            disabled={!!busy}
            onChange={(e) => setMinutes(Number(e.target.value) || 1)}
          />{" "}
          min
        </label>
        <button
          disabled={!!busy || !term.trim()}
          onClick={() => {
            setSwept(null);
            void run("sweeping", () => window.ww.crawlSearch(term, minutes));
          }}
        >
          Sweep
        </button>
        {busy === "sweeping" && <button onClick={() => void window.ww.stopCrawl()}>Stop</button>}
      </div>

      {/* **What an approval actually unlocks.**
          Flipkart's own "Add Listings" button on an approved row drops the brand and the vertical
          on the first re-render, and aims at our own drafts rather than the catalog — which is why
          Vansh could never find the product he had just been approved for. Sweeping the brand name
          is the way in, and it is the same sweep as above with both rails on. */}
      <div className="latch-sweep approved">
        <button
          disabled={!!busy}
          onClick={() =>
            void window.ww.approvals().then((r) => {
              if (!r.ok) return setError(r.message);
              setApprovals(r.result);
            })
          }
        >
          What am I approved for?
        </button>
        <button
          disabled={!!busy}
          onClick={() => {
            setSwept(null);
            void run("sweeping", () => window.ww.sweepApproved(minutes));
          }}
        >
          Sweep every approved brand
        </button>
      </div>

      {approvals && (
        <p className="latch-history">
          {approvals.filter((a) => /approved/i.test(a.status)).length} approved:{" "}
          {approvals.map((a, i) => (
            <span key={a.id}>
              {i > 0 && " · "}
              <button className="link" disabled={!!busy} onClick={() => setTerm(`${a.brand} ${a.vertical}`)}>
                {a.brand}
              </button>{" "}
              <span className="when">
                {a.vertical}
                {/^approved$/i.test(a.status) ? "" : ` — ${a.status}`}
              </span>
            </span>
          ))}
        </p>
      )}

      {/* What has already been hunted, so the next term is chosen knowing it. Clicking one loads
          it back into the box — running the same term again months later is a real thing to do,
          because what Flipkart offers and what we already sell both move. */}
      {hunts.length > 0 && (
        <p className="latch-history">
          Hunted already:{" "}
          {hunts.map((h, i) => (
            <span key={`${h.term}-${h.on}`}>
              {i > 0 && " · "}
              <button className="link" disabled={!!busy} onClick={() => setTerm(h.term)}>
                {h.term}
              </button>{" "}
              <span className="when">
                {h.on} ({h.found})
              </span>
            </span>
          ))}
        </p>
      )}

      {/* The receiving end of "Copy for a partner". Someone pastes the WhatsApp message here and
          it becomes work on THIS account — the sender's can-latch answers were about theirs. */}
      <details className="latch-import">
        <summary>Paste a list somebody sent you</summary>
        <textarea
          rows={4}
          value={shared}
          disabled={!!busy}
          placeholder="Paste the whole message — it finds the products by the [FSN] codes in it."
          onChange={(e) => setShared(e.target.value)}
        />
        <button
          disabled={!!busy || !shared.trim()}
          onClick={() => {
            void run("reading", () => window.ww.importShared(shared)).then(() => setShared(""));
          }}
        >
          Read this list
        </button>
      </details>

      {batch.length > 0 && (
        <p className="allgood batch-open">
          Looking at {batch.length}: close the tabs you do not want, then press{" "}
          <strong>Latch the ones still open</strong>. Your other Chrome tabs are ignored.
        </p>
      )}

      {swept && (
        <p className="allgood">
          {swept.seen} looked at, <strong>{swept.can} can be latched</strong> — {swept.title.slice(0, 70)}
        </p>
      )}

      {rows.length > 0 && (
        <div className="picks latch-actions">
          <button disabled={!!busy || unchecked === 0} onClick={() => void run("checking", () => window.ww.checkLatches(false))}>
            {unchecked ? `Check ${unchecked} against Flipkart` : "Nothing new to check"}
          </button>
          <button disabled={!!busy} onClick={() => void run("checking", () => window.ww.checkLatches(true))}>
            Re-check all {rows.length}
          </button>
          {/* **Look, then latch.** Sixty latchable products are not sixty worth selling, and sixty
              tabs is not a review. Ten shopper pages at a time — the page a buyer sees, not the
              listing form — and whatever is still open when he presses the second button is what
              gets listed. Closing a tab is the "no". */}
          {batch.length === 0 ? (
            <button
              className="primary"
              disabled={!!busy || ready === 0}
              onClick={() =>
                void window.ww.showBatch(10, pack).then((r) => {
                  if (!r.ok) return setError(r.message);
                  setBatch(r.result.map((x) => ({ fsn: x.fsn, title: x.title })));
                  setNote(r.note ?? null);
                })
              }
            >
              {ready ? `Show me the next 10 of ${ready}` : "Nothing ready to latch"}
            </button>
          ) : (
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                // Cleared only on success: a refused run (logged out) leaves this button in place.
                void run("latching", () => window.ww.latchOpen(costing)).then((ok) => ok && setBatch([]))
              }
            >
              Latch the ones still open
            </button>
          )}
          {/* The refill. A refresh throws a filled form away; this puts it back in the one tab in
              front, without re-running the batch or opening anything new. */}
          <button disabled={!!busy} onClick={() => void run("latching", () => window.ww.fillFrontLatch())}>
            Fill the tab I&apos;m looking at
          </button>
          {/* One button per thing a person actually does with this list: do it, or tell somebody
              about it. The share follows whichever pack is selected, so "what came in today" is
              one click from a message. */}
          {/* Follows whichever chip is selected, which IS the three lists Vansh asked for:
              Everything, today's sweep, today's label pack. Enabled whenever there is anything at
              all — the message carries every state now, not only what we can latch. */}
          <button
            disabled={!!busy || rows.length === 0}
            onClick={() =>
              void window.ww.shareLatches(pack).then((t) =>
                setNote(`Copied — ${t.split("\n")[0]} Paste it to your partner.`),
              )
            }
          >
            Copy {chosen ? "this list" : "everything"} for a partner
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              void window.ww.imageQueue().then((r) => {
                if (!r.ok) return setError(r.message);
                setJobs(r.result);
              })
            }
          >
            Which can have images made?
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              void window.ww.latchPending().then((r) => {
                if (!r.ok) return setError(r.message);
                setPending(r.result.rows);
                setPause(r.result.pause);
                setBlocking(r.result.blocking);
                setBook(r.result.book);
                if (r.note) setNote(r.note);
              })
            }
          >
            What still needs a price?
          </button>
          <label className="latch-costing">
            <input type="checkbox" checked={costing} disabled={!!busy} onChange={(e) => setCosting(e.target.checked)} />
            {" "}…and open a costing chat with the contents photo
          </label>
        </div>
      )}

      {progress && (
        <p className="allgood">
          {busy === "latching" ? "Opening" : "Checking"} {progress.done} of {progress.of} — {progress.sku}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {note && <p className="allgood">{note}</p>}

      {/* The buffer. A latch takes a minute; its costing waits on a photo, a ChatGPT reply and a
          person checking it — days later. Without this list what falls through is silent: a live
          listing sitting at the default ₹220 that nobody ever went back to. */}
      {/* **Ask, do not queue.** Each run is four prompts, minutes of compute, and three pictures a
          person then checks — so this lists what COULD go and Vansh picks one. Blocked products
          stay on the list with their reason, because a missing contents photo is one download from
          ready and filtering it out is how it stays missing for ever. */}
      {jobs && (
        <div className="latch-group">
          <h2>
            Ready for their listing images <span className="count">{jobs.filter((j) => !j.blockedBy.length).length}</span>
          </h2>
          {running && (
            <p className="allgood">
              {running.sku}: {running.step}
            </p>
          )}
          <table className="latch-table">
            <tbody>
              {jobs.map((j) => (
                <tr key={j.sku} className={j.blockedBy.length ? "blocked" : ""}>
                  <td className="sku">{j.ourSku || "—"}</td>
                  <td className="title">{j.title}</td>
                  <td className="why">
                    {j.blockedBy.length ? j.blockedBy.join("; ") : j.have ? `${j.have} already there` : ""}
                  </td>
                  <td className="when">
                    <button
                      disabled={!!busy || !!j.blockedBy.length || !!running}
                      onClick={() => {
                        setRunning({ sku: j.ourSku, step: "starting…" });
                        void window.ww.runImages(j.sku).then((r) => {
                          setRunning(null);
                          if (!r.ok) setError(r.message);
                          else setNote(r.note ?? null);
                        });
                      }}
                    >
                      {j.have ? "Make them again" : "Make the images"}
                    </button>{" "}
                    {j.have >= 2 && (
                      <button
                        disabled={!!busy || !!running}
                        onClick={() => {
                          setRunning({ sku: j.ourSku, step: "writing the listing text…" });
                          void window.ww.runMeta(j.sku).then((r) => {
                            setRunning(null);
                            if (!r.ok) setError(r.message);
                            else setNote(r.note ?? null);
                          });
                        }}
                      >
                        Write the listing text
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* **Pause these before the next order arrives.** A paused listing costs the sales it would
          have made; an order taken and cancelled costs account health, which cannot be bought back.
          Above the price queue on purpose — this is the only list here with a deadline set by
          somebody else's shopping. */}
      {pause.length > 0 && (
        <div className="latch-group pause">
          <h2>
            Pause these until the stock arrives <span className="count">{pause.length}</span>
          </h2>
          <p className="why-pause">
            Live on Flipkart, and we have none of what they are made of. An order taken and then
            cancelled costs the account; a paused listing costs only the sale.
          </p>
          <table className="latch-table">
            <tbody>
              {pause.map((p) => (
                <tr key={p.fsn}>
                  <td className="sku">{p.ourSku ?? "—"}</td>
                  <td className="title">{p.title}</td>
                  <td className="why">no {p.short.slice(0, 3).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {blocking.length > 0 && (
            <p className="blocking">
              One call fixes:{" "}
              {blocking.map((b, i) => (
                <span key={b.material}>
                  {i > 0 && " · "}
                  <strong>{b.material}</strong> ({b.skus.length})
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {/* The buffer, worst first. A latch takes a minute; its costing waits on a photo, a
          ChatGPT reply and a person checking it — days later. And the listing is LIVE the whole
          time, so the one at the top is not the oldest, it is the one that would cost the most to
          be caught out on: a kit whose materials are not in the room. */}
      {pending && (
        <div className="latch-group">
          <h2>
            Latched, still no confirmed price <span className="count">{pending.length}</span>
          </h2>
          {pending.length === 0 ? (
            <p className="allgood">Everything we have latched has a price somebody has signed off.</p>
          ) : (
            <table className="latch-table">
              <tbody>
                {pending.map((p) => (
                  <tr key={p.fsn} className={p.risk >= 50 ? "urgent" : ""}>
                    {/* The score, so the order is arguable rather than mysterious. Red from 50,
                        which is exactly the weight of "we have none of a material it needs". */}
                    <td className="risk" title={p.reasons.join("\n")}>
                      {p.risk}
                    </td>
                    <td className="sku">{p.ourSku ?? "—"}</td>
                    <td className="title">
                      {p.title}
                      <span className="from"> {p.from.join(", ")}</span>
                      {p.reasons.length > 0 && (
                        <ul className="near">
                          {p.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="when">latched {p.latchedOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {GROUPS.map(({ state, label }) => {
        const mine = rows.filter((r) => r.state === state);
        if (mine.length === 0) return null;
        return (
          <div key={state} className="latch-group">
            <h2>
              {label} <span className="count">{mine.length}</span>
            </h2>
            <table className="latch-table">
              <tbody>
                {mine.map((r) => (
                  <tr key={r.sku}>
                    {/* Their SKU, not ours — it is the row's name, and it is why the form is left
                        one field short rather than filled in with it. */}
                    <td className="sku">{r.sku}</td>
                    <td className="seen" title={`${r.seen} label${r.seen === 1 ? "" : "s"} in the pack`}>
                      ×{r.seen}
                    </td>
                    <td className="title">
                      {r.title ?? r.description}
                      {r.near?.length ? (
                        <ul className="near">
                          {r.near.map((c) => (
                            <li key={c.fsn}>
                              <code>{c.fsn}</code> {c.title}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    {/* Theirs against ours. The GAP is the number worth showing, not two prices to
                        subtract by eye. Being dearer is FLAGGED, never acted on: it is one input
                        among ratings, delivery and the buy box, and plenty of listings sell above
                        the seller beside them. Nothing is skipped or rejected on this number. */}
                    <td className="price">
                      {r.listed ? (
                        <>
                          {rupees(r.listed.pricePaise)}
                          <span className={r.listed.pricePaise < OURS ? "dearer" : "cheaper"}>
                            {r.listed.pricePaise < OURS
                              ? ` we're +${rupees(OURS - r.listed.pricePaise)}`
                              : ` we're −${rupees(r.listed.pricePaise - OURS)}`}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="when">{r.latchedOn ? `latched ${r.latchedOn}` : (r.checkedOn ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

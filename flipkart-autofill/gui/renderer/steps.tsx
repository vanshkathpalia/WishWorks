/**
 * steps.tsx — the panels that are not the image converter.
 *
 * Every one of them follows the same shape, which is the whole point of the app: pick from a
 * list or a folder dialog, press a button, read the result on screen. No command is typed and no
 * path is remembered by a human.
 */

import React, { useEffect, useRef, useState } from "react";
import type { CheckResult, FinishResult, Listing, PasteResult, Row } from "../shared.js";
import { CopyButton, FolderRow, ListingPicker, joinPath } from "./ui.js";
import { Inbox } from "./Inbox.js";
import { PromptEditor } from "./PromptEditor.js";

// ------------------------------------------------------------------ prompt steps

/**
 * A prompt step. The button copies the prompt file whole — the prompt files are "nothing but the
 * prompt" for exactly this reason, so this is a file read and a clipboard write with no parsing
 * that could drift from the file.
 */
export function Prompt({
  n,
  title,
  file,
  attach,
  onFiled,
}: {
  n: number;
  title: string;
  file: string;
  attach: React.ReactNode;
  onFiled?: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    void window.ww
      .promptText(file)
      .then(setText)
      .catch(() => setError(`Couldn't read ${file}.`));
  }, [file]);

  async function drop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
    const json = paths.filter((p) => p.toLowerCase().endsWith(".json"));
    if (json.length === 0) return;
    const r = await window.ww.fileOne(json);
    setFiled(
      r.imported.length
        ? `Filed ${r.imported.map((i) => i.to.split(/[\\/]/).pop()).join(", ")}.`
        : "Nothing filed — those are already in, and newer.",
    );
    onFiled?.();
  }

  return (
    <section className="panel">
      <header>
        <h1>
          {n}. {title}
        </h1>
        <p>
          One click puts the whole prompt on your clipboard. Paste it into the AI chat, attach what
          it asks for, then bring the reply back.
        </p>
      </header>

      {error ? (
        <p className="error">{error}</p>
      ) : (
        <div className="picks">
          <CopyButton text={text} label="Copy the prompt" />
          <span className="muted">
            {file} · {text.length.toLocaleString()} characters
          </span>
        </div>
      )}

      <h3>What to attach</h3>
      {attach}

      <h3>Bring the reply back</h3>
      <div
        className={`drop small ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => void drop(e)}
      >
        <strong>Drop the downloaded .json here</strong>
        <div className="picks">
          <button
            onClick={() =>
              void window.ww.pick("copy", "files").then(async (p) => {
                const json = p.filter((f) => f.toLowerCase().endsWith(".json"));
                if (!json.length) return;
                const r = await window.ww.fileOne(json);
                setFiled(r.imported.length ? `Filed ${r.imported.length} file(s).` : "Already filed.");
                onFiled?.();
              })
            }
          >
            Choose the file…
          </button>
        </div>
      </div>
      {filed && <p className="muted">{filed}</p>}

      <p className="muted">
        Images are not filed here — this step's reply is a picture you save into the listing's
        clean folder, then use in step 5.
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ listing copy

const STATUS: Record<string, string> = {
  ok: "ok",
  over: "OVER — the form will cut it off",
  under: "under the target",
  missing: "missing — the reply was cut short",
};

/**
 * Step 4. Two prompts back to back in ONE chat (the photos must still be in context — WW-081),
 * then the reply's checks run the moment the files land, which is the point: today a limit breach
 * is only caught if someone remembers to type `npm run paste`.
 */
export function ListingCopy({ n }: { n: number }) {
  const [id, setId] = useState<string | null>(null);
  const [result, setResult] = useState<PasteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixed, setFixed] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return;
    setResult(null);
    setError(null);
    void window.ww.paste(id).then((r) => (r.ok ? setResult(r.result) : setError(r.message)));
  }, [id, nonce]);

  return (
    <section className="panel">
      <header>
        <h1>{n}. Listing copy</h1>
        <p>
          Send both prompts <b>back to back in the same chat</b> — the photos must still be in
          context when the second one runs, or the Flipkart half describes nothing.
        </p>
      </header>

      <div className="two">
        <PromptCard file="PROMPT-meta.md" title="First — describes the photos, writes the Meesho copy" />
        <PromptCard file="PROMPT-product.md" title="Second — fills the Flipkart fields" />
      </div>

      {/* The short way, for a product that is never going on Flipkart. The pair above exist to
          produce two FILES the app reads; this one produces three blocks of text and no file,
          because there is nothing downstream to read them — the Meesho panel is typed into by
          hand either way. Kept separate rather than made a mode of PROMPT-meta: that one's whole
          first half is image descriptions and Flipkart title/keywords, none of which a
          Meesho-only listing has any use for. */}
      <h3>Listing on Meesho only?</h3>
      <p className="muted">
        Send this one <b>instead of the two above</b>. It asks for the three things the Meesho
        panel needs — <b>product name, description, and what is in the packet</b> — and nothing
        else: no <code>image-meta</code> file, no Flipkart file, no listing ID. The reply comes
        back as three blocks of text you copy straight into the panel, so there is nothing to
        bring back here and the checks below will have nothing to check.
      </p>
      <PromptCard
        file="PROMPT-meesho-only.md"
        title="Meesho only — name, description and pack contents"
      />

      <Inbox onImported={() => setNonce((x) => x + 1)} />

      <h3>Check a listing</h3>
      <ListingPicker
        value={id}
        onChange={setId}
        need={(l) => (!l.meta ? "no copy file" : !l.product ? "no Flipkart file" : null)}
      />

      {error && <p className="error">{error}</p>}

      {result && (
        <>
          {result.problems.length > 0 ? (
            <div className="problems">
              <h3>
                {result.problems.length} thing{result.problems.length === 1 ? "" : "s"} to fix
              </h3>
              <ul>
                {result.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              {/* Emoji are the one problem the app can repair itself, because the fix is
                  mechanical: they were section headings, and removing them leaves exactly what
                  the corrected prompt now produces. Everything else needs a human decision. */}
              {result.problems.some((p) => p.includes("emoji")) && (
                <div className="picks">
                  <button
                    className="primary"
                    onClick={() =>
                      void window.ww.stripEmoji(id!).then((r) => {
                        setFixed(`Removed emoji from ${r.changed.join(", ")}.`);
                        setNonce((x) => x + 1);
                      })
                    }
                  >
                    Remove the emoji for me
                  </button>
                  <span className="muted">
                    Rewrites the Flipkart fields only. Meesho copy is left alone.
                  </span>
                </div>
              )}
              {fixed && <p className="muted">{fixed}</p>}
              <p className="muted">Nothing is blocked — the values below are still correct to paste.</p>
            </div>
          ) : (
            <p className="allgood">Every value is present and within its limit.</p>
          )}

          {result.fields.map((f) => (
            <div className="field" key={f.label}>
              <div className="field-head">
                <b>{f.label}</b>
                <span className={f.status === "ok" ? "muted" : "warnpill"}>
                  {f.value === null ? STATUS.missing : `${f.length}/${f.max} · ${STATUS[f.status]}`}
                </span>
                <CopyButton text={f.value ?? ""} disabled={f.value === null} />
              </div>
              {f.value !== null && <pre className="value">{f.value}</pre>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** Double-click to read or edit the prompt, with its earlier versions. */
function PromptCard({ file, title }: { file: string; title: string }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (editing) return; // re-read after the editor closes, in case it was changed
    void window.ww.promptText(file).then(setText).catch(() => setText(""));
  }, [file, editing]);
  return (
    <div className="card openable" onDoubleClick={() => setEditing(true)} title="double-click to read or edit">
      <b>{title}</b>
      <span className="muted">{file}</span>
      <div className="picks">
        <CopyButton text={text} label="Copy the prompt" />
        <button onClick={() => setEditing(true)}>Open</button>
      </div>
      {editing && <PromptEditor file={file} close={() => setEditing(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ finish

/**
 * Step 5. Two sources on purpose: the listing's own clean folder, or any other folder — the
 * AI's recreated hero and infographic arrive as downloads, and the finished set is often
 * assembled somewhere else entirely.
 *
 * `id` (the output name) and `metaId` (whose descriptions go inside) are separate controls and
 * must stay that way: one variable doing both is WW-078, where a descriptions answer renamed the
 * listing and wrote Annaprashan copy into Groom-To-Be photos.
 */
export function Finish({ n }: { n: number }) {
  const [listing, setListing] = useState<Listing | null>(null);
  // Defaults to the folder picker. Vansh's photos live in his own folders on disk; the app's
  // workspace only holds what the Convert step put there, so "pick the folder" is the common
  // case and the one that needs no explaining.
  const [source, setSource] = useState<"clean" | "other">("other");
  const [dir, setDir] = useState<string | null>(null);
  const [outDir, setOutDir] = useState<string | null>(null);
  const [descs, setDescs] = useState<string>("none");
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same broadcast channel the Convert step uses, and both panels stay mounted (main.tsx), so
  // rows are only taken while this step is the one running. See the note in Convert.tsx.
  const mine = useRef(false);
  useEffect(() => window.ww.onRow((r) => mine.current && setRows((x) => [...x, r])), []);
  // Defaults to ~/Downloads/wishworks-ready — the same folder `npm run finish` has always used,
  // and somewhere a person can actually find. The workspace lives under Application Support,
  // which is hidden in Finder; finished photos are the one output that gets picked up by hand
  // and uploaded, so they do not belong in a folder you cannot navigate to.
  useEffect(() => {
    void window.ww.downloadsDir().then((d) => setOutDir((o) => o ?? joinPath(d, "wishworks-ready")));
  }, []);

  // Descriptions follow the listing you picked. Changing the listing must not silently leave
  // somebody else's descriptions selected — that direction of the WW-078 mistake.
  //
  // A listing with no copy file gets "none", not its own ID. `descriptionsFor()` returns an empty
  // set rather than failing when nothing matches, so offering `GTB-4` for a listing that has no
  // `image-meta/GTB4.json` produced the worst outcome available: the screen said the descriptions
  // came from GTB-4, and the images went out carrying nothing.
  const hasCopy = Boolean(listing && (listing.meta || listing.product));
  useEffect(() => setDescs(hasCopy ? listing!.id : "none"), [listing, hasCopy]);

  /**
   * The NAME comes from the folder, never from the picker. That is the whole shape of WW-078:
   * one variable was doing both jobs, so answering "whose descriptions?" renamed the product.
   * Passing `id: null` leaves naming to the engine, which reads it off the folder — so what is
   * printed here is what will actually be written.
   */
  const inDir = source === "clean" ? (listing?.folder ? `2-clean/${listing.folder}` : null) : dir;
  const outName = source === "clean" ? listing?.folder ?? null : dir?.split(/[\\/]/).pop() ?? null;
  const ready = Boolean(inDir && outDir);

  async function run() {
    if (!outDir) return;
    setBusy(true);
    mine.current = true;
    setRows([]);
    setResult(null);
    setError(null);
    try {
      const real =
        source === "clean" ? await window.ww.cleanFolder(listing!.folder!) : dir!;
      setResult(
        await window.ww.finish({ inDir: real, outDir, id: null, metaId: descs }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      mine.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <header>
        <h1>{n}. Finish images</h1>
        <p>
          Takes a folder of photos, writes each one's description <b>inside</b> the file, and saves
          them out renamed after the listing —{" "}
          <code>ANP-3-annaprashan-decoration-kit-red-gold-1.jpg</code> and so on. Your originals are
          never changed.
        </p>
      </header>

      <h3>Step 1 — which photos?</h3>
      <div className="picks">
        <label className="inline">
          <input type="radio" checked={source === "other"} onChange={() => setSource("other")} />
          a folder on my computer
        </label>
        <label className="inline">
          <input type="radio" checked={source === "clean"} onChange={() => setSource("clean")} />
          one the app converted earlier
        </label>
      </div>
      {source === "clean" ? (
        <ListingPicker
          value={listing?.id ?? null}
          onChange={(_id, l) => setListing(l)}
          need={(l) =>
            !l.folder
              ? "no images folder"
              : !l.meta && !l.product
                ? "no copy file — nothing to embed"
                : null
          }
        />
      ) : (
        <FolderRow step="finish" label="Photos folder" value={dir} onChange={setDir} />
      )}

      <h3>Step 2 — where should the finished ones be saved?</h3>
      <FolderRow step="finish" label="Save them into" value={outDir} onChange={setOutDir} />

      {outName && (
        <p className="pairing">
          <b>Step 3 — check this reads correctly, then press the button.</b>
          <br />
          The photos will be saved as <b>{outName}-&lt;the listing's own title&gt;-1.jpg, -2.jpg …</b>{" "}
          — the <b>{outName}</b> comes from the folder, so it is exactly what is on disk, and the
          words after it come from that listing's own copy file (plain <b>{outName}.1.jpg</b> if it
          has none yet). The wording written inside them comes from{" "}
          <select value={descs} onChange={(e) => setDescs(e.target.value)}>
            {hasCopy && <option value={listing!.id}>{listing!.label}</option>}
            <option value="none">none — embed nothing</option>
          </select>
          . Picking a different one does <b>not</b> change the file names.
          {source === "clean" && listing && !hasCopy && (
            <>
              {" "}
              <b>{listing.label} has no copy file yet</b>, so there is nothing to write inside — do
              step 3 first, or finish now and run this again once the copy exists.
            </>
          )}
        </p>
      )}

      <div className="picks">
        <button className="primary" disabled={!ready || busy} onClick={() => void run()}>
          {busy ? `Finishing… ${rows.length}` : "Finish these images"}
        </button>
        {result && outDir && (
          <button onClick={() => void window.ww.showFolder(outDir)}>Open the folder</button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {rows.length > 0 && (
        <table className="rows">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.to} className={r.notes.length ? "warn" : ""}>
                <td>
                  {r.from} <span className="arrow">→</span> {r.to}
                </td>
                <td>{r.size}</td>
                <td>{r.notes.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result?.failures.length ? (
        <ul className="failures">
          {result.failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ check

/**
 * Step 6. Reads the description back OUT of each finished JPEG.
 *
 * Worth saying plainly on screen, because "what does this do?" is a fair question: macOS Finder
 * and Preview do not display EXIF ImageDescription at all, so there is no way to look at a
 * finished file and see whether the text landed inside it. Everything up to here can look
 * perfect while the images carry nothing. WW-096 is what that costs — a step nobody had run.
 */
export function Check({ n }: { n: number }) {
  // Two folders, kept side by side rather than one that gets re-pointed: the finished folder is
  // where step 5 writes, and it is the answer nine times out of ten. The other slot is for a set
  // that came from somewhere else — a partner's drive, an older ~/Downloads/wishworks-ready —
  // and switching back must not cost a second trip through the dialog.
  const [ready, setReady] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [source, setSource] = useState<"ready" | "other">("ready");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The folder step 5 actually writes to. It used to say `images/3-final`, which is the image
  // pipeline's folder and NOT where finishing lands — so the default checked an empty folder.
  // It must keep matching step 5's default or this one goes back to checking nothing.
  useEffect(() => {
    void window.ww.downloadsDir().then((r0) => setReady((r) => r ?? joinPath(r0, "wishworks-ready")));
  }, []);

  const dir = source === "ready" ? ready : other;

  async function run() {
    if (!dir) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const r = await window.ww.check(dir);
    if (r.ok) setResult(r.result);
    else setError(r.message);
    setBusy(false);
  }

  const missing = result ? result.rows.length - result.withDescription : 0;

  return (
    <section className="panel">
      <header>
        <h1>{n}. Check</h1>
        <p>
          Opens every finished image and reads the description back out of it. Worth doing because
          nothing else can: Finder and Preview do not show this field at all, so a folder of images
          carrying no text looks identical to a folder that is correct.
        </p>
      </header>

      <div className="picks">
        <label className="inline">
          <input type="radio" checked={source === "ready"} onChange={() => setSource("ready")} />
          the finished folder
        </label>
        <label className="inline">
          <input type="radio" checked={source === "other"} onChange={() => setSource("other")} />
          another folder
        </label>
      </div>
      {source === "ready" ? (
        <FolderRow step="check" label="Finished images" value={ready} onChange={setReady} />
      ) : (
        <FolderRow step="check" label="Another folder" value={other} onChange={setOther} />
      )}

      <div className="picks">
        <button className="primary" disabled={!dir || busy} onClick={() => void run()}>
          {busy ? "Reading…" : "Check these images"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {result &&
        (result.rows.length === 0 ? (
          <p className="muted">No JPEGs in that folder.</p>
        ) : (
          <>
            <p className={missing ? "problems" : "allgood"}>
              {missing === 0
                ? `All ${result.rows.length} images carry a description.`
                : `${missing} of ${result.rows.length} images have nothing embedded — finish them again once the descriptions exist.`}
            </p>
            <table className="rows">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.file} className={r.description ? "" : "warn"}>
                    <td>{r.file}</td>
                    <td>
                      {r.error
                        ? `could not read (${r.error})`
                        : r.description
                          ? r.description
                          : "nothing embedded"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
    </section>
  );
}

// ------------------------------------------------------------------ meesho

/** Step 8. Nothing is automated here yet, but the four values are one click each. */
export function Meesho({ n }: { n: number }) {
  const [id, setId] = useState<string | null>(null);
  const [result, setResult] = useState<PasteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A failure here used to render NOTHING — `r.ok && setResult(...)` dropped the message and the
  // panel just sat blank, which reads as "the app is frozen". Anything that can fail must say so.
  useEffect(() => {
    if (!id) return;
    setResult(null);
    setError(null);
    void window.ww
      .paste(id)
      .then((r) => (r.ok ? setResult(r.result) : setError(r.message)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const meesho = result?.fields.filter((f) => f.label.startsWith("MEESHO")) ?? [];
  // The same checks the copy step runs, narrowed to the ones about Meesho values. `263/255` was
  // already on screen and said nothing about what it meant — a number in a pill is not a warning.
  // Flipkart's problems are deliberately left out: they are somebody else's form.
  const problems = result?.problems.filter((p) => p.toLowerCase().includes("meesho")) ?? [];

  return (
    <section className="panel">
      <header>
        <h1>{n}. Fill Meesho</h1>
        <p>
          The Supplier Panel is filled by hand for now — the same browser code that fills Flipkart
          will do it once its fields have been scanned once (WW-093). Until then, one click per
          value.
        </p>
      </header>

      <ListingPicker value={id} onChange={setId} need={(l) => (!l.meta ? "no copy file" : null)} />

      {error && <p className="error">{error}</p>}

      {result &&
        (problems.length > 0 ? (
          <div className="problems">
            <h3>
              {problems.length} thing{problems.length === 1 ? "" : "s"} to fix
            </h3>
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <p className="muted">
              Nothing is blocked — but anything over its limit gets silently cut by the Supplier
              Panel, so the tail you paste is not the tail that goes live.
            </p>
          </div>
        ) : (
          <p className="allgood">Every value is present and within its limit.</p>
        ))}

      {meesho.map((f) => (
        <div className="field" key={f.label}>
          <div className="field-head">
            <b>{f.label.replace("MEESHO ", "")}</b>
            <span className={f.status === "ok" ? "muted" : "warnpill"}>
              {f.value === null ? STATUS.missing : `${f.length}/${f.max} · ${STATUS[f.status]}`}
            </span>
            <CopyButton text={f.value ?? ""} disabled={f.value === null} />
          </div>
          {f.value !== null && <pre className="value">{f.value}</pre>}
        </div>
      ))}
    </section>
  );
}

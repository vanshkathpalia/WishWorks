/**
 * Convert.tsx — step 1: any image format in, a square JPEG out, with the Meesho tag removed.
 *
 * The clean-up controls live here rather than on a step of their own because that is where the
 * engine puts them: cropping and painting are stage-1 options on the same `runImages()` call that
 * converts. A separate "prepare" step would have to convert everything a second time.
 */

import React, { useEffect, useRef, useState } from "react";
import type { CleanUp, ConvertResult, Row } from "../shared.js";
import { fileUrl } from "./ui.js";

/** A comma-separated position list ("2,3,4") both ways. Empty means every image. */
const parsePositions = (s: string) =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);

/**
 * The Meesho tag clean-up. The two methods differ on purpose: **image 1 is cropped** because the
 * AI replaces it anyway, so losing a strip costs nothing; **2, 3 and 4 are painted** because
 * there the tag sits level with real product labels and a crop would eat them.
 *
 * On by default with the values from the typical real run, because the photos this step exists
 * for are Meesho downloads and they all carry the tag.
 */
function CleanUpControls({ value, onChange }: { value: CleanUp; onChange: (c: CleanUp) => void }) {
  const set = (patch: Partial<CleanUp>) => onChange({ ...value, ...patch });

  return (
    <fieldset className="cleanup">
      <legend>Meesho tag clean-up</legend>

      <label className="row">
        <input
          type="checkbox"
          checked={value.cropBottom > 0}
          onChange={(e) => set({ cropBottom: e.target.checked ? 25 : 0 })}
        />
        <span>Crop</span>
        <input
          type="number"
          min={0}
          value={value.cropBottom}
          disabled={value.cropBottom === 0}
          onChange={(e) => set({ cropBottom: parseInt(e.target.value, 10) || 0 })}
        />
        <span>px off the bottom of image</span>
        <input
          type="text"
          className="positions"
          value={value.cropImages.join(",")}
          disabled={value.cropBottom === 0}
          onChange={(e) => set({ cropImages: parsePositions(e.target.value) })}
          placeholder="all"
        />
      </label>

      <label className="row">
        <input
          type="checkbox"
          checked={value.eraseTag !== null}
          onChange={(e) => set({ eraseTag: e.target.checked ? [150, 30] : null })}
        />
        <span>Paint out a</span>
        <input
          type="number"
          min={0}
          value={value.eraseTag?.[0] ?? 150}
          disabled={!value.eraseTag}
          onChange={(e) => set({ eraseTag: [parseInt(e.target.value, 10) || 0, value.eraseTag![1]] })}
        />
        <span>×</span>
        <input
          type="number"
          min={0}
          value={value.eraseTag?.[1] ?? 30}
          disabled={!value.eraseTag}
          onChange={(e) => set({ eraseTag: [value.eraseTag![0], parseInt(e.target.value, 10) || 0] })}
        />
        <span>px tag on image</span>
        <input
          type="text"
          className="positions"
          value={value.eraseImages.join(",")}
          disabled={!value.eraseTag}
          onChange={(e) => set({ eraseImages: parsePositions(e.target.value) })}
          placeholder="all"
        />
      </label>

      <p className="muted">
        Image 1 is cropped because the AI replaces it anyway. On 2, 3 and 4 the tag sits level with
        real product labels, so it is painted over instead — a crop there would eat them. Leave a
        list blank to mean every image.
      </p>
    </fieldset>
  );
}

export function Convert() {
  const [folder, setFolder] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [cleanUp, setCleanUp] = useState<CleanUp>({
    cropBottom: 25,
    cropImages: [1],
    eraseTag: [150, 30],
    eraseImages: [2, 3, 4],
  });

  // `run` is called from event handlers, so it must not close over a stale cleanUp.
  const latest = useRef(cleanUp);
  latest.current = cleanUp;

  // Rows arrive one at a time from the engine's onRow callback, so a slow folder shows progress
  // instead of a spinner. The finished result carries them all again; this is only for the wait.
  //
  // `row` is one broadcast channel and the Finish step listens to it too — and since panels stay
  // mounted once visited (main.tsx), both are listening at the same time. A ref, not `busy`,
  // because it has to be true the instant the run starts: `setBusy(true)` only lands on the next
  // render, and the first rows can arrive before that.
  const mine = useRef(false);
  useEffect(() => window.ww.onRow((row) => mine.current && setRows((r) => [...r, row])), []);

  async function run(input: string[]) {
    if (input.length === 0) return;
    setFolder(input.length === 1 ? input[0] : `${input.length} images`);
    setRows([]);
    setResult(null);
    setError(null);
    setBusy(true);
    mine.current = true;
    try {
      setResult(await window.ww.convert(input, latest.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      mine.current = false;
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    // Nothing is uploaded — the drop only yields paths, which the main process then reads.
    // A folder and a handful of loose images both arrive here and both are accepted.
    const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
    if (paths.length) void run(paths);
    else setError("Couldn't read that. Use one of the buttons instead.");
  }

  return (
    <section className="panel">
      <header>
        <h1>1. Convert images</h1>
        <p>
          Drop a folder, or the photos themselves. AVIF, WebP, HEIC, PNG, TIFF, GIF, BMP and JPEG
          all go in; a square 1500&nbsp;px JPEG comes out, with the Meesho tag cropped or painted
          out in the same pass. Your originals are copied, never changed.
        </p>
      </header>

      <div
        className={`drop ${over ? "over" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <>
            <strong>Converting…</strong>
            <span>{rows.length} done</span>
          </>
        ) : (
          <>
            <strong>Drop images or a folder here</strong>
            <div className="picks">
              {/* Two buttons, not one dialog: Windows cannot show a picker that takes both. */}
              <button onClick={() => void window.ww.pick("convert", "files").then(run)}>
                Choose images…
              </button>
              <button onClick={() => void window.ww.pick("convert", "folder").then(run)}>
                Choose a folder…
              </button>
            </div>
          </>
        )}
      </div>

      <CleanUpControls value={cleanUp} onChange={setCleanUp} />

      {folder && <p className="path">{folder}</p>}
      {error && <p className="error">{error}</p>}
      {result?.empty && (
        <p className="error">
          That folder has no images in it. Pick the folder that holds the photos themselves, not
          the one above it.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="thumbs">
            {rows.map((r) => (
              <figure key={r.to}>
                {result && <img src={fileUrl(`${result.outDir}/${r.to}`)} alt="" />}
                <figcaption>{r.to}</figcaption>
              </figure>
            ))}
          </div>

          <table className="rows">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Square</th>
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
                  <td>{r.square}</td>
                  <td>{r.notes.join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {result && !result.empty && !busy && (
        <div className="done">
          <span>
            {result.rows.length} image{result.rows.length === 1 ? "" : "s"} ready as{" "}
            <b>{result.product}</b>
          </span>
          <button onClick={() => void window.ww.showFolder(result.outDir)}>Open the folder</button>
        </div>
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

/**
 * ui.tsx — the pieces every step reuses.
 *
 * The rule this file exists to enforce: **no step ever asks anyone to type an ID or a path.**
 * Typing an ID from memory is how the wrong listing gets picked, which is WW-078; typing a path
 * is what the app was built to remove. Every step picks from a list or from a folder dialog, and
 * every dialog opens where that step was last used.
 */

import React, { useEffect, useState } from "react";
import type { Listing, StepId } from "../shared.js";

/**
 * Join a folder and a child name. The renderer has no `path` module, and Node accepts a forward
 * slash on Windows — but the partner READS these paths, and `C:\Users\him\Downloads/wishworks-ready`
 * looks like something went wrong. Follow whatever separator the folder already uses.
 */
export const joinPath = (dir: string, name: string) =>
  dir.includes("\\") && !dir.includes("/") ? `${dir}\\${name}` : `${dir}/${name}`;

/**
 * A local path as a `file://` URL for an `<img>`. Handles `C:\Users\…` as well as `/Users/…`,
 * because the renderer is the one place that has to build these by hand and Windows is where a
 * `/`-only version would silently show broken thumbnails. `encodeURIComponent` per segment is what
 * makes a folder with a space in it work — and the workspace default is under "Application
 * Support".
 *
 * It lived in Convert.tsx and PhotoInbox.tsx as two identical copies; the third panel that needed
 * it is what made that worth fixing.
 */
export const fileUrl = (p: string) =>
  "file:///" + p.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent).join("/");

/** Copy text to the clipboard and say so for a moment. The whole interaction is one click. */
export function CopyButton({ text, label = "Copy", disabled }: { text: string; label?: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={done ? "copied" : ""}
      disabled={disabled || !text}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

/** Newest first, because the listing being worked on is always the one written last. */
export function ListingPicker({
  value,
  onChange,
  need,
}: {
  value: string | null;
  /**
   * The whole row is handed back, not just the ID. `id` is a normalised MATCHING key — `GTB-4`
   * normalises to `GTB4` — so a caller that needs a path or a filename must use `folder`/`label`.
   * Handing back only the ID is what wrote `GTB4.1.jpg` into a workspace full of `GTB-4`.
   */
  onChange: (id: string, listing: Listing) => void;
  /** Mark rows that are missing something this step needs, without hiding them. */
  need?: (l: Listing) => string | null;
}) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);

  const load = () => void window.ww.listings().then(setListings);
  useEffect(load, []);
  // Which folder this list is read from. There is an image-meta/ in the project folder and
  // another in the app's workspace; the app only ever reads the workspace. Without saying so,
  // deleting the project copies looks exactly like a Refresh button that does not work.
  useEffect(() => void window.ww.workspaceDir().then(setWorkspace), []);

  const where = workspace && (
    <p className="muted from-where">
      Read from <span className="path">{workspace}</span> — change it under <b>Listing copy</b> or
      in Settings.
    </p>
  );

  if (listings === null) return <p className="muted">Looking…</p>;
  if (listings.length === 0) {
    return (
      <>
        <p className="muted">
          No listings yet. Convert some images, or use <b>Bring in the AI's files</b> below to pull
          the downloaded JSON in.
        </p>
        {where}
      </>
    );
  }

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="muted">
          Newest first · the tags say which pieces exist: <em>copy</em> the Meesho text,{" "}
          <em>flipkart</em> the 66 form fields, <em>images</em> a converted photo folder,{" "}
          <em>finished</em> photos with the descriptions stamped in
        </span>
        <button onClick={load}>Refresh</button>
      </div>
      {where}
      <ul>
        {listings.map((l) => {
          const missing = need?.(l) ?? null;
          return (
            <li key={l.id}>
              <button className={l.id === value ? "chosen" : ""} onClick={() => onChange(l.id, l)}>
                <span className="lid">{l.label}</span>
                <span className="tags">
                  {l.meta && <em title="image-meta/ — the Meesho title, description and pack contents">copy</em>}
                  {l.product && <em title="products/ — the 66 Flipkart form fields">flipkart</em>}
                  {l.images && <em title="images/2-clean/ — converted photos are ready for this listing">images</em>}
                  {l.finished && <em title="images/3-final/ — photos with the descriptions stamped inside">finished</em>}
                </span>
                {missing && <span className="missing">{missing}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A folder this step remembers, with the picker that changes it. Never a text box. */
export function FolderRow({
  step,
  label,
  value,
  onChange,
}: {
  step: StepId;
  label: string;
  value: string | null;
  onChange: (dir: string) => void;
}) {
  return (
    <div className="folder-row">
      <div>
        <span className="folder-label">{label}</span>
        <span className="path">{value ?? "not chosen yet"}</span>
      </div>
      <div className="picks">
        <button
          onClick={() => void window.ww.pick(step, "folder").then((p) => p[0] && onChange(p[0]))}
        >
          Choose…
        </button>
        {value && <button onClick={() => void window.ww.showFolder(value)}>Open</button>}
      </div>
    </div>
  );
}

/**
 * A step the app does not do yet.
 *
 * It deliberately does **not** print a terminal command. The person this app exists for has no
 * Node and no npm, so "run `npm run check`" is not a fallback for them — it is a dead end
 * dressed up as instructions. Say what the step is for and that it is coming; that is honest and
 * equally useless to them, but it does not pretend otherwise.
 */
export function NotBuilt({ n, label, why }: { n: number; label: string; why: string }) {
  return (
    <section className="panel">
      <header>
        <h1>
          {n === 0 ? label : `${n}. ${label}`}
        </h1>
        <p>{why}</p>
      </header>
      <p className="muted">Not in the app yet — it is the next thing being built.</p>
    </section>
  );
}

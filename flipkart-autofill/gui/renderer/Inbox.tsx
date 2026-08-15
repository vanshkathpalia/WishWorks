/**
 * Inbox.tsx — bring the AI's downloaded JSON in, without anyone copying files by hand.
 *
 * The prompts hand back `image-meta-<ID>.json` and `products-<ID>.json` into Downloads, and every
 * later step reads them from `image-meta/` and `products/`. Closing that gap by hand, once per
 * listing, is exactly where a file lands in the wrong folder — the same class of mistake as
 * WW-077/WW-078, one directory over.
 *
 * Two things make the button safe to press repeatedly: the destination is decided by what is
 * INSIDE each file, never its name, and nothing already filed is replaced by something older.
 */

import React, { useEffect, useState } from "react";
import type { InboxItem } from "../shared.js";
import { SkuFlag } from "./ui.js";

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

export function Inbox({ onImported }: { onImported: () => void }) {
  const [from, setFrom] = useState<string | null>(null);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [move, setMove] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);

  useEffect(() => {
    void window.ww.downloadsDir().then((d) => {
      setFrom(d);
      void window.ww.scanInbox(d).then(setItems);
    });
    // Say WHERE the files land. There is an image-meta/ in the repo and another in the app's
    // workspace, and naming only the folder cost an afternoon: files were deleted from the repo
    // copy and the app went on listing them, correctly, from the workspace.
    void window.ww.workspaceDir().then(setWorkspace);
  }, []);

  const rescan = (dir: string) => {
    setDone(null);
    setItems(null);
    void window.ww.scanInbox(dir).then(setItems);
  };

  async function bringIn() {
    if (!from) return;
    const r = await window.ww.importInbox(from, { move });
    setDone(
      r.imported.length === 0
        ? "Nothing new — everything in that folder is already filed."
        : `Brought in ${r.imported.length} file${r.imported.length === 1 ? "" : "s"}.`,
    );
    rescan(from);
    onImported();
  }

  const pending = items?.filter((i) => i.action === "new" || i.action === "update") ?? [];

  return (
    <section className="inbox">
      <h3>Bring in the AI's files</h3>
      <p className="muted">
        Looks in your downloads folder and puts each file where the app keeps it — sorted by what
        is <i>inside</i> the file, not what it is called, so a renamed file still lands right.
        Pressing it twice is safe: anything already saved is left alone.
      </p>
      <div className="folder-row">
        <div>
          <span className="folder-label">Where they get saved</span>
          <span className="path">{workspace ?? "…"}</span>
        </div>
        <div className="picks">
          {/* The same picker Settings uses. Choosing relaunches the app, because the engine reads
              these paths once at startup — see gui/main.ts. Nothing is moved out of the old
              folder, so a wrong choice costs nothing. */}
          <button onClick={() => void window.ww.chooseWorkspace()}>Change…</button>
          {workspace && <button onClick={() => void window.ww.showFolder(workspace)}>Open</button>}
        </div>
      </div>
      <p className="muted">
        Everything the app keeps — <code>image-meta/</code>, <code>products/</code> and{" "}
        <code>images/</code> — lives inside that one folder, and files deleted anywhere else will
        not change what the app shows. Put it wherever suits you. <b>Changing it restarts the
        app</b>, and nothing is moved out of the old folder.
      </p>

      <div className="folder-row">
        <div>
          <span className="folder-label">Downloads folder</span>
          <span className="path">{from ?? "…"}</span>
        </div>
        <div className="picks">
          <button
            onClick={() =>
              void window.ww.pick("inbox", "folder").then((p) => {
                if (p[0]) {
                  setFrom(p[0]);
                  rescan(p[0]);
                }
              })
            }
          >
            Choose…
          </button>
          <button onClick={() => from && rescan(from)}>Check again</button>
        </div>
      </div>

      {items === null ? (
        <p className="muted">Looking…</p>
      ) : pending.length === 0 ? (
        // Saying only "nothing new" over a folder holding eight importable-looking files reads as
        // a broken button. Say what was seen and why each kind was passed over, because the
        // usual cause is invisible: Finder's list shows "Date Added", this compares "Date
        // Modified", and a file copied in keeps the older modified date.
        <p className="muted">
          {items.length === 0 ? (
            <>No .json files in that folder.</>
          ) : (
            <>
              Nothing new. Of {items.length} .json file{items.length === 1 ? "" : "s"} in there:{" "}
              {items.filter((i) => i.action === "older").length} already filed and not newer than
              what is in <code>image-meta/</code> or <code>products/</code>,{" "}
              {items.filter((i) => i.action === "unknown").length} not a listing file.
            </>
          )}
        </p>
      ) : (
        <table className="rows">
          <thead>
            <tr>
              <th>File</th>
              <th>Goes to</th>
              <th>Downloaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((i) => (
              <tr key={i.file}>
                {/* The flag shows here, BEFORE the button — and the button still imports it.
                    Sometimes the file is right and the prefix is the typo. */}
                <td>
                  {i.file.split(/[\\/]/).pop()} <SkuFlag id={i.id} />
                </td>
                <td>{i.half}/</td>
                <td>{ago(i.modified)}</td>
                <td>{i.action === "update" ? "replaces an older copy" : "new"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="picks">
        <button className="primary" disabled={pending.length === 0} onClick={() => void bringIn()}>
          Bring in {pending.length || ""} file{pending.length === 1 ? "" : "s"}
        </button>
        <label className="inline">
          <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
          move instead of copy
        </label>
      </div>
      {done && <p className="muted">{done}</p>}
    </section>
  );
}

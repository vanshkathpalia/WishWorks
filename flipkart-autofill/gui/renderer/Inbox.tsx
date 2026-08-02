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

  useEffect(() => {
    void window.ww.downloadsDir().then((d) => {
      setFrom(d);
      void window.ww.scanInbox(d).then(setItems);
    });
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
        Looks in the folder your downloads land in and files each one into <code>image-meta/</code>{" "}
        or <code>products/</code> — decided by what is inside the file, not its name. Anything
        already filed and newer is left alone, so pressing this twice does nothing the second time.
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
        <p className="muted">Nothing new in there.</p>
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
                <td>{i.file.split(/[\\/]/).pop()}</td>
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

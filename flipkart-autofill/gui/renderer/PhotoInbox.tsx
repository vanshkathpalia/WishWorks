/**
 * PhotoInbox.tsx — put the AI's downloaded pictures into the listing folder they belong to.
 *
 * The JSON half of this is `Inbox.tsx`. This half has an extra decision in it that a machine
 * genuinely cannot make: **which position a picture takes.** `ChatGPT Image Jul 31.png` says
 * nothing, and a hero silently filed into slot 2 is invisible until the listing is live. So the
 * position is always a visible choice, pre-filled only when the filename actually said.
 *
 * The thumbnail is there for the same reason — it is the only way to be sure the thing about to
 * become image 1 is the hero and not the infographic.
 */

import React, { useEffect, useState } from "react";
import type { PhotoItem } from "../shared.js";
import { fileUrl } from "./ui.js";

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

export function PhotoInbox() {
  const [from, setFrom] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [items, setItems] = useState<PhotoItem[] | null>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [move, setMove] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.ww.downloadsDir().then(setFrom);
    void window.ww.rememberedFolders().then((f) => setRoot(f.finish ?? null));
  }, []);

  const rescan = (f: string | null, r: string | null) => {
    setItems(null);
    setDone([]);
    setError(null);
    if (f && r) void window.ww.scanPhotos(f, r).then(setItems);
  };

  useEffect(() => rescan(from, root), [from, root]);

  async function file(item: PhotoItem) {
    const pos = positions[item.file] ?? item.position;
    if (!pos || !item.target) return;
    try {
      const r = await window.ww.importPhoto(item, pos, { move });
      setDone((d) => [
        ...d,
        `${item.file.split(/[\\/]/).pop()} → ${item.target!.name}/${pos}${r.removed.length ? ` (replaced ${r.removed.join(", ")})` : ""}`,
      ]);
      rescan(from, root);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="inbox">
      <h3>Bring in the AI's pictures</h3>
      <p className="muted">
        Looks in your downloads folder, works out which listing each picture belongs to, and puts
        it in that folder as <b>1.png</b> or <b>2.png</b> — <b>deleting the file it replaces</b>,
        because <i>1.png</i> and <i>1.jpg</i> both sitting there is position 1 twice and stops the
        finish step.
      </p>

      <div className="folder-row">
        <div>
          <span className="folder-label">Downloads folder</span>
          <span className="path">{from ?? "…"}</span>
        </div>
        <div className="picks">
          <button onClick={() => void window.ww.pick("inbox", "folder").then((p) => p[0] && setFrom(p[0]))}>
            Choose…
          </button>
        </div>
      </div>

      <div className="folder-row">
        <div>
          <span className="folder-label">Your listings archive</span>
          <span className="path">{root ?? "not chosen — pick the folder your listing folders live under"}</span>
        </div>
        <div className="picks">
          <button onClick={() => void window.ww.pick("finish", "folder").then((p) => p[0] && setRoot(p[0]))}>
            Choose…
          </button>
          <button onClick={() => rescan(from, root)}>Check again</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {!root ? (
        <p className="muted">
          Pick the folder your listing folders sit under — the one holding <i>ANP</i>, <i>GTB</i>
          and so on. Every folder beneath it that already has numbered images counts as a listing.
        </p>
      ) : items === null ? (
        <p className="muted">Looking…</p>
      ) : items.length === 0 ? (
        <p className="muted">No pictures in that downloads folder.</p>
      ) : (
        <div className="photos">
          {items.map((item) => {
            const pos = positions[item.file] ?? item.position ?? 0;
            return (
              <div className="photo" key={item.file}>
                <img src={fileUrl(item.file)} alt="" />
                <div className="photo-body">
                  <b>{item.file.split(/[\\/]/).pop()}</b>
                  <span className="muted">{ago(item.modified)}</span>
                  {item.target ? (
                    <>
                      <span>
                        goes to <b>{item.target.name}</b>
                      </span>
                      <div className="picks">
                        <label className="inline">
                          as image
                          <select
                            value={pos}
                            onChange={(e) =>
                              setPositions((p) => ({ ...p, [item.file]: Number(e.target.value) }))
                            }
                          >
                            <option value={0}>choose…</option>
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n}
                                {n === 1 ? " — hero" : n === 2 ? " — infographic" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="primary" disabled={!pos} onClick={() => void file(item)}>
                          File it
                        </button>
                      </div>
                    </>
                  ) : (
                    <span className="missing">
                      no listing folder named <b>{item.id}</b> under that archive — rename the
                      download to the listing's code, or check the archive folder above
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <label className="inline">
        <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
        move instead of copy
      </label>

      {done.map((d) => (
        <p className="muted" key={d}>
          {d}
        </p>
      ))}
    </section>
  );
}

/**
 * ProductEditor.tsx — open a listing's `products/<ID>.json` and edit it here.
 *
 * Vansh, 2026-08-12: *"we should have the freedom to open that json in the app UI also."* The
 * thing that forced it is `TODO_MRP` — the price is per-listing, the AI is told never to guess it
 * (WW-111), so every listing arrives with two placeholders that could only be filled by finding
 * the file on disk and opening a code editor. For the partner, who is the reason this app exists,
 * that is not a step, it is a wall.
 *
 * Raw JSON on purpose, not a generated form. The file is 60-odd freeform fields whose shape is
 * decided by the prompt and the scanned category; a form would have to be regenerated every time
 * either changed, and would quietly refuse to show a key it did not know about. A textarea shows
 * everything that is there, including whatever is wrong with it.
 *
 * **Saving is refused unless it parses** (checked in main.ts, not here — the renderer must not be
 * the only thing standing between a typo and the bot). A broken file would take the whole listing
 * down at fill time, which is exactly where it is hardest to read the error.
 */

import React, { useEffect, useState } from "react";

export function ProductEditor({ id, close }: { id: string; close: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.ww.readProduct(id).then((r) => {
      if (!r.ok) return setError(r.message);
      setFile(r.result.file);
      setText(r.result.text);
    });
  }, [id]);

  async function save() {
    if (!file) return;
    const r = await window.ww.saveProduct(file, text);
    if (!r.ok) return setError(r.message);
    setError(null);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="modal" onClick={close}>
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        <h2>{id} — the listing file</h2>
        <p className="muted">
          {file ?? "…"} · everything the bot types comes from here. Fill in anything that still
          says <code>TODO_</code>, keeping the quotes around it.
        </p>

        {error && <p className="error">{error}</p>}
        {saved && <p className="allgood">Saved. Fill the tab again to use it.</p>}

        <textarea
          className="json"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
            setError(null);
          }}
        />

        <div className="picks">
          <button className="primary" disabled={!dirty || !file} onClick={() => void save()}>
            {dirty ? "Save" : "Saved"}
          </button>
          <button onClick={close}>Close</button>
          <span className="muted">
            A save is refused if the JSON does not parse, so a half-typed file can never reach the
            form — the message will say what is wrong with it.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * ShareInventory.tsx — Settings' Export / Import inventory buttons, in their own file so a test can
 * render them (main.tsx mounts the whole app the moment it is imported).
 */

import { useState } from "react";

/**
 * Two buttons instead of a database: send your inventory knowledge to someone, or take theirs.
 *
 * Import only adds. Anything the two computers disagree about — a price, a word — is listed here and
 * left as it was, because a silently overwritten price is the mistake nobody would notice.
 */
export function ShareInventory() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<string[]>([]);

  type Reply = { ok: boolean; message?: string; note?: string; result?: unknown };
  const run = async (call: () => Promise<Reply>): Promise<Reply | undefined> => {
    setBusy(true);
    setNote(null);
    setError(null);
    setClashes([]);
    const r: Reply = await call().catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    // An empty message is a cancelled dialog: nothing to say.
    if (!r.ok) {
      if (r.message) setError(r.message);
      return undefined;
    }
    return r;
  };

  return (
    <>
      <h3>Share inventory with someone</h3>
      <p className="muted">
        <b>Export</b> saves this computer&apos;s price list, the supplier words it has been taught and the
        delivery-note names it remembers into one file — send it over WhatsApp or Drive.{" "}
        <b>Import</b> adds whatever that file has and this computer does not. It never changes a price
        you already have: anything that differs is listed below for you to decide. Deliveries and
        stock are not included — each of you counts your own shelf.
      </p>
      <div className="picks">
        <button
          disabled={busy}
          onClick={() =>
            void run(() => window.ww.exportInventory()).then((r) => r && setNote(`${r.note ?? ""} (${String(r.result)})`))
          }
        >
          Export inventory…
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(() => window.ww.importInventory()).then((r) => {
              if (!r) return;
              const res = r.result as { added: string; clashes: string[] };
              setNote(res.added + (res.clashes.length ? ` ${res.clashes.length} left as they were:` : " Nothing clashed."));
              setClashes(res.clashes);
            })
          }
        >
          Import inventory…
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="allgood">{note}</p>}
      {clashes.length > 0 && (
        <ul className="kv">
          {clashes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </>
  );
}


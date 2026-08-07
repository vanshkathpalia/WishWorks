/**
 * Inventory.tsx — what a kit costs, from the sheet the partner sends.
 *
 * The Excel this replaces is slow for one reason: every line is a dropdown and a kit is twenty
 * lines. The counts are already printed on the sheet, so this reads them once and only asks a
 * human about the lines it is unsure of.
 *
 * **The image sits beside the table on purpose, and it is the whole verification story.** OCR was
 * built and removed (WW-115): when OCR and the AI disagree you still have to open the image to see
 * which is right, so the image IS the check, and reading a table against the picture it came from
 * is one glance.
 *
 * Four states per line, and they are deliberately different because their fixes are different:
 *   priced        — quiet.
 *   flagged       — priced, but the name was ambiguous. Check it against the picture.
 *   no price set  — the material is on the list, its price cell is blank. Fill a cell.
 *   not on list   — no such material. Add a row, or correct this line.
 * The last two are summed as *uncosted* and printed next to the total, because a total that
 * quietly skipped four items is the failure this screen exists to prevent.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Kit, KitLine, Material, SavedKit } from "../shared.js";
import { CopyButton, fileUrl } from "./ui.js";
import { PromptEditor } from "./PromptEditor.js";

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;

/** `cost / (1 - margin)` — margin on the selling price, not markup on the cost. See the engine. */
const priceAt = (costPaise: number, margin: number) =>
  Math.round(costPaise / (1 - Math.min(Math.max(margin, 0), 95) / 100));

const key = (m: Material) => `${m.category}|${m.material}`;

export function Inventory({ n }: { n: number }) {
  const [prompt, setPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [gaps, setGaps] = useState<{ noPrice: Material[]; noSize: Material[]; total: number } | null>(null);
  const [showGaps, setShowGaps] = useState(false);

  const [image, setImage] = useState<string | null>(null);
  const [lines, setLines] = useState<KitLine[] | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [sku, setSku] = useState("");
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [margin, setMargin] = useState(50);
  const [over, setOver] = useState<"image" | "json" | null>(null);
  const [saved, setSaved] = useState<{ sku: string; file: string; savedAt: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const refreshSaved = useCallback(() => void window.ww.listKits().then(setSaved), []);

  // Re-read after the editor closes, in case the prompt was changed.
  useEffect(() => {
    if (editing) return;
    void window.ww.promptText("PROMPT-inventory.md").then(setPrompt).catch(() => setPrompt(""));
  }, [editing]);
  useEffect(() => {
    void window.ww.materials().then(setMaterials);
    void window.ww.materialGaps().then(setGaps);
    refreshSaved();
  }, [refreshSaved]);

  // One source for the total: every correction re-costs the whole kit in the engine, so the
  // number at the bottom can never disagree with the rows above it.
  useEffect(() => {
    if (!lines) return;
    void window.ww.costLines(lines, overrides, sku).then(setKit);
  }, [lines, overrides, sku]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Material[]>();
    for (const m of materials) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  async function loadReply(file: string) {
    const r = await window.ww.costInventory(file, {});
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setError(null);
    setOverrides({}); // a new reply is a new kit; the last kit's corrections do not apply
    setSku(r.result.sku);
    setLines(r.result.lines.map(({ item, qty, size }) => (size ? { item, qty, size } : { item, qty })));
    setKit(r.result);
  }

  function dropped(e: React.DragEvent, kind: "image" | "json") {
    e.preventDefault();
    setOver(null);
    const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
    if (kind === "image") {
      const img = paths.find((p) => /\.(png|jpe?g|webp|avif|gif)$/i.test(p));
      if (img) setImage(img);
      return;
    }
    const json = paths.find((p) => p.toLowerCase().endsWith(".json"));
    if (json) void loadReply(json);
  }

  async function save() {
    if (!lines) return;
    const kept: SavedKit = { sku, image, lines, overrides, marginPercent: margin, savedAt: "" };
    const file = await window.ww.saveKit(kept);
    setNote(`Kept as ${file.split(/[\\/]/).pop()}.`);
    setTimeout(() => setNote(null), 4000);
    refreshSaved();
  }

  async function reopen(file: string) {
    const k = await window.ww.openKit(file);
    setSku(k.sku);
    setImage(k.image);
    setOverrides(k.overrides ?? {});
    setMargin(k.marginPercent ?? 50);
    setLines(k.lines);
    setError(null);
  }

  const total = kit?.totalPaise ?? 0;

  return (
    <section className="panel">
      <header>
        <h1>{n === 0 ? "Inventory cost" : `${n}. Inventory cost`}</h1>
        <p>
          What a kit costs us, read off the sheet instead of picked from a dropdown twenty times.
          Drop the picture on the left so you can read the table against it — that is the check.
        </p>
      </header>

      <div className="inv-top">
        <div
          className={`drop inv-image ${over === "image" ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver("image");
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => dropped(e, "image")}
        >
          {image ? (
            <img src={fileUrl(image)} alt="the inventory sheet" onDoubleClick={() => setImage(null)} />
          ) : (
            <>
              <strong>Drop the inventory picture here</strong>
              <span className="muted">
                Nothing is read off it by the app — it is here so you can check the table against
                it.
              </span>
              <button
                onClick={() => void window.ww.pick("inventory", "files").then((p) => p[0] && setImage(p[0]))}
              >
                Choose the picture…
              </button>
            </>
          )}
        </div>

        <div className="inv-steps">
          <h3>1 — ask the AI what is on it</h3>
          <div className="picks">
            <CopyButton text={prompt} label="Copy the prompt" disabled={!prompt} />
            <button onClick={() => setEditing(true)}>Open</button>
          </div>
          <p className="muted">
            Attach the same picture in the chat. It comes back with the items{" "}
            <b>in the words the sheet uses</b> — the matching against our{" "}
            <b>{materials.length}</b> price rows happens here, not there, so nothing has to be
            pasted into the prompt and old sheets keep working.
          </p>

          <h3>2 — bring the reply back</h3>
          <div
            className={`drop small ${over === "json" ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver("json");
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => dropped(e, "json")}
          >
            <strong>Drop the downloaded .json here</strong>
            <div className="picks">
              <button
                onClick={() =>
                  void window.ww.pick("inventory", "files").then((p) => {
                    const json = p.find((f) => f.toLowerCase().endsWith(".json"));
                    if (json) void loadReply(json);
                  })
                }
              >
                Choose the file…
              </button>
            </div>
          </div>

          {saved.length > 0 && (
            <>
              <h3>Kits you have costed</h3>
              <div className="picks inv-saved">
                {saved.slice(0, 8).map((k) => (
                  <button key={k.file} onClick={() => void reopen(k.file)}>
                    {k.sku}
                  </button>
                ))}
              </div>
              <p className="muted">
                Reopening re-costs from today's price list — what is stored is the reading and your
                corrections, never a total, so a kit never shows last month's balloon price.
              </p>
            </>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {materials.length === 0 && (
        <p className="problems">
          The price list is empty, so nothing can be costed. <code>categories/materials.json</code>{" "}
          ships inside the app — if this says zero on a real install, it did not make it into the
          build.
        </p>
      )}

      {kit && (
        <>
          {kit.uncosted > 0 && (
            <div className="problems">
              <h3>
                {kit.uncosted} line{kit.uncosted === 1 ? "" : "s"} not counted in the total
              </h3>
              <ul>
                {kit.noPrice > 0 && (
                  <li>
                    <b>{kit.noPrice} on the price list with no price filled in.</b> The material
                    exists — its price cell is blank. Somebody fills the cell and the next build
                    costs it.
                  </li>
                )}
                {kit.unmatched > 0 && (
                  <li>
                    <b>{kit.unmatched} match no material at all.</b> Either pick the right one on
                    that row, or it needs adding to the price list.
                  </li>
                )}
              </ul>
              <p className="muted">
                Either way the total below is <b>lower than the real cost</b>, so do not price off
                it until these are settled.
              </p>
            </div>
          )}

          {kit.flagged > 0 && (
            <p className="problems">
              <b>{kit.flagged} line{kit.flagged === 1 ? " was" : "s were"} matched loosely</b> and
              are marked <em>check</em> below. They are priced, but the name on the sheet fitted
              more than one row — read those against the picture before trusting the total.
            </p>
          )}

          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Item, as the sheet has it</th>
                <th>Count</th>
                <th>Priced as</th>
                <th>Each</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {kit.lines.map((l, i) => (
                <tr key={i} className={l.paise === null ? "warn" : ""}>
                  <td>
                    {l.item}
                    {l.size && <span className="muted"> · {l.size}</span>}
                  </td>
                  <td>{l.qty}</td>
                  <td>
                    {/* Every row is correctable, including one that matched confidently — the
                        picture is the authority, and a name can be right and still be the wrong
                        material. The near misses are in the list too, so an unmatched line is one
                        click from fixed rather than a hunt through 121 rows. */}
                    <select
                      className={l.flagged ? "loose" : ""}
                      value={l.match ? key(l.match) : ""}
                      onChange={(e) => setOverrides((o) => ({ ...o, [i]: e.target.value }))}
                    >
                      <option value="">— not on the price list —</option>
                      {!l.overridden && l.choices.length > 0 && (
                        <optgroup label="closest matches">
                          {l.choices.map((c) => (
                            <option key={`c-${key(c.material)}`} value={key(c.material)}>
                              {c.material.material} · {Math.round(c.score * 100)}%
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {byCategory.map(([category, rows]) => (
                        <optgroup key={category} label={category}>
                          {rows.map((m) => (
                            <option key={key(m)} value={key(m)}>
                              {m.material} · {m.paise === null ? "no price" : rupees(m.paise)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {l.flagged && <span className="warnpill">check</span>}
                    {l.match && l.paise === null && <span className="warnpill">no price set</span>}
                  </td>
                  <td>{l.match && l.match.paise !== null ? rupees(l.match.paise) : "—"}</td>
                  <td>{l.paise === null ? "—" : rupees(l.paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <b>Cost of materials</b>
                  {kit.uncosted > 0 && (
                    <span className="muted"> · {kit.uncosted} line(s) not counted</span>
                  )}
                </td>
                <td>
                  <b>{rupees(total)}</b>
                </td>
              </tr>
            </tfoot>
          </table>

          <h3>What to sell it at</h3>
          <div className="picks">
            <label className="inline">
              Margin
              <input
                type="number"
                min={0}
                max={95}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
              %
            </label>
            <span className="inv-price">{rupees(priceAt(total, margin))}</span>
            <button className="primary" onClick={() => void save()}>
              Keep this kit
            </button>
            {note && <span className="muted">{note}</span>}
          </div>
          <p className="muted">
            <b>This is a floor, not a listing price.</b> It is {margin}% margin over the cost of
            materials and nothing else — it does not know the marketplace commission, the shipping
            fee, GST or packaging. The real formula goes in here once the sheet that computes it
            has been sent.
          </p>
        </>
      )}

      {gaps && (gaps.noPrice.length > 0 || gaps.noSize.length > 0) && (
        <div className="inv-gaps">
          <h3>
            What the price list still needs{" "}
            <button onClick={() => setShowGaps((s) => !s)}>{showGaps ? "hide" : "show"}</button>
          </h3>
          <p className="muted">
            <b>{gaps.noPrice.length}</b> of {gaps.total} materials have no price yet, and{" "}
            <b>{gaps.noSize.length}</b> have no size. Any kit containing one of the priceless ones
            costs less than it really does, and says so.
          </p>
          {showGaps && (
            <ul className="kv">
              {gaps.noPrice.map((m) => (
                <li key={key(m)}>
                  <b>{m.category}</b>
                  <span>{m.material}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <PromptEditor file="PROMPT-inventory.md" close={() => setEditing(false)} />}
    </section>
  );
}

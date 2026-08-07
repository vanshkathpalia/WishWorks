/**
 * Inventory.tsx — what a kit costs, from the sheet the partner sends.
 *
 * The Excel this replaces is slow for one reason: every line is a dropdown and a kit is twenty
 * lines. The counts are already printed on the sheet, so this reads them once and never asks
 * anyone to pick a material again unless it got one wrong.
 *
 * **The image sits beside the table on purpose, and it is the whole verification story.** OCR was
 * considered as a second opinion and dropped: when OCR and the AI disagree you still have to open
 * the image to see which is right, so the image is the check — and reading a table against the
 * picture it came from is one glance. What OCR would have added is a fuzzy matcher, and a line
 * priced off the wrong row is invisible in a total.
 *
 * Two things are therefore always visible: **how many lines could not be priced**, and the total
 * next to them. A total that quietly skipped four items is the failure this screen exists to
 * prevent.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { Kit, Material } from "../shared.js";
import { CopyButton, fileUrl } from "./ui.js";
import { PromptEditor } from "./PromptEditor.js";

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;

/** `cost / (1 - margin)` — margin on the selling price, not markup on the cost. See the engine. */
const priceAt = (costPaise: number, margin: number) =>
  Math.round(costPaise / (1 - Math.min(Math.max(margin, 0), 95) / 100));

export function Inventory({ n }: { n: number }) {
  const [prompt, setPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [image, setImage] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [kit, setKit] = useState<Kit | null>(null);
  const [sku, setSku] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [margin, setMargin] = useState(50);
  const [over, setOver] = useState<"image" | "json" | null>(null);

  // Re-read after the editor closes: the prompt carries the price list appended, so an edit in
  // there changes what this button copies.
  useEffect(() => {
    if (editing) return;
    void window.ww.inventoryPrompt().then(setPrompt).catch(() => setPrompt(""));
  }, [editing]);
  useEffect(() => void window.ww.materials().then(setMaterials), []);

  // Every correction re-prices the whole kit. It is a few dozen multiplications; keeping one
  // source of the total means the screen can never show a total that disagrees with its rows.
  useEffect(() => {
    if (!file) return;
    void window.ww.costInventory(file, overrides).then((r) => {
      if (r.ok) {
        setKit(r.result.kit);
        setSku(r.result.sku);
        setError(null);
      } else {
        setKit(null);
        setError(r.message);
      }
    });
  }, [file, overrides]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Material[]>();
    for (const m of materials) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

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
    if (json) {
      setOverrides({}); // a new reply is a new kit; last kit's corrections do not apply to it
      setFile(json);
    }
  }

  const total = kit?.totalPaise ?? 0;

  return (
    <section className="panel">
      <header>
        <h1>{n}. Inventory cost</h1>
        <p>
          What the kit costs us, read off the sheet instead of typed into a dropdown twenty times.
          Drop the inventory picture on the left so you can read the table against it.
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
            <img src={fileUrl(image)} alt="the inventory sheet" />
          ) : (
            <>
              <strong>Drop the inventory picture here</strong>
              <span className="muted">
                Only so you can see it beside the table — nothing is read off it by the app.
              </span>
              <button
                onClick={() =>
                  void window.ww
                    .pick("inventory", "files")
                    .then((p) => p[0] && setImage(p[0]))
                }
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
            Attach the same picture in the chat. The prompt goes out with{" "}
            <b>{materials.length} price-list name{materials.length === 1 ? "" : "s"}</b> appended
            and asks for those names back exactly, so nothing here has to guess which row an item
            is. Anything not on the list comes back as printed and is flagged below rather than
            matched to the nearest thing.
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
                    if (json) {
                      setOverrides({});
                      setFile(json);
                    }
                  })
                }
              >
                Choose the file…
              </button>
            </div>
          </div>
          {file && <p className="muted">{file.split(/[\\/]/).pop()}{sku && ` · ${sku}`}</p>}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {materials.length === 0 && (
        <p className="problems">
          The price list is empty, so nothing can be costed. `categories/materials.json` ships with
          the app — if this says zero on a real install, the file did not make it into the build.
        </p>
      )}

      {kit && (
        <>
          {kit.unpriced > 0 && (
            <div className="problems">
              <h3>
                {kit.unpriced} line{kit.unpriced === 1 ? " is" : "s are"} not on the price list
              </h3>
              <p>
                The total below <b>does not include</b> them, so it is lower than the real cost.
                Either pick the right material on that row, or add it to the price list and send a
                new build.
              </p>
            </div>
          )}

          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Item as the sheet has it</th>
                <th>Count</th>
                <th>Priced as</th>
                <th>Each</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {kit.lines.map((l, i) => (
                <tr key={i} className={l.paise === null ? "warn" : ""}>
                  <td>{l.material}</td>
                  <td>{l.qty}</td>
                  <td>
                    {/* Every row is correctable, including one that matched — the sheet is the
                        authority, and a name can be right and still be the wrong material. */}
                    <select
                      value={l.match ? `${l.match.category}|${l.match.material}` : ""}
                      onChange={(e) =>
                        setOverrides((o) => ({ ...o, [i]: e.target.value }))
                      }
                    >
                      <option value="">not on the price list</option>
                      {byCategory.map(([category, rows]) => (
                        <optgroup key={category} label={category}>
                          {rows.map((m) => (
                            <option key={m.material} value={`${m.category}|${m.material}`}>
                              {m.material} · {rupees(m.paise)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td>{l.match ? rupees(l.match.paise) : "—"}</td>
                  <td>{l.paise === null ? "—" : rupees(l.paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <b>Cost of materials</b>
                  {kit.unpriced > 0 && (
                    <span className="muted"> · {kit.unpriced} line(s) not counted</span>
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
          </div>
          <p className="muted">
            <b>This is a floor, not a listing price.</b> It is {margin}% margin over the cost of
            materials and nothing else — it does not know the marketplace commission, the shipping
            fee, GST or packaging. The real formula is in Vansh's sheet and goes in here once it
            has been sent.
          </p>
        </>
      )}

      {editing && <PromptEditor file="PROMPT-inventory.md" close={() => setEditing(false)} />}
    </section>
  );
}

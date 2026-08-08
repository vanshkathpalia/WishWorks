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
import type { Kit, KitLine, Material, Parcel, SavedKit } from "../shared.js";
import { CopyButton, fileUrl } from "./ui.js";
import { PromptEditor } from "./PromptEditor.js";

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;

/** `cost / (1 - margin)` — margin on the selling price, not markup on the cost. See the engine. */
const priceAt = (costPaise: number, margin: number) =>
  Math.round(costPaise / (1 - Math.min(Math.max(margin, 0), 95) / 100));

const key = (m: Material) => `${m.category}|${m.material}`;

/** The two we sell on. Ids are the keys stored in the saved kit, so renaming a label is safe. */
const MARKETPLACES = [
  { id: "meesho", label: "Meesho" },
  { id: "flipkart", label: "Flipkart" },
] as const;

/** Rupees in the boxes, paise on disk — the boundary is here, once, in both directions. */
type Market = Record<string, { price?: number; ship?: number }>;

export function Inventory({ n }: { n: number }) {
  const [prompt, setPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [gaps, setGaps] = useState<{ noPrice: Material[]; noSize: Material[]; total: number } | null>(null);
  const [showGaps, setShowGaps] = useState(false);

  const [image, setImage] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [lines, setLines] = useState<KitLine[] | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [sku, setSku] = useState("");
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [margin, setMargin] = useState(50);
  // The partner's current advice is +60 flat. A default, not a rule — it is editable and saved.
  const [flat, setFlat] = useState(60);
  const [over, setOver] = useState<"image" | "json" | null>(null);
  const [saved, setSaved] = useState<{ sku: string; file: string; savedAt: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [market, setMarket] = useState<Market>({});
  const [parcel, setParcel] = useState<{
    parcel: Parcel;
    packageDetails: Record<string, string>;
    dimensions: Record<string, string>;
  } | null>(null);

  /** Empty stays undefined rather than becoming 0, so "not filled in" reads as "—", not "free". */
  function setOne(id: string, field: "price" | "ship", raw: string) {
    const v = raw === "" ? undefined : Number(raw);
    setMarket((m) => ({ ...m, [id]: { ...m[id], [field]: v } }));
  }

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

  // The parcel depends on WHAT is in the kit, never on what a line was priced as — correcting a
  // material's price cannot change the size of the box.
  useEffect(() => {
    if (!lines) {
      setParcel(null);
      return;
    }
    void window.ww.parcelFor(lines).then(setParcel);
  }, [lines]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Material[]>();
    for (const m of materials) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  /** Both routes land here, so a pasted reply and a saved file can never behave differently. */
  function took(r: Awaited<ReturnType<typeof window.ww.costPasted>>) {
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setError(null);
    setOverrides({}); // a new reply is a new kit; the last kit's corrections do not apply
    setMarket({}); // and the last kit's prices are certainly not this one's
    setSku(r.result.sku);
    setLines(r.result.lines.map(({ item, qty, size }) => (size ? { item, qty, size } : { item, qty })));
    setKit(r.result);
  }

  const loadReply = async (file: string) => took(await window.ww.costInventory(file, {}));

  /**
   * Pasting reads as you paste — no button. The whole interaction is copy in the chat, click here,
   * Cmd+V, and the table is there; a "Read this" button in between would be one more thing to
   * explain. Empty stays quiet: clearing the box is not an error.
   */
  function pasted(text: string) {
    setPaste(text);
    if (text.trim() === "") {
      setError(null);
      return;
    }
    void window.ww.costPasted(text, {}).then(took);
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
    if (json) {
      setPaste("");
      void loadReply(json);
    }
  }

  async function save() {
    if (!lines) return;
    const kept: SavedKit = {
      sku, image, lines, overrides,
      marginPercent: margin,
      flatPaise: flat * 100,
      marketplaces: Object.fromEntries(
        Object.entries(market).map(([id, v]) => [
          id,
          { pricePaise: v.price === undefined ? undefined : v.price * 100,
            shippingPaise: v.ship === undefined ? undefined : v.ship * 100 },
        ]),
      ),
      savedAt: "",
    };
    const file = await window.ww.saveKit(kept);
    setNote(`Kept as ${file.split(/[\\/]/).pop()}.`);
    setTimeout(() => setNote(null), 4000);
    refreshSaved();
  }

  async function exportAll(only: string | null) {
    const file = await window.ww.exportKits(only);
    if (!file) return; // cancelled, or nothing saved yet — neither is an error
    setNote(`Saved to ${file.split(/[\\/]/).pop()}.`);
    setTimeout(() => setNote(null), 6000);
  }

  async function reopen(file: string) {
    const k = await window.ww.openKit(file);
    setSku(k.sku);
    setImage(k.image);
    setOverrides(k.overrides ?? {});
    setMargin(k.marginPercent ?? 50);
    setFlat(Math.round((k.flatPaise ?? 6000) / 100));
    setMarket(
      Object.fromEntries(
        Object.entries(k.marketplaces ?? {}).map(([id, v]) => [
          id,
          { price: v.pricePaise === undefined ? undefined : v.pricePaise / 100,
            ship: v.shippingPaise === undefined ? undefined : v.shippingPaise / 100 },
        ]),
      ),
    );
    setLines(k.lines);
    setPaste("");
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
          {/* Pasting first, because that is what actually happens: the reply comes back as a
              ```json code block in the chat, and asking for a downloadable file is a step
              ChatGPT does not always offer. The fence and any words around it are fine. */}
          <textarea
            className="inv-paste"
            placeholder="Paste the reply here — copy the whole JSON block out of the chat, fence and all"
            value={paste}
            spellCheck={false}
            onChange={(e) => pasted(e.target.value)}
          />
          <div
            className={`drop small ${over === "json" ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver("json");
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => dropped(e, "json")}
          >
            <strong>…or drop a saved .json here</strong>
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
          {/* Both methods, both answers, no toggle. They disagree by more the bigger the kit
              gets — a flat +₹60 is 100% on a ₹60 kit and 20% on a ₹300 one — and which one is
              right is a judgement nobody can make without seeing the two numbers together. A
              mode switch would hide exactly that. */}
          <div className="inv-prices">
            <div className="inv-method">
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
              <span className="muted">
                keeps {margin}% of the price as margin, so it scales with the kit
              </span>
            </div>
            <div className="inv-method">
              <label className="inline">
                Add ₹
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={flat}
                  onChange={(e) => setFlat(Number(e.target.value))}
                />
              </label>
              <span className="inv-price">{rupees(total + flat * 100)}</span>
              <span className="muted">
                cost + ₹{flat} flat — the partner's rule. That is{" "}
                {total > 0 ? Math.round(((flat * 100) / (total + flat * 100)) * 100) : 0}% of this
                price
              </span>
            </div>
          </div>
          <p className="muted">
            <b>Both are floors, not listing prices.</b> Each is worked out from the cost of
            materials and nothing else — neither knows the marketplace commission, the shipping
            fee, GST or packaging. The real formula goes in here once the sheet that computes it
            has been sent.
          </p>

          {/* Delivery is typed in, not computed, and it has to be: Meesho sets its fee from the
              main image by a rule fourteen tests failed to pin down (SHIPPING-COST.md), and the
              two marketplaces are rarely listed at the same price. The column that earns its
              place is the LAST one — what is actually left — because a kit can look healthy on
              margin and be losing money once delivery is counted. */}
          <h3>Delivery, per marketplace</h3>
          <p className="muted">
            Read the fee off each listing and type it here. The point is the last column: what a
            sale actually leaves you, which is what decides where the ad spend goes.
          </p>
          <table className="rows inv-table">
            <thead>
              <tr>
                <th>Where</th>
                <th>Listed at ₹</th>
                <th>Delivery ₹</th>
                <th>Delivery is</th>
                <th>Left after materials + delivery</th>
              </tr>
            </thead>
            <tbody>
              {MARKETPLACES.map(({ id, label }) => {
                const m = market[id] ?? {};
                const price = (m.price ?? 0) * 100;
                const ship = (m.ship ?? 0) * 100;
                const left = price - total - ship;
                const shipShare = price > 0 ? Math.round((ship / price) * 100) : null;
                const leftShare = price > 0 ? Math.round((left / price) * 100) : null;
                return (
                  <tr key={id}>
                    <td>{label}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={m.price ?? ""}
                        onChange={(e) => setOne(id, "price", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={m.ship ?? ""}
                        onChange={(e) => setOne(id, "ship", e.target.value)}
                      />
                    </td>
                    <td>{shipShare === null ? "—" : `${shipShare}% of the price`}</td>
                    <td className={price > 0 && left <= 0 ? "warnpill" : ""}>
                      {price === 0 ? "—" : `${rupees(left)}  ·  ${leftShare}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">
            <b>"Left" is still not profit.</b> It is the price minus what the materials cost and
            what delivery cost, and nothing else — no marketplace commission, no GST, no
            packaging, no ad spend. Treat it as the ceiling on what this kit can earn, and compare
            kits with it rather than banking it.
          </p>

          {parcel && (
            <>
              <h3>The parcel</h3>
              <p className="muted">
                Worked out from what is in the kit, not typed per listing.
                {parcel.parcel.applied.length > 0 ? (
                  <>
                    {" "}
                    This one is bigger than the standard box because it contains a{" "}
                    <b>{parcel.parcel.applied.join(" and a ")}</b>.
                  </>
                ) : (
                  " Nothing in it needs a bigger box than the standard one."
                )}
              </p>

              <div className="inv-parcel">
                <div>
                  <span className="muted">Size</span>
                  <b>
                    {parcel.parcel.lengthCm} × {parcel.parcel.breadthCm} ×{" "}
                    {parcel.parcel.heightCm} cm
                  </b>
                </div>
                <div>
                  <span className="muted">Real weight</span>
                  <b>{parcel.parcel.grams} g</b>
                </div>
                <div>
                  <span className="muted">Volumetric (L×B×H ÷ 5000)</span>
                  <b>{parcel.parcel.volumetricGrams} g</b>
                </div>
                <div>
                  <span className="muted">Billed on</span>
                  <b className={parcel.parcel.billedGrams > parcel.parcel.grams ? "warnpill" : ""}>
                    {parcel.parcel.billedGrams} g
                  </b>
                </div>
              </div>

              {parcel.parcel.warnings.length > 0 && (
                <div className="problems">
                  <ul>
                    {parcel.parcel.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Two tabs, two unit systems, and the app deliberately fills only one of them.
                  `Height` and `Weight` exist on BOTH, and loadProduct() merges every defaults
                  file into one flat map keyed by label — so one value would be typed as
                  centimetres here and inches there. Package Details is therefore yours to type,
                  with the numbers ready to copy; the bot fills the inch block, where nothing
                  can collide. */}
              <div className="two">
                <div className="card">
                  <b>Price, Stock &amp; Shipping → Package Details</b>
                  <span className="muted">
                    Type these four yourself. The app does not fill this block — the same{" "}
                    <em>Height</em> and <em>Weight</em> labels exist on the other tab in inches,
                    and it cannot yet tell them apart.
                  </span>
                  <ul className="kv">
                    {Object.entries(parcel.packageDetails).map(([k, v]) => (
                      <li key={k}>
                        <b>{k}</b>
                        <span>
                          {v} {k === "Weight" ? "KG" : "CM"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <CopyButton
                    label="Copy all four"
                    text={Object.entries(parcel.packageDetails)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n")}
                  />
                </div>
                <div className="card">
                  <b>Additional Description → Dimensions</b>
                  <span className="muted">
                    In inches, and the bot fills these — nothing to do here. Shown so you can
                    check them against the form.
                  </span>
                  <ul className="kv">
                    {Object.entries(parcel.dimensions).map(([k, v]) => (
                      <li key={k}>
                        <b>{k}</b>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}

          {/* Last thing on the panel, deliberately. It used to sit directly under the two price
              cards — above the delivery table and the parcel — so the fields below it read as
              something other than part of the kit, and filling one after pressing Keep silently
              did nothing. A save button belongs below everything it saves. */}
          <div className="inv-save">
            <button className="primary" onClick={() => void save()}>
              {sku ? `Keep ${sku}` : "Keep this kit"}
            </button>
            {/* The JSON is right to store and wrong to read. This is the same kit as a
                spreadsheet, for anyone who has never opened a .json and should not have to. */}
            <button onClick={() => void exportAll(null)}>Save every kit as a spreadsheet</button>
            <span className="muted">
              Keeping stores the {kit.lines.length} lines as read, any material you corrected, both
              pricing rules, and the prices and delivery costs above. Not the total — that is
              worked out again from today's price list every time you open it, so a price change
              reaches every kit you have ever saved.
            </span>
            {note && <span className="allgood">{note}</span>}
          </div>
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

/**
 * ui.tsx — the pieces every step reuses.
 *
 * The rule this file exists to enforce: **no step ever asks anyone to type an ID or a path.**
 * Typing an ID from memory is how the wrong listing gets picked, which is WW-078; typing a path
 * is what the app was built to remove. Every step picks from a list or from a folder dialog, and
 * every dialog opens where that step was last used.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { Account, FolderKey, Listing, StepId } from "../shared.js";
import { isForAccount } from "../shared.js";

/** The seller account being worked, or null when this machine has never set one up. */
export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    void window.ww.accounts().then((r) => setAccount(r.accounts[r.active] ?? null));
  }, []);
  return account;
}

/**
 * The active account's SKU prefix when this listing does not carry it — null when it does, when
 * the account has no prefix, or when no account is set up. Null means say nothing.
 */
export function useSkuMismatch(id: string | null | undefined): string | null {
  const account = useAccount();
  if (!id || !account?.skuPrefix) return null;
  return isForAccount(id, account.skuPrefix) ? null : account.skuPrefix;
}

/**
 * `ANP003 — this account is GTB`, wherever a listing is named.
 *
 * **It flags and never blocks**, everywhere it appears. The partners are new to this and a file
 * with the wrong prefix is sometimes the prefix that is the typo, so stopping the work would be
 * wrong as often as it was right. It appears in more than one place on purpose: the person who
 * imports a file is often not the person who fills the form an hour later, and a warning that
 * shows once and vanishes is a warning nobody sees (WW-154).
 */
export function SkuFlag({ id }: { id: string | null | undefined }) {
  const prefix = useSkuMismatch(id);
  if (!prefix) return null;
  return <span className="warnpill" title={`This account's SKUs start with ${prefix}`}>not {prefix}</span>;
}

/**
 * Join a folder and a child name. The renderer has no `path` module, and Node accepts a forward
 * slash on Windows — but the partner READS these paths, and `C:\Users\him\Downloads/wishworks-ready`
 * looks like something went wrong. Follow whatever separator the folder already uses.
 */
export const joinPath = (dir: string, name: string) =>
  dir.includes("\\") && !dir.includes("/") ? `${dir}\\${name}` : `${dir}/${name}`;

/**
 * Re-exported so every panel goes on importing it from here, while the rule itself lives in
 * `shared.ts` next to its inverse — see `fileUrl` there for why the two must not be separated.
 */
export { fileUrl } from "../shared.js";

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
                {/* Stays on the row, so a wrongly-imported file is still visibly wrong to
                    whoever picks it up an hour later. */}
                <SkuFlag id={l.id} />
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
 * One of the folders the app writes to, with the two buttons that make it checkable.
 *
 * **Every folder the app saves into is one of these.** A folder nobody chose is a folder nobody
 * can check, which is what WW-153 was: `<workspace>/products` was printed on no screen, so "no
 * file matches" could not be told apart from "it is looking somewhere you have never seen".
 * Unlike `FolderRow` these are stored settings, not per-step memories, so changing one restarts
 * the app — `paths.ts` reads each folder once, at module load.
 *
 * `label` and the dialog's wording come from main.ts, so the screen cannot describe a folder
 * differently from the code that picks it.
 */
export function FolderSetting({ which }: { which: FolderKey }) {
  const [info, setInfo] = useState<{ dir: string; label: string; what: string } | null>(null);
  const [tidied, setTidied] = useState<string | null>(null);
  useEffect(() => void window.ww.folders().then((f) => setInfo(f[which])), [which]);
  if (!info) return null;

  /**
   * Only the ready folder, because it is the only one that is GROUPED. Finishing has filed images
   * under their SKU code since WW-156, but everything finished before that is still lying in the
   * root, and a grouping that covers half the folder is worse than none — you cannot tell whether
   * `GTB/` is all the GTBs or only the recent ones.
   */
  async function tidy() {
    const r = await window.ww.tidyReady();
    setTidied(
      r.moved === 0 && r.clashed.length === 0
        ? "Nothing loose — every file is already in its folder."
        : `Filed ${r.moved} file${r.moved === 1 ? "" : "s"} into ${r.groups.join(", ")}.` +
            (r.clashed.length > 0
              ? ` ${r.clashed.length} left where they are: that name is already taken in its folder (${r.clashed.slice(0, 3).join(", ")}${r.clashed.length > 3 ? "…" : ""}).`
              : ""),
    );
  }

  return (
    <div className="folder-row">
      <div>
        <span className="folder-label">{info.label}</span>
        <span className="path">{info.dir}</span>
        {tidied && <span className="path allgood">{tidied}</span>}
      </div>
      <div className="picks">
        <button onClick={() => void window.ww.showFolder(info.dir)}>Open</button>
        <button onClick={() => void window.ww.chooseFolder(which)}>Choose…</button>
        {which === "ready" && (
          <button
            onClick={() => void tidy()}
            title="Move loose files into GTB/, ANP/ … by the letters their name starts with. Nothing is ever overwritten."
          >
            Sort into groups
          </button>
        )}
      </div>
    </div>
  );
}

/** The Flipkart one by name, because the Fill panel shows it beside the step that reads it. */
export const ProductsFolder = () => <FolderSetting which="products" />;

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


/** A row as this picker needs it — a name, its group, and a price when there is one. */
export interface PickRow {
  category: string;
  material: string;
  paise?: number | null;
}

const key = (m: PickRow) => `${m.category}|${m.material}`;
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;

/**
 * Pick a material by TYPING, not by scrolling 178 rows.
 *
 * **Shared, because Raw stock had a plain `<select>` and it showed.** Vansh, with the tally's
 * dropdown open over half the screen: *"the list opening here is not as good as the cost a kit
 * searching one."* It was the same job — *which row is this?* — answered by two different controls,
 * and only one of them could be searched. Props are structural rather than `Material`, so the
 * tally can pass its own rows without inventing prices it does not have.
 *
 * A `<select>` can only be searched by the first letters of a name, so finding *Silver Confetti
 * Balloon* meant knowing it starts with "Silver" and scrolling past everything else that does.
 * `<input list>` is the same control with substring search, and it is native — no combobox
 * library, no keyboard handling, no popup positioning of our own.
 *
 * **It cannot be left in a half-typed state.** Only a name that IS a row commits; anything else is
 * held as text and thrown away on blur, so the box always goes back to saying what the line is
 * actually costed as. An empty box is the one other real answer — *not on the price list* — and
 * commits as such.
 */
export function MaterialPicker({
  id,
  name,
  flagged,
  choices,
  byCategory,
  onPick,
}: {
  id: string;
  /** The material this line is costed as right now, or "" for none. */
  name: string;
  flagged: boolean;
  /** The near misses the matcher already found, best first. */
  choices: { material: PickRow; score: number }[];
  byCategory: [string, PickRow[]][];
  onPick: (key: string) => void;
}) {
  /** What is being typed, while it is not yet a row. `null` means the box shows `name`. */
  const [typed, setTyped] = useState<string | null>(null);
  const byName = useMemo(
    () => new Map(byCategory.flatMap(([, rows]) => rows.map((m) => [m.material.toLowerCase(), m]))),
    [byCategory],
  );
  // The near misses go first so they are what an unopened list offers; showing them again inside
  // their category would just be the same row twice.
  const ranked = choices.map((c) => c.material.material);

  function commit(text: string) {
    const hit = byName.get(text.trim().toLowerCase());
    if (hit) {
      onPick(key(hit));
      setTyped(null);
      return;
    }
    if (text.trim() === "") {
      onPick("");
      setTyped(null);
      return;
    }
    setTyped(text);
  }

  return (
    <>
      <input
        // Spelt out, not left to default: the app's input styling is `input[type="text"]`, and an
        // attribute selector does not match an attribute that is not there. Without it this box
        // renders as a white browser default in a dark panel.
        type="text"
        className={flagged ? "loose" : ""}
        list={id}
        value={typed ?? name}
        placeholder={name ? "type to search, or pick from the list" : "— not on the price list —"}
        spellCheck={false}
        onChange={(e) => commit(e.target.value)}
        // Clicking in empties the box so the list opens on EVERYTHING. The browser filters a
        // datalist by whatever is already in the field, so a line matched to "Silver Confetti
        // Balloon" would otherwise open a list of exactly that one row — useless for the case this
        // control exists for, which is not remembering what the list holds. Nothing is committed
        // here: blur puts the current match straight back.
        onFocus={() => setTyped("")}
        onBlur={() => setTyped(null)}
      />
      <datalist id={id}>
        {choices.map((c) => (
          <option key={`c-${key(c.material)}`} value={c.material.material}>
            closest · {Math.round(c.score * 100)}%
          </option>
        ))}
        {byCategory.map(([category, rows]) =>
          rows
            .filter((m) => !ranked.includes(m.material))
            .map((m) => (
              <option key={key(m)} value={m.material}>
                {category} · {m.paise === null || m.paise === undefined ? "no price" : rupees(m.paise)}
              </option>
            )),
        )}
      </datalist>
    </>
  );
}

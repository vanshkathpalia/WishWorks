/**
 * main.tsx — the window: the step rail, which panel is showing, and Settings.
 *
 * Rules it follows, all from GUI-SPEC:
 *  - No `node:` anything. Everything the renderer can do comes through `window.ww` (shared.ts).
 *  - **Every step opens at any time and nothing gates anything.** A run that died halfway needs
 *    one step re-run on its own, and most listings skip converting entirely. The numbering is a
 *    map, never a wizard.
 *  - Nothing is hardcoded to a folder on anyone's disk — every picker starts wherever that step
 *    was last used, and at ~/Downloads on a first run.
 */

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Convert } from "./Convert.js";
import { Images } from "./Images.js";
import { Inventory } from "./Inventory.js";
import { Flipkart } from "./Flipkart.js";
import { Check, Finish, ListingCopy, Meesho } from "./steps.js";
import { FolderSetting, useAccount } from "./ui.js";
import type { Account } from "../shared.js";
import "./styles.css";

/**
 * The listing flow, numbered in the order it is usually used — which is not the order it has to
 * be used. Logging in sits outside the numbering on purpose: it is a precondition for the last
 * two steps, not a stage a listing passes through, and it is done once a fortnight.
 *
 * **Each step carries a `does` line, and that is not decoration.** The names alone were written
 * for the person who built the app: "Check" says nothing, and "Convert images" / "Build the
 * images" / "Finish images" are three different jobs that read as one job done three times.
 * Vansh, 2026-08-12: *"the side section bar is pretty weird, some other person won't be able to
 * understand and it is not actually formal also"*. The app's whole reason to exist is that his
 * business partner cannot run `npm run …`, so a rail only its author can read is the same
 * failure in a nicer font. The `does` line is the shortest thing that fixes it — a name says
 * which screen, a verb phrase says what happens there.
 *
 * Each `does` is a compressed version of the panel's own opening paragraph, deliberately: two
 * descriptions of one screen that disagree is how a person stops trusting either.
 */
const STEPS = [
  { name: "Prepare the photos", does: "Any format in, square 1500 px JPEGs out" },
  // Hero and infographic used to be two steps. They are two messages in ONE chat — the
  // infographic reads "from IMAGE 2", already in context — so splitting them invited two chats
  // and the second started blind.
  { name: "Make the pictures", does: "AI prompts for the main photo and infographics" },
  { name: "Write the words", does: "AI prompts for the title, description and form fields" },
  { name: "Name and tag", does: "Renames each image and writes its description inside it" },
  { name: "Check the images", does: "Reads the descriptions back out — nothing else can" },
  { name: "Fill Flipkart", does: "Types the listing into the form in Chrome" },
  { name: "Fill Meesho", does: "Copy each value into the Supplier Panel by hand" },
];

function Panel({ step }: { step: number }) {
  switch (step) {
    case 0:
      return <Convert />;
    case 1:
      return <Images n={2} />;
    case 2:
      return <ListingCopy n={3} />;
    case 3:
      return <Finish n={4} />;
    case 4:
      return <Check n={5} />;
    case 5:
      return <Flipkart n={6} />;
    case 6:
      return <Meesho n={7} />;
    // Costing is deliberately outside the numbering, for the reason login is: it is not a stage a
    // listing passes through. You cost a kit once when you design it, and what comes out is the
    // price that later goes INTO the listing — so numbering it 8 would put it after the step it
    // feeds. `n={0}` renders the heading without a number.
    case 7:
      return <Inventory n={0} />;
    default:
      return null;
  }
}

/**
 * Which seller account this machine works, and how to add another (WW-154).
 *
 * There is no login and no server. An account is a name, a Drive folder and an optional SKU
 * prefix — Google's folder sharing is what keeps one pair's data away from another's, and it is
 * real access control in a way a password box inside this app could never be: the files are on
 * the local disk and Explorer opens them whatever this screen says.
 */
function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState("");
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    void window.ww.accounts().then((r) => {
      setAccounts(r.accounts);
      setActive(r.active);
    });
  }, []);

  return (
    <>
      <h3>Which seller account</h3>
      {accounts.length === 0 ? (
        <p className="muted">
          None set up. Everything is kept in the folder below and nothing is flagged, which is
          exactly how the app worked before — add one only if this machine works a shared account.
        </p>
      ) : (
        <ul className="accounts">
          {accounts.map((a, i) => (
            <li key={a.label + i} className={i === active ? "current" : ""}>
              <div>
                <b>
                  {a.label}
                  {i === active ? " ✓" : ""}
                </b>
                <span className="path">{a.workspace}</span>
                <small>
                  {a.skuPrefix ? `SKUs start ${a.skuPrefix}` : "no prefix — nothing is flagged"}
                </small>
              </div>
              <div className="picks">
                {i !== active && (
                  <button onClick={() => void window.ww.switchAccount(i)}>Work this one</button>
                )}
                <button onClick={() => void window.ww.removeAccount(i)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="picks">
        <input
          type="text"
          className="wide"
          placeholder="Name, e.g. GTB — gtb.wishworks@gmail.com"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          type="text"
          placeholder="Prefix, e.g. GTB"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
        />
        <button disabled={!label.trim()} onClick={() => void window.ww.addAccount(label.trim(), prefix.trim())}>
          Choose its folder and add…
        </button>
      </div>
      <p className="muted">
        Pick a <b>normal folder on this computer — not a Google Drive one</b>. It holds this
        account&apos;s working files: the photos you drop in, the converted ones, and the{" "}
        <code>.json</code> files downloaded from the AI (<code>image-meta/</code>,{" "}
        <code>products/</code>) — unless you move one of them below. None of that is shared,
        because none of it is finished. <b>Only two things are meant to go in a shared Drive
        folder</b>: the <b>ready folder</b> on step 4, and the <b>costed kits</b> below.
      </p>
      <p className="muted">
        The SKU prefix is only a warning: a listing whose ID does not start with it gets marked
        wherever it appears, and <b>nothing is ever blocked</b>, because sometimes it is the SKU
        that was typed wrong. Leave the prefix empty and this account is never flagged at all.
        Switching, adding or removing restarts the app, and no file is moved or deleted.
      </p>
    </>
  );
}

function Settings({ close }: { close: () => void }) {
  const [folders, setFolders] = useState<Record<string, string>>({});
  const [workspace, setWorkspace] = useState("");
  const [editPrompts, setEditPrompts] = useState(false);

  useEffect(() => {
    void window.ww.rememberedFolders().then((f) => setFolders(f as Record<string, string>));
    void window.ww.workspaceDir().then(setWorkspace);
    void window.ww.editPrompts().then(setEditPrompts);
  }, []);

  return (
    <div className="modal" onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <Accounts />

        <h3>Remembered folders</h3>
        {Object.keys(folders).length === 0 ? (
          <p className="muted">Nothing remembered yet. Each step will start in Downloads.</p>
        ) : (
          <ul className="kv">
            {Object.entries(folders).map(([step, dir]) => (
              <li key={step}>
                <b>{step}</b>
                <span>{dir}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => {
            void window.ww.clearFolders().then(() => setFolders({}));
          }}
        >
          Forget them
        </button>
        <p className="muted">
          Forgetting is always safe — the app works the same, it just starts in Downloads again.
        </p>

        <h3>Where each thing is saved</h3>
        <p className="muted">
          Every folder the app writes to, and each can be pointed anywhere — a different disk, a
          shared Drive folder, or straight at Downloads. They all sit inside the workspace below
          unless you move them. <b>Changing any of these restarts the app</b>, and nothing already
          saved is moved, so a wrong choice costs nothing and is undone by choosing again.
        </p>
        <FolderSetting which="images" />
        <FolderSetting which="meta" />
        <FolderSetting which="products" />
        <FolderSetting which="kits" />
        <div className="picks">
          <button onClick={() => void window.ww.openKitsFolder()}>Open the kits folder</button>
        </div>
        <p className="muted">
          <b>Only the kits are safe to put in a shared Drive folder</b> — a few kilobytes of text
          each. The converted images deliberately are not: they are megabytes per listing, and a
          sync service can replace a synced file with a placeholder, which the image steps then
          cannot read. The one folder meant for sharing is the <b>ready folder</b> on step 4,
          where the finished images go.
        </p>

        <h3>Editing the prompts</h3>
        <label className="inline">
          <input
            type="checkbox"
            checked={editPrompts}
            onChange={(e) => {
              setEditPrompts(e.target.checked);
              void window.ww.setEditPrompts(e.target.checked);
            }}
          />
          Let me change the prompt files from inside this app
        </label>
        <p className="muted">
          Off by default, and worth understanding before turning it on. An edit made here is saved{" "}
          <b>on this computer only</b> — it never reaches the project, so it cannot go out in an
          update to anyone else, and from then on this machine ignores every future version of that
          one prompt. To change a prompt <i>for everybody</i>, edit it in the project and release.
        </p>

        <h3>Where files are kept</h3>
        <p className="path">{workspace}</p>
        <div className="picks">
          <button onClick={() => void window.ww.showFolder(workspace)}>Open it</button>
          <button onClick={() => void window.ww.chooseWorkspace()}>Change folder…</button>
        </div>
        <p className="muted">
          Changing this restarts the app. Files already in the old folder stay where they are —
          nothing is moved, so a wrong choice costs nothing.
        </p>

        <button className="close" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState(false);
  /**
   * Whose data this is, on screen at all times — the actual safety feature of WW-154, worth more
   * than every flag put together. It is a standing answer to a question nobody thinks to ask
   * before making the mistake.
   */
  const account = useAccount();
  // Any step, any time. Nothing here checks whether an earlier one has run.
  const [step, setStep] = useState(0);
  /**
   * Every step visited so far. Panels are **hidden, never unmounted** — switching to the prompts
   * and back used to throw away a half-costed kit (the whole table, the corrected counts, the
   * typed prices), because React drops a component's state the moment it stops being rendered.
   * Mounted on first visit rather than all at once: the Flipkart panel starts a 2-second
   * Playwright status poll as soon as it appears, and that should not run from launch.
   */
  const [seen, setSeen] = useState<number[]>([0]);
  useEffect(() => setSeen((s) => (s.includes(step) ? s : [...s, step])), [step]);

  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          WishWorks
          {account && <small title={account.workspace}>{account.label}</small>}
        </div>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.name}>
              <button className={i === step ? "current" : ""} onClick={() => setStep(i)}>
                <span className="num">{i + 1}</span>
                <span className="step-text">
                  <b>{s.name}</b>
                  <small>{s.does}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="rail-foot">
          <button className={step === 7 ? "current" : ""} onClick={() => setStep(7)}>
            Cost a kit
            <small>What a kit costs to make, and what to sell it for</small>
          </button>
          {/* Logging in is not a step of its own — it is the top of the Flipkart screen, where
              the indicator is next to the thing that needs it. This is a shortcut to that. */}
          <button onClick={() => setStep(5)}>Log in to Flipkart</button>
          <button onClick={() => setSettings(true)}>Settings</button>
        </div>
      </nav>

      <main>
        {seen.map((i) => (
          <div key={i} style={i === step ? undefined : { display: "none" }}>
            <Panel step={i} />
          </div>
        ))}
      </main>

      {settings && <Settings close={() => setSettings(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

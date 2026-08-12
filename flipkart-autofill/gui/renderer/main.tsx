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

function Settings({ close }: { close: () => void }) {
  const [folders, setFolders] = useState<Record<string, string>>({});
  const [workspace, setWorkspace] = useState("");
  const [editPrompts, setEditPrompts] = useState(false);
  const [kits, setKits] = useState("");

  useEffect(() => {
    void window.ww.rememberedFolders().then((f) => setFolders(f as Record<string, string>));
    void window.ww.workspaceDir().then(setWorkspace);
    void window.ww.editPrompts().then(setEditPrompts);
    void window.ww.kitsFolder().then(setKits);
  }, []);

  return (
    <div className="modal" onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

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

        <h3>Where the costed kits are kept</h3>
        <p className="path">{kits}</p>
        <div className="picks">
          <button onClick={() => void window.ww.openKitsFolder()}>Open it</button>
          <button onClick={() => void window.ww.chooseKitsFolder()}>Change folder…</button>
        </div>
        <p className="muted">
          Put this in a shared Google Drive or Dropbox folder and both machines see the same
          costings. <b>Only the kits</b> — a few kilobytes of text each. The images deliberately
          stay where they are: they are megabytes per listing, and a sync service can replace a
          synced file with a placeholder, which the image steps then cannot read. Changing this
          restarts the app, and nothing already saved is moved.
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
        <div className="brand">WishWorks</div>
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

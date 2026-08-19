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
import { Orders } from "./Orders.js";
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
  // 7 and 8 are not listing steps and never were — they are the other two tabs. They stay in one
  // array because `step` is a single index into `Panel`, and a second numbering scheme for two
  // entries would be a whole mechanism to save nothing.
  { name: "Cost a kit", does: "What a kit costs to make, and what to sell it for" },
  { name: "Today's orders", does: "Read the manifest, tick off the packing, credit the packer" },
];

/**
 * The tabs across the top, each with its own list of steps down the side.
 *
 * **Orders comes first because it is the daily job.** Listing a new product happens a few times a
 * week; the day's parcels happen every morning, and Vansh asked for it first for that reason.
 *
 * Only the listing flow is NUMBERED. Numbers are a map through a sequence — they earn their place
 * on seven steps that mostly run in order, and they would be noise on a tab holding one screen.
 * The panels print the same numbers in their own headings, so the two must not disagree.
 */
const SECTIONS = [
  // One word each, because three tabs share a 250px rail and "New listing" / "Cost a kit" wrapped
  // onto three lines apiece. The step under each tab carries the longer name and the `does` line.
  { tab: "Orders", steps: [8], numbered: false },
  { tab: "Listing", steps: [0, 1, 2, 3, 4, 5, 6], numbered: true },
  { tab: "Costing", steps: [7], numbered: false },
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
    case 8:
      return <Orders />;
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
/**
 * Does another account keep its working files in this same folder?
 *
 * Vansh, 2026-08-15: *"if 2 accounts login with same computer, that raw data they are going to
 * use is coming from one machine only hence no separation will be made... if they are not
 * pointing to two diff folders you know."* Exactly right, and the app cannot enforce it — a
 * folder is whatever the user picks. So it says so, loudly, wherever an account is listed.
 * Flag, never block: two accounts sharing a folder on purpose, mid-setup, is a real state.
 */
const sharesFolder = (accounts: Account[], i: number) =>
  accounts.some((o, n) => n !== i && o.workspace === accounts[i].workspace);

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
                {sharesFolder(accounts, i) && (
                  <small className="warnpill">
                    another account uses this same folder — they see each other&apos;s data
                  </small>
                )}
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
        <button onClick={() => void window.ww.signOut().then(() => window.location.reload())}>
          Sign out
        </button>
      </div>
      <p className="muted">
        Signing out asks for the username and password again next time. Nothing is deleted and no
        file moves.
      </p>

      <h3>Add another login to this computer</h3>
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
          shared Drive folder, or straight at Downloads. <b>These belong to the account above</b>,
          so another account on this machine keeps its own. <b>Changing any of them restarts the
          app</b>, and nothing already saved is moved, so a wrong choice costs nothing and is
          undone by choosing again.
        </p>
        <FolderSetting which="images" />
        <FolderSetting which="meta" />
        <FolderSetting which="products" />
        <FolderSetting which="kits" />
        <FolderSetting which="ready" />
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

/**
 * The login — a username and a password, and nothing else on the screen.
 *
 * Vansh, 2026-08-19, on the version before this one: *"what the hell is this, too much to read
 * nothing to understand — and also it should be login, username password kinda thing brooo."* He
 * is right twice. It was four paragraphs of Settings prose reused as a launch screen, and it asked
 * for a folder, which is the one question a new person cannot answer. **The workspace is now
 * derived from the username** and moved later in Settings if anyone cares.
 *
 * **What the password honestly does.** It is the door on the app, not on the disk — the files are
 * in a normal folder and Explorer opens them whatever this says. What it buys is the thing that
 * was actually going wrong: two people sharing a computer stop landing in each other's listings,
 * costings and pay records by accident, and the app knows whose day it is recording.
 *
 * Asked when nobody is signed in, and never again until *Sign out* in Settings. Signing in as the
 * account already open does not relaunch; signing in as a different one does, because the folders
 * are read once, at startup.
 */
function Login({ hasAccounts, onDone }: { hasAccounts: boolean; onDone: () => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = hasAccounts
        ? await window.ww.signIn(user, password)
        : await window.ww.signUp(user, password);
      if (r.ok) onDone();
      else setError(r.message);
    } catch (e) {
      // An IPC call can reject outright — an older app half-updated, a handler that is not there.
      // Whatever it is, the one thing this screen must never do is keep spinning: a button stuck
      // on "…" reads as a frozen app, and there is nothing else on screen to try instead.
      setError(e instanceof Error ? e.message : "That did not work. Close the app and open it again.");
    }
    setBusy(false);
  }

  return (
    <div className="modal">
      <form
        className="sheet login"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void go();
        }}
      >
        <h2>{hasAccounts ? "Sign in" : "Create your login"}</h2>
        <input
          type="text"
          placeholder="Username"
          autoFocus
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !user.trim() || !password}>
          {busy ? "…" : hasAccounts ? "Sign in" : "Create"}
        </button>
        <p className="muted">
          {hasAccounts
            ? "Your work stays yours — listings, costings and packing are kept per login."
            : "Your own listings, costings and packing. Your partner makes their own."}
        </p>
      </form>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState(false);
  /**
   * Null until the accounts have been read. The gate must not flash up and vanish on a machine
   * with one account, so nothing is decided until the answer is actually in.
   */
  const [gate, setGate] = useState<{ accounts: Account[]; active: number; chosen: boolean } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => void window.ww.accounts().then(setGate), []);
  /**
   * Whose data this is, on screen at all times — the actual safety feature of WW-154, worth more
   * than every flag put together. It is a standing answer to a question nobody thinks to ask
   * before making the mistake.
   */
  const account = useAccount();
  // Any step, any time. Nothing here checks whether an earlier one has run.
  const [step, setStep] = useState(SECTIONS[0].steps[0]);
  const section = SECTIONS.find((s) => s.steps.includes(step)) ?? SECTIONS[0];
  /**
   * Every step visited so far. Panels are **hidden, never unmounted** — switching to the prompts
   * and back used to throw away a half-costed kit (the whole table, the corrected counts, the
   * typed prices), because React drops a component's state the moment it stops being rendered.
   * Mounted on first visit rather than all at once: the Flipkart panel starts a 2-second
   * Playwright status poll as soon as it appears, and that should not run from launch.
   */
  const [seen, setSeen] = useState<number[]>([SECTIONS[0].steps[0]]);
  useEffect(() => setSeen((s) => (s.includes(step) ? s : [...s, step])), [step]);

  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          WishWorks
          {account && <small title={account.workspace}>{account.label}</small>}
        </div>
        <div className="tabs">
          {SECTIONS.map((s) => (
            <button
              key={s.tab}
              className={s === section ? "current" : ""}
              /* Switching tabs lands on that section's first step — and on the step you left it
                 on would be worse, not better: half these tabs are one screen, and a tab that
                 remembers is a tab whose button does something different each time. */
              onClick={() => setStep(s.steps[0])}
            >
              {s.tab}
            </button>
          ))}
        </div>
        <ol>
          {section.steps.map((i, n) => (
            <li key={STEPS[i].name}>
              <button className={i === step ? "current" : ""} onClick={() => setStep(i)}>
                {section.numbered && <span className="num">{n + 1}</span>}
                <span className="step-text">
                  <b>{STEPS[i].name}</b>
                  <small>{STEPS[i].does}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="rail-foot">
          {/* Logging in is not a step of its own — it is the top of the Flipkart screen, where
              the indicator is next to the thing that needs it. This is a shortcut to that, and it
              crosses tabs, which is the whole reason it is down here and not in the list. */}
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

      {/* An empty list counts as signed out however `activeAccount` reads: removing the last
          account leaves the index behind, and a machine with no login is not set up. */}
      {gate !== null && (!gate.chosen || gate.accounts.length === 0) && !confirmed && (
        <Login hasAccounts={gate.accounts.length > 0} onDone={() => setConfirmed(true)} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

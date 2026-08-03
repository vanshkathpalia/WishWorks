/**
 * Flipkart.tsx — step 6: fill the live Flipkart listing form.
 *
 * The one screen where a mistake costs money, so three rules are visible in the layout itself:
 *
 *  1. **Logged out and not-navigated-yet are different states.** Confusing them is WW-061, where
 *     Chrome came up with no session in a way indistinguishable from being signed out and the
 *     wrong diagnosis cost a day. Three lights, never two.
 *  2. **The read-back is a table, not reprinted terminal text.** ✅/⚠️/⏭️/❌ is a rendering of a
 *     status field; the wanted and actual values sit side by side, which is the whole reason the
 *     engine returns structure.
 *  3. **Nothing saves while a field reads ⚠️.** The button is disabled *and* the engine refuses,
 *     because a guard that only exists in a screen is one refactor from being gone.
 *
 * Chrome is never closed automatically. Closing it before Save throws away every filled field.
 */

import React, { useEffect, useState } from "react";
import type { FieldRow, FillResult, Listing, SessionStatus } from "../shared.js";
import { ListingPicker } from "./ui.js";

const MARK: Record<FieldRow["status"], string> = {
  filled: "✅",
  not_found: "⏭️",
  mismatch: "⚠️",
  failed: "❌",
};

const MEANS: Record<FieldRow["status"], string> = {
  filled: "typed and read back the same",
  not_found: "belongs to another tab",
  mismatch: "the form shows something else",
  failed: "could not be filled",
};

/**
 * The login state, sized to how much it matters right now.
 *
 * Logging in is a once-ever thing: the session is saved and reused, so a big LOG IN panel on
 * every visit is a permanent reminder of a solved problem. Once it reads "logged in" this
 * collapses to a single quiet line. It only grows back when something is actually wrong.
 */
function Light({ status, onOpen, busy }: { status: SessionStatus; onOpen: () => void; busy: boolean }) {
  if (status.open && status.login === "yes") {
    return (
      <div className="light-strip">
        <span className="dot" />
        <b>Logged in</b>
        <span className="path">{status.url}</span>
      </div>
    );
  }

  if (!status.open) {
    return (
      <div className="light off">
        <b>Chrome is not open</b>
        <span>
          Press Open. If you have signed in before, it goes straight to your dashboard — the login
          is saved and reused, you should not have to do it twice.
        </span>
        <div className="picks">
          <button className="primary" disabled={busy} onClick={onOpen}>
            {busy ? "Opening…" : "Open Chrome"}
          </button>
        </div>
      </div>
    );
  }

  if (status.login === "no") {
    return (
      <div className="light no">
        <b>Not logged in</b>
        <span>
          Sign in in the Chrome window that just opened — click Login, enter your details and the
          OTP. It is remembered afterwards; this screen will notice on its own.
        </span>
      </div>
    );
  }

  return (
    <div className="light unknown">
      <b>Can't tell yet</b>
      <span>
        Chrome is open but has not loaded Flipkart yet. This is <b>not</b> the same as being logged
        out — give it a moment, or press Open again.
      </span>
    </div>
  );
}

/**
 * Pages worth coming back to.
 *
 * There is no hardcoded list of Flipkart routes here on purpose. The seller panel is a
 * hash-routed SPA and nobody has verified what any given route resolves to; a guessed link that
 * silently lands on the dashboard is worse than no link, because it looks like it worked. So you
 * navigate to a page once — My Listings, a category's Add Listing form, anything — and press
 * Remember. It works for pages this code has never heard of.
 */
function Shortcuts({ open, onGo }: { open: boolean; onGo: (url: string) => void }) {
  const [items, setItems] = useState<{ name: string; url: string }[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    void window.ww.shortcuts().then(setItems);
  }, []);

  async function remember() {
    const n = name.trim();
    if (!n) return;
    const saved = await window.ww.rememberPage(n);
    if (!saved) return;
    setName("");
    setItems(await window.ww.shortcuts());
  }

  return (
    <div className="shortcuts">
      {items.length > 0 && (
        <div className="picks">
          {items.map((s) => (
            <span key={s.name} className="chip">
              <button onClick={() => onGo(s.url)} title={s.url}>
                {s.name}
              </button>
              <button
                className="x"
                title="forget this page"
                onClick={() => void window.ww.forgetPage(s.name).then(setItems)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="picks">
        <input
          type="text"
          placeholder="name this page — e.g. My Listings"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void remember()}
        />
        <button disabled={!open || !name.trim()} onClick={() => void remember()}>
          Remember the page Chrome is on
        </button>
      </div>
      <p className="muted">
        Go to any page in Chrome — My Listings, a category's Add Listing form, a listing you want
        to copy — then name it here. It becomes a one-click button and Chrome opens straight there
        next time.
      </p>
    </div>
  );
}

/**
 * Flipkart's listing form, as the first real scan found it (WW-111, 2026-08-03):
 * 17 + 7 + 66 = 90 fields, which is the whole form.
 *
 * The counts are here as orientation, not as a contract — nothing branches on them, and the
 * engine still fills whatever rows are actually on screen. They exist because "Product
 * Description" being only SEVEN fields is genuinely surprising, and a person who does not know
 * that cannot tell a finished tab from a broken one.
 */
const FORM_TABS = [
  {
    name: "Price, Stock and Shipping",
    count: 17,
    holds: "SKU, MRP, your price, stock, dimensions, HSN, tax",
  },
  {
    name: "Product Description",
    count: 7,
    holds: "country of origin, manufacturer, packer, model name, EAN, pack of",
  },
  {
    name: "Additional Description",
    count: 66,
    holds: "everything else — material, theme, occasion, description, keywords, warranty",
  },
] as const;

export function Flipkart({ n }: { n: number }) {
  const [status, setStatus] = useState<SessionStatus>({ open: false, login: "unknown", url: "" });
  const [listing, setListing] = useState<Listing | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [result, setResult] = useState<FillResult | null>(null);
  const [busy, setBusy] = useState<null | "opening" | "filling" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** Which tab's button is running, and which have been run — so three passes are trackable. */
  const [filling, setFilling] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => window.ww.onField((row) => setRows((r) => [...r, row])), []);

  // Poll rather than navigate — asking the page where it is cannot interrupt an OTP being typed,
  // and the whole point of the indicator is that it updates while you are logging in.
  useEffect(() => {
    const t = setInterval(() => void window.ww.chromeStatus().then(setStatus), 2000);
    return () => clearInterval(t);
  }, []);

  async function open(url?: string) {
    setBusy("opening");
    setError(null);
    const r = await window.ww.openChrome(url);
    if (r.ok) setStatus(r.result);
    else setError(r.message);
    setBusy(null);
  }

  /**
   * `tab` is a label for the person, not an instruction to the engine — `fillListing` fills
   * whatever rows Chrome is actually showing. Passing the wrong one cannot fill the wrong tab;
   * the worst case is a tick next to the wrong name, which the next run corrects.
   */
  async function fill(tab: string) {
    if (!listing) return;
    setBusy("filling");
    setFilling(tab);
    setRows([]);
    setResult(null);
    setError(null);
    setSaved(null);
    const r = await window.ww.fillListing(listing.id);
    if (r.ok) {
      setResult(r.result);
      setDone((d) => (d.includes(tab) ? d : [...d, tab]));
    } else setError(r.message);
    setBusy(null);
    setFilling(null);
  }

  async function save() {
    setBusy("saving");
    setError(null);
    const r = await window.ww.saveListing();
    if (r.ok) {
      setSaved(
        r.result.clicked
          ? `Clicked "${r.result.clicked}". Look at Chrome for the result — a red "Could not save your changes" is Flipkart's server, not one of our fields.`
          : `Couldn't find the Save button${r.result.candidates.length ? ` (buttons here: ${r.result.candidates.join(" | ")})` : ""}. Click Save in Chrome yourself.`,
      );
    } else setError(r.message);
    setBusy(null);
  }

  const blocked = result ? result.needsEyes : 0;

  return (
    <section className="panel">
      <header>
        <h1>{n}. Fill Flipkart</h1>
        <p>
          Types this listing's values into the form you have open in Chrome, then reads every field
          back out. It saves only when all of them agree.
        </p>
      </header>

      <Light status={status} busy={busy === "opening"} onOpen={() => void open()} />

      <h3>Go straight to a page</h3>
      <Shortcuts open={status.open} onGo={(url) => void open(url)} />
      {status.open && (
        <div className="picks">
          <button disabled={busy !== null} onClick={() => void open()}>
            Dashboard
          </button>
          <button disabled={busy !== null} onClick={() => void window.ww.closeChrome()}>
            Close Chrome
          </button>
        </div>
      )}

      <h3>Which listing</h3>
      <ListingPicker
        value={listing?.id ?? null}
        onChange={(_id, l) => setListing(l)}
        need={(l) => (!l.product ? "no Flipkart file" : null)}
      />

      <h3>One tab at a time</h3>
      <p className="muted">
        The form is three tabs and Chrome only shows one at a time, so this runs three times — the
        same listing file each time, a different set of fields each time. Do them in any order;
        anything belonging to another tab is reported <b>⏭️ other tab</b>, not as a failure.
      </p>
      <ol className="steps-list">
        <li>In Chrome: <b>Listings → Add New Listing</b>, then pick the category.</li>
        <li>Open one of the three tabs below and scroll it to the bottom once, so every field
          exists on the page.</li>
        <li>Leave that tab showing, then press its button here.</li>
      </ol>

      <div className="tabcards">
        {FORM_TABS.map((t) => (
          <div className="tabcard" key={t.name}>
            <b>{t.name}</b>
            <span>{t.count} fields</span>
            <small>{t.holds}</small>
            <button
              className="primary"
              disabled={!listing || !status.open || busy !== null}
              onClick={() => void fill(t.name)}
            >
              {busy === "filling" && filling === t.name ? `Filling… ${rows.length}` : "Fill this tab"}
            </button>
            {done.includes(t.name) && <em>✓ run</em>}
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {/* The distinction a "not found" count cannot make on its own: a field on ANOTHER tab
          lands on the next pass, a field the form does not have ANYWHERE never lands at all and
          silently sends nothing. Only the scan can tell them apart, so this is silent until the
          category has been scanned rather than accusing fields it cannot check. */}
      {result && result.unmapped.length > 0 && (
        <p className="error">
          ⚠️ {result.unmapped.length} value{result.unmapped.length > 1 ? "s" : ""} in this listing
          match no field on any tab of the form, so {result.unmapped.length > 1 ? "they" : "it"}{" "}
          will never be filled: <b>{result.unmapped.join(", ")}</b>. Fix the label in{" "}
          <code>categories/</code> or the product file — re-running will not help.
        </p>
      )}

      {rows.length > 0 && (
        <table className="rows">
          <thead>
            <tr>
              <th></th>
              <th>Field</th>
              <th>What we typed</th>
              <th>What the form shows</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.status === "mismatch" || r.status === "failed" ? "warn" : ""}>
                <td title={MEANS[r.status]}>{MARK[r.status]}</td>
                <td>{r.label}</td>
                <td>{r.want}</td>
                <td>{r.status === "mismatch" ? r.actual : MEANS[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result && (
        <>
          <div className="tally">
            <span>✅ {result.report.filled.length} filled</span>
            <span>⏭️ {result.report.notFound.length} other tab</span>
            <span className={result.report.mismatch.length ? "bad" : ""}>
              ⚠️ {result.report.mismatch.length} need a look
            </span>
            <span className={result.report.failed.length ? "bad" : ""}>
              ❌ {result.report.failed.length} failed
            </span>
          </div>

          {result.probes.length > 0 && (
            <div className="problems">
              <h3>Why those need a look</h3>
              <ul>
                {result.probes.map((p) => (
                  <li key={p.label}>
                    <b>{p.label}</b> — widget &lt;{p.tag}&gt; kind={p.kind}, row labelled{" "}
                    {JSON.stringify(p.rowLabel)}
                    {p.wrongRow && <b> — WRONG ROW, this typed into a different field</b>}, value{" "}
                    {JSON.stringify(p.value)}
                    {p.pills.length > 0 && <> , pills: {p.pills.join(" | ")}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocked > 0 ? (
            <p className="problems">
              <b>Not saving.</b> {blocked} field{blocked === 1 ? "" : "s"} did not read back the way
              {blocked === 1 ? " it was" : " they were"} typed. Look at{" "}
              {blocked === 1 ? "it" : "them"} in Chrome; if they are actually fine, click Save
              there yourself. Nothing here will do it for you while this says ⚠️.
            </p>
          ) : (
            <div className="picks">
              <button className="primary" disabled={busy !== null} onClick={() => void save()}>
                {busy === "saving" ? "Saving…" : "Save the listing"}
              </button>
              <span className="muted">Everything typed was read back and matched.</span>
            </div>
          )}

          {saved && <p className="allgood">{saved}</p>}

          <p className="danger">
            Nothing is saved until you click Save. Closing Chrome now throws away all{" "}
            {result.report.filled.length} filled fields — closing the window ends the session, it
            does not save the listing.
          </p>
        </>
      )}
    </section>
  );
}

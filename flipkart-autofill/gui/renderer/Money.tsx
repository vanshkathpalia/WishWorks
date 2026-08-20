/**
 * Money.tsx — what the packing was worth, what it owes the packers, and what came back.
 *
 * Three screens off one idea: the parcel ledger says what went out and when, the costed kits say
 * what each SKU earns and costs, and multiplying them is the day's money. **Nothing is stored
 * twice.** Vansh asked for a separate expenses file; there is deliberately none, because the
 * materials cost already lives in the kit and the revenue already lives in that kit's marketplace
 * figures. A second copy is a second answer, and this repo has been bitten by that twice already
 * (C-049, C-061) — both times the copy was the one that was wrong.
 *
 * **A SKU with no costed kit is reported, never counted as free.** It is the same rule the costing
 * panel follows for a material with no price: an unknown must look like an unknown, or the profit
 * flatters itself on exactly the days the un-costed SKUs sell well.
 */

import React, { useCallback, useEffect, useState } from "react";
import type { Money as MoneyTotals, PackerPay, SubOrder } from "../shared.js";

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** `2026-08-20` → `20 Aug`. */
const showDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Today, this week, this month — the three windows anybody actually asks about.
 *
 * The week starts on Monday because that is how a working week is counted here, and "this month"
 * is the calendar month the wages are paid for.
 */
export function useRange() {
  const [which, setWhich] = useState<"today" | "week" | "month">("today");
  const now = new Date();
  const from = new Date(now);
  if (which === "week") from.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  if (which === "month") from.setDate(1);
  return { which, setWhich, from: iso(from), to: iso(now) };
}

/** The three-way switch, shared by the money screen and the pay screen. */
function RangePick({ which, setWhich }: ReturnType<typeof useRange>) {
  return (
    <div className="picks">
      {(["today", "week", "month"] as const).map((r) => (
        <button key={r} className={r === which ? "chosen" : ""} onClick={() => setWhich(r)}>
          {r === "today" ? "Today" : r === "week" ? "This week" : "This month"}
        </button>
      ))}
    </div>
  );
}

export function Money({ n }: { n: number }) {
  const range = useRange();
  const [totals, setTotals] = useState<MoneyTotals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTotals(null);
    void window.ww
      .money(range.from, range.to)
      .then((r) => setTotals(r.money), (e: Error) => setError(e.message));
  }, [range.from, range.to]);

  return (
    <section className="panel orders">
      <header>
        <h1>{n === 0 ? "Money" : `${n}. Money`}</h1>
        <p>
          What the packing was worth. Revenue and materials come from the costed kits, so this is
          the same arithmetic the <b>Costing</b> tab shows — a price corrected there moves this the
          same day. Anything packed whose SKU has no costed kit is listed at the bottom and left
          out of the totals, because an unknown must not read as free.
        </p>
      </header>

      <RangePick {...range} />
      {error && <p className="error">{error}</p>}

      {totals === null ? (
        <p className="muted">{error ? "" : "Working it out…"}</p>
      ) : (
        <>
          <div className="money-tiles">
            <div>
              <b>{totals.packets}</b>
              <span>packets packed</span>
            </div>
            <div>
              <b>{rupees(totals.revenuePaise)}</b>
              <span>came in</span>
            </div>
            <div>
              <b>{rupees(totals.materialsPaise)}</b>
              <span>of materials used</span>
            </div>
            <div className={totals.profitPaise < 0 ? "bad" : "good"}>
              <b>{rupees(totals.profitPaise)}</b>
              <span>left after materials</span>
            </div>
          </div>

          {totals.reversals.packets > 0 && (
            <p className="warnpill block">
              {totals.reversals.packets} came back in this period ({totals.reversals.rto} RTO,{" "}
              {totals.reversals.returned} returned) — {rupees(totals.reversals.revenuePaise)} taken
              back off, and {rupees(totals.reversals.materialsPaise)} of materials with them.
              <small>
                They are counted on the day they came back, not on the day they were packed: a
                figure reported on Tuesday has to still be that figure on Friday.
              </small>
            </p>
          )}

          {totals.byMarket.length > 1 && (
            <p className="muted">
              {totals.byMarket.map((m) => `${m.qty} on ${m.name}`).join(" · ")}
            </p>
          )}

          {totals.uncosted.length > 0 && (
            <div className="uncosted">
              <h3>
                Not costed
                <small>
                  packed, but no costed kit matches the SKU — so these are in the packet count and
                  in neither money column
                </small>
              </h3>
              <ul>
                {totals.uncosted.map((u) => (
                  <li key={u.name}>
                    <span className="lid">{u.name}</span>
                    <span className="qty">{u.qty}</span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                Cost the kit under <b>Costing</b> and name it with this SKU&apos;s code — a combo
                like <code>WKU001-ANP001</code> answers to both of its codes.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * What the packers are owed.
 *
 * The rate is per packet and per person, kept beside the days it is paid on rather than in
 * settings — it is a pay record, and pay records must survive a reinstall and follow the folder
 * onto a synced drive.
 */
export function Packers({ n }: { n: number }) {
  const range = useRange();
  const [pay, setPay] = useState<PackerPay[] | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.ww
      .money(range.from, range.to)
      .then((r) => setPay(r.pay), (e: Error) => setError(e.message));
  }, [range.from, range.to]);

  useEffect(load, [load]);
  useEffect(() => void window.ww.rates().then(setRates, () => setRates({})), []);

  const total = (pay ?? []).reduce((n2, p) => n2 + p.paise, 0);

  return (
    <section className="panel orders">
      <header>
        <h1>{n === 0 ? "Packer pay" : `${n}. Packer pay`}</h1>
        <p>
          Packets each, and what that comes to. A packet shared between two people is half each —
          fractions are kept rather than rounded, because rounding every row loses packets over a
          month. Set a rate per packet and the amount works itself out.
        </p>
      </header>

      <RangePick {...range} />
      {error && <p className="error">{error}</p>}

      {pay === null ? (
        <p className="muted">{error ? "" : "Working it out…"}</p>
      ) : pay.length === 0 ? (
        <p className="muted">
          Nothing packed in this period with a name on it. Ticking a SKU records the packing; the
          names can be added afterwards, from <b>Pack today</b>.
        </p>
      ) : (
        <table className="rows inv-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Packets</th>
              <th>Rate each ₹</th>
              <th>Comes to</th>
            </tr>
          </thead>
          <tbody>
            {pay.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.packets}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    placeholder="0"
                    defaultValue={rates[p.name] ? rates[p.name] / 100 : ""}
                    onBlur={(e) => {
                      const paise = Math.round(Number(e.target.value || 0) * 100);
                      if (paise === (rates[p.name] ?? 0)) return;
                      void window.ww.setRate(p.name, paise).then((r) => {
                        setRates(r);
                        load();
                      });
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                </td>
                <td>{p.paise > 0 ? rupees(p.paise) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <b>Total for this period</b>
              </td>
              <td>
                <b>{rupees(total)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

/**
 * What came back — RTO and returns.
 *
 * **RTO and a return are different money and are kept apart**: an RTO parcel was never delivered
 * and usually comes back sellable; a returned one was delivered, and often does not. Both are
 * dated to the day they came back, never to the day they were packed, so a figure already
 * reported never changes underneath anybody.
 *
 * Marking is by hand for now, from the parcels already packed. Both marketplaces publish their own
 * RTO and returns reports and both carry the sub-order number, which is the same id this list is
 * keyed on — so reading those files will drive exactly this, with nothing here to change.
 */
export function Returns({ n }: { n: number }) {
  const [sent, setSent] = useState<SubOrder[] | null>(null);
  const [find, setFind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = iso(new Date());

  const load = useCallback(() => {
    void window.ww.sent().then(setSent, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  /**
   * By default this shows only what is ALREADY marked — usually a handful — not every parcel ever
   * packed. Forty-two rows of buttons was the first version and it read as a wall to hunt through;
   * the report drop above is how a parcel normally gets marked, and searching is how a one-off
   * does. Vansh: *"RTO and return happens days after packing, where will I find it in this big
   * mess?"*
   */
  const shown = (sent ?? []).filter((p) =>
    find.trim() === ""
      ? p.status !== undefined
      : p.sku.toLowerCase().includes(find.toLowerCase()) ||
        p.subOrder.includes(find.trim()) ||
        p.awb.includes(find.trim()),
  );

  async function mark(p: SubOrder, status: "rto" | "returned" | null) {
    await window.ww.returned(p.subOrder, status, today);
    load();
  }

  /** Drop the marketplace's own report in — the parcels in it mark themselves. */
  async function report(files: string[], status: "rto" | "returned") {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setNote(null);
    for (const file of files) {
      try {
        const r = await window.ww.readReport(file, status);
        if (!r.ok) setError(r.message);
        else {
          setNote(
            `Marked ${r.result.marked} ${status === "rto" ? "RTO" : "returned"} — ${r.result.skus.join(", ")}.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    setBusy(false);
  }

  const dropReport = (status: "rto" | "returned", title: string, hint: string) => (
    <div
      className="drop small"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const paths = [...e.dataTransfer.files].map((f) => window.ww.pathForFile(f)).filter(Boolean);
        void report(paths, status);
      }}
    >
      <strong>{busy ? "Reading…" : title}</strong>
      <small>{hint}</small>
      <div className="picks">
        <button onClick={() => void window.ww.pick("orders", "files").then((f) => report(f, status))}>
          Choose the file…
        </button>
      </div>
    </div>
  );

  return (
    <section className="panel orders">
      <header>
        <h1>{n === 0 ? "Came back" : `${n}. Came back`}</h1>
        <p>
          Mark a parcel <b>RTO</b> (never delivered, on its way back) or <b>returned</b> (delivered,
          then sent back). It is counted on the day you mark it, not on the day it was packed — so
          last week&apos;s figures stay what they were, which is the only way anything reconciles
          against a settlement statement.
        </p>
      </header>

      <div className="report-drops">
        {dropReport("rto", "Drop the RTO report", "Meesho: Returns → RTO. Flipkart: Returns → RTO report.")}
        {dropReport("returned", "Drop the returns report", "Meesho: Returns → Customer returns. Flipkart: Returns report.")}
      </div>
      <p className="muted">
        Any format they give you — CSV, Excel or PDF. Nothing here reads their columns: it looks
        for <b>our</b> order numbers and AWBs inside the file, so a report whose layout changes
        still works, and one about somebody else&apos;s parcels matches nothing. Marking is dated
        today, which is when the parcel actually came back.
      </p>
      {note && <p className="allgood">{note}</p>}
      {error && <p className="error">{error}</p>}

      <h3>Or mark one by hand</h3>
      <input
        type="text"
        className="wide"
        placeholder="Find by SKU, order number or AWB…"
        value={find}
        onChange={(e) => setFind(e.target.value)}
      />

      {sent === null ? (
        <p className="muted">Looking…</p>
      ) : shown.length === 0 ? (
        <p className="muted">
          {sent.length === 0
            ? "Nothing has been packed yet."
            : find.trim() === ""
              ? "Nothing has come back yet. Drop a report above, or search for one parcel."
              : "Nothing matches that."}
        </p>
      ) : (
        <table className="rows inv-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Packed</th>
              <th>Courier</th>
              <th>Order no.</th>
              <th>What happened</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((p) => (
              <tr key={p.subOrder} className={p.status ? "warn" : ""}>
                <td>{p.sku}</td>
                <td>{p.packedOn ? showDate(p.packedOn) : "—"}</td>
                <td>{p.courier}</td>
                <td className="path">{p.subOrder}</td>
                <td>
                  <div className="picks">
                    <button
                      className={p.status === "rto" ? "chosen" : ""}
                      onClick={() => void mark(p, p.status === "rto" ? null : "rto")}
                    >
                      RTO
                    </button>
                    <button
                      className={p.status === "returned" ? "chosen" : ""}
                      onClick={() => void mark(p, p.status === "returned" ? null : "returned")}
                    >
                      Returned
                    </button>
                    {p.status && <span className="muted">on {showDate(p.statusOn!)}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown.length > 200 && (
        <p className="muted">Showing the 200 most recent — search to narrow it down.</p>
      )}
    </section>
  );
}

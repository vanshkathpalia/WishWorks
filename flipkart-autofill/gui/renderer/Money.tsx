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
import type { AdSpend, BackRate, HowItSells, Money as MoneyTotals, PackerPay, SubOrder } from "../shared.js";

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** `meesho` → `Meesho`. The market id is stored lower-case; nobody writes it that way. */
const shopName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** `2026-08-20` → `20 Aug`. */
const showDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Today, this week, this month — **or any two dates you name**.
 *
 * The week starts on Monday because that is how a working week is counted here, and "this month"
 * is the calendar month the wages are paid for.
 *
 * The named range exists because the three rolling windows can only ever answer *now*, and Vansh
 * 2026-08-31: *"ten to fifteenth August… we should have it, why not."* A figure you cannot go back
 * and look at again is a figure nobody checks. Both boxes default to today, so a single day is
 * just the case where they agree — one control, not two.
 */
export function useRange() {
  const [which, setWhich] = useState<"today" | "week" | "month" | "dates">("today");
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date()));
  const now = new Date();
  const start = new Date(now);
  if (which === "week") start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  if (which === "month") start.setDate(1);
  return {
    which,
    setWhich,
    from: which === "dates" ? from : iso(start),
    // Backwards dates would silently return nothing, which reads as "we sold nothing that week".
    // Whichever way round they are typed, the earlier one is the start.
    to: which === "dates" ? (to < from ? from : to) : iso(now),
    setFrom,
    setTo,
    typedFrom: from,
    typedTo: to,
  };
}

/**
 * All · Meesho · Flipkart.
 *
 * **There is no settlement to reconcile between the two**, which is the question this looks like
 * it raises: a costed kit stores what each marketplace pays *separately*, so a parcel is always
 * priced by the one that sold it, and every parcel records which that was. This switch is for
 * reading one of them alone — the per-SKU table below shows both side by side without it.
 */
export function MarketPick({
  market,
  setMarket,
}: {
  market: string | undefined;
  setMarket: (m: string | undefined) => void;
}) {
  const options: [string | undefined, string][] = [
    [undefined, "Both"],
    ["meesho", "Meesho"],
    ["flipkart", "Flipkart"],
  ];
  return (
    <div className="picks">
      {options.map(([id, label]) => (
        <button key={label} className={id === market ? "chosen" : ""} onClick={() => setMarket(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The window switch, shared by the money screen and the pay screen. */
function RangePick({ which, setWhich, typedFrom, typedTo, setFrom, setTo }: ReturnType<typeof useRange>) {
  const today = iso(new Date());
  return (
    <div className="picks">
      {(["today", "week", "month", "dates"] as const).map((r) => (
        <button key={r} className={r === which ? "chosen" : ""} onClick={() => setWhich(r)}>
          {r === "today" ? "Today" : r === "week" ? "This week" : r === "month" ? "This month" : "Pick the dates…"}
        </button>
      ))}
      {/* Only when that window is chosen: date boxes sitting there unused read as a filter already
          applied to everything beside them. Both days are INCLUDED — 10 to 15 is six days. */}
      {which === "dates" && (
        <span className="date-range">
          <input type="date" value={typedFrom} max={today} onChange={(e) => setFrom(e.target.value || today)} />
          to
          <input type="date" value={typedTo} max={today} onChange={(e) => setTo(e.target.value || today)} />
        </span>
      )}
    </div>
  );
}

/**
 * Ads and boost, typed in by the day.
 *
 * **Everything else on this screen is derived; this is the one thing that is entered.** That is
 * not the second-expenses-file mistake this repo has made twice — materials and revenue are
 * already answered by the costed kit, but nothing anywhere knows what a marketplace charged to
 * promote a listing. It is on their Ads dashboard and nowhere we can read.
 *
 * By the day, because the windows above are today / this week / this month and a monthly lump
 * would make two of them wrong. Both marketplaces have this — Meesho calls it Ads &amp; boost,
 * Flipkart calls it PLA under Advertising — so both get a box, and one left empty simply means
 * nothing was spent there.
 */
function Ads({ today, onSaved }: { today: string; onSaved: () => void }) {
  const [day, setDay] = useState(today);
  const [ads, setAds] = useState<AdSpend>({});

  useEffect(() => void window.ww.ads().then(setAds, () => setAds({})), []);

  const save = (market: string, typed: string) => {
    const paise = Math.round(Number(typed || 0) * 100);
    if (paise === (ads[day]?.[market] ?? 0)) return;
    void window.ww.setAds(day, market, paise).then((a) => {
      setAds(a);
      onSaved();
    });
  };

  return (
    <div className="ads-strip">
      <label>
        Ads &amp; boost on
        <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
      </label>
      {["meesho", "flipkart"].map((market) => (
        <label key={market}>
          {market === "meesho" ? "Meesho ₹" : "Flipkart ₹"}
          {/* Keyed by the day, so changing the date reloads the boxes rather than leaving the
              previous day's figures sitting there looking like this day's. */}
          <input
            key={`${market}-${day}`}
            type="number"
            min={0}
            step="1"
            placeholder="0"
            defaultValue={ads[day]?.[market] ? (ads[day][market] / 100).toString() : ""}
            onBlur={(e) => save(market, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
      ))}
      <small className="muted">
        Read it off the marketplace&apos;s own Ads screen — it is the only cost here that nothing
        else knows.
      </small>
    </div>
  );
}

export function Money({ n }: { n: number }) {
  const range = useRange();
  const [market, setMarket] = useState<string | undefined>(undefined);
  const [totals, setTotals] = useState<MoneyTotals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.ww
      .money(range.from, range.to, market)
      .then((r) => setTotals(r.money), (e: Error) => setError(e.message));
  }, [range.from, range.to, market]);

  useEffect(() => {
    setTotals(null);
    load();
  }, [load]);

  return (
    <section className="panel orders">
      <header>
        <h1>{n === 0 ? "Money" : `${n}. Money`}</h1>
        <p>
          What the packing was worth. Revenue and materials come from the costed kits, so this is
          the same arithmetic the <b>Costing</b> tab shows — a price corrected there moves this the
          same day. Anything packed whose SKU has no costed kit is listed at the bottom and left
          out of the totals, because an unknown must not read as free. <b>Ads and boost</b> are the
          exception: no parcel and no report knows what a marketplace charged to promote a listing,
          so that one number is typed in per day, below.
        </p>
      </header>

      <div className="two-picks">
        <RangePick {...range} />
        <MarketPick market={market} setMarket={setMarket} />
      </div>
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
            <div>
              <b>{rupees(totals.adsPaise)}</b>
              <span>on ads &amp; boost</span>
            </div>
            <div className={totals.profitPaise < 0 ? "bad" : "good"}>
              <b>{rupees(totals.profitPaise)}</b>
              <span>left after materials and ads</span>
            </div>
          </div>

          <Ads today={range.to} onSaved={load} />

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

          {totals.costed.length > 0 && (
            <table className="rows inv-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Priced by the kit</th>
                  <th>Where it sold</th>
                  <th>Packets</th>
                  <th>Came in</th>
                  <th>Materials</th>
                  <th>Left</th>
                </tr>
              </thead>
              <tbody>
                {totals.costed.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    {/* Which kit priced it — the line that answers "where is this number from?".
                        `SVP033` is priced by the kit `SVP033 - ANP002`, and that is easy to
                        forget you ever costed. */}
                    {/* One code, two shops. The Both/Meesho/Flipkart switch above answers *how did
                        Meesho do* by hiding Flipkart, which is the wrong question for a line about
                        one product: what you want is the same SKU's two shops side by side, because
                        that comparison is the reason to keep both listings. */}
                    <td className="split">
                      {c.markets.map((m) => (
                        <span key={m.name}>
                          <b>{shopName(m.name)}</b> {m.qty} · {rupees(m.revenuePaise)}
                        </span>
                      ))}
                    </td>
                    <td>{c.qty}</td>
                    <td>{rupees(c.revenuePaise)}</td>
                    <td>{rupees(c.materialsPaise)}</td>
                    <td>{rupees(c.revenuePaise - c.materialsPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
 * A longer window than the money screen's, because a return is not same-day.
 *
 * Today / this week / this month are the wage windows; a parcel that comes back does so weeks
 * after it went out, so a rate read over seven days is mostly noise. Thirty days is the shortest
 * that says anything and ninety is where it settles.
 */
function useLongRange() {
  const [days, setDays] = useState(90);
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - days);
  return { days, setDays, from: iso(from), to: iso(now) };
}

const percent = (r: number) => `${(r * 100).toFixed(1)}%`;

/** One cut of the return figures. Same columns three times, because it is the same arithmetic. */
function BackTable({ rows, head }: { rows: BackRate[]; head: string }) {
  if (rows.length === 0) return null;
  return (
    <table className="rows inv-table">
      <thead>
        <tr>
          <th>{head}</th>
          <th>Packets</th>
          <th>RTO</th>
          <th>Returned</th>
          <th>Came back</th>
          <th>Sale lost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.packets}</td>
            <td>{r.rto || ""}</td>
            <td>{r.returned || ""}</td>
            {/* Coloured off the rate, not the count: two back out of three is the problem, two out
                of two hundred is a Tuesday. */}
            <td className={r.backRate >= 0.15 ? "bad" : r.backRate > 0 ? "" : "muted"}>
              {r.backRate > 0 ? percent(r.backRate) : "—"}
            </td>
            <td>{r.lostPaise > 0 ? rupees(r.lostPaise) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * How it sells — what comes back, what has stopped, and what is being used up.
 *
 * **Three questions neither seller panel answers**, which is the only reason to build a screen at
 * all: Meesho shows Meesho, Flipkart shows Flipkart, neither joins any of it to what a kit costs
 * us, and **neither cuts by courier** — the one that is actionable, because a courier that RTOs
 * twice as often on the same SKU is a handover decision tomorrow morning.
 *
 * The rate belongs to the parcels PACKED in the window, not to the returns received in it: a
 * parcel that comes back in August was shipped in July, and dividing one month's returns by the
 * same month's packing would move every rate whenever volume did.
 */
export function Sells({ n }: { n: number }) {
  const range = useLongRange();
  const [market, setMarket] = useState<string | undefined>(undefined);
  const [view, setView] = useState<HowItSells | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setView(null);
    void window.ww
      .howItSells(range.from, range.to, market)
      .then(setView, (e: Error) => setError(e.message));
  }, [range.from, range.to, market]);

  return (
    <section className="panel orders">
      <header>
        <h1>{n === 0 ? "How it sells" : `${n}. How it sells`}</h1>
        <p>
          What comes back, what has stopped selling, and what is being used up — the things the
          seller dashboards cannot show you. They each know their own marketplace and none of them
          knows what a kit costs us. <b>The SKU rate is the one to act on:</b> a product that comes
          back often can be worth less than a slower one that stays sold.
        </p>
      </header>

      <div className="two-picks">
        <div className="picks">
          {[30, 90, 365].map((d) => (
            <button key={d} className={d === range.days ? "chosen" : ""} onClick={() => range.setDays(d)}>
              {d === 365 ? "Last year" : `Last ${d} days`}
            </button>
          ))}
        </div>
        <MarketPick market={market} setMarket={setMarket} />
      </div>
      {error && <p className="error">{error}</p>}

      {view === null ? (
        <p className="muted">{error ? "" : "Working it out…"}</p>
      ) : view.packedEver === 0 ? (
        /* No ledger at all — and this is NOT the same as nothing having sold. Every screen under
           Orders is empty until a manifest is read, so say that rather than printing an empty
           table; the first version gated the whole panel on one grey line and read as broken. */
        <p className="warnpill block">
          No manifest has been read yet, so there is nothing to measure.
          <small>
            Drop one on <b>Pack today</b> and this fills in on its own — every figure here is
            worked out from the parcels in the ledger.
          </small>
        </p>
      ) : (
        <>
          {view.bySku.length === 0 && (
            <p className="warnpill block">
              Nothing was packed in this window.
              <small>
                Try a longer one — returns arrive weeks after the parcel does, so the short windows
                are the ones most likely to be empty.
              </small>
            </p>
          )}

          {view.bySku.length > 0 && <h3>By SKU</h3>}
          <BackTable rows={view.bySku} head="SKU" />

          {view.byMarket.length > 1 && (
            <>
              <h3>By marketplace</h3>
              <BackTable rows={view.byMarket} head="Marketplace" />
            </>
          )}

          {view.byCourier.length > 0 && (
            <>
              <h3>By courier</h3>
              {/* Down here rather than at the top, and that is Vansh's correction: *"we don't
                  choose the delivery partner, and for Flipkart we just have one option, Ekart —
                  maybe we can raise a ticket but still I think this is almost useless."* He is
                  right that it is not a handover decision, because there is no handover to make.
                  Kept, because a ticket needs a number, and this is the only place one exists. */}
              <p className="muted">
                You do not choose the courier, so this is not a decision — it is <b>evidence</b>.
                If one is consistently worse on the same SKUs, this is the figure to put in a
                ticket to the marketplace.
              </p>
              <BackTable rows={view.byCourier} head="Courier" />
            </>
          )}

          {view.bySku.length > 0 && (
          <p className="warnpill block">
            Counted against the parcels <b>packed</b> in this window, not the returns received in
            it — a parcel that comes back in August was shipped in July.
            <small>
              So the most recent weeks read low: those parcels have not had time to come back. Read
              the ninety-day figure when you want the real rate.
            </small>
          </p>
          )}

          {view.slow.length > 0 && (
            <div className="uncosted">
              <h3>
                Nothing sold in this window
                <small>costed kits with no parcels — stock held for nobody</small>
              </h3>
              <ul>
                {view.slow.map((k) => (
                  <li key={k.sku}>
                    <span className="lid">{k.sku}</span>
                    <span className="qty">{k.lastPacked ? `last ${showDate(k.lastPacked)}` : "never"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.burn.length > 0 && (
            <>
              <h3>Materials used</h3>
              <p className="muted">
                Packs consumed by this window&apos;s packing, from each kit&apos;s own lines — so
                the per-week figure is the one to hold a purchase order against.
              </p>
              <table className="rows inv-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Packs used</th>
                    <th>Per week</th>
                  </tr>
                </thead>
                <tbody>
                  {view.burn.map((b) => (
                    <tr key={b.name}>
                      <td>{b.name}</td>
                      <td>{b.packs}</td>
                      <td>{b.perWeek}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
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
  const [market, setMarket] = useState<string | undefined>(undefined);
  const [pay, setPay] = useState<PackerPay[] | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.ww
      .money(range.from, range.to, market)
      .then((r) => setPay(r.pay), (e: Error) => setError(e.message));
  }, [range.from, range.to, market]);

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

      <div className="two-picks">
        <RangePick {...range} />
        <MarketPick market={market} setMarket={setMarket} />
      </div>
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

  /**
   * Delete a parcel that was cancelled — asking first, because there is no undo but the manifest.
   *
   * The question names the day it would move, since that is the whole risk: deleting an unpacked
   * parcel only shortens the queue, while deleting a packed one takes its money out of a day
   * already reported and its materials off the shelf's usage.
   */
  async function drop(p: SubOrder) {
    const where = p.packedOn
      ? `It was packed on ${showDate(p.packedOn)}, so that day's money and materials change.`
      : "It has not been packed, so only the queue changes.";
    if (!window.confirm(`Delete ${p.sku} · ${p.subOrder}?\n\n${where}\n\nThe only way back is to drop its manifest in again.`)) return;
    await window.ww.dropParcel(p.subOrder);
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
        <button onClick={() => void window.ww.pick("orders-report", "files").then((f) => report(f, status))}>
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

      <h3>Or mark one by hand — and delete a cancelled one</h3>
      <input
        type="text"
        className="wide"
        placeholder="Find by sub-order number, AWB or SKU — the sub-order number is the one that means exactly one parcel"
        value={find}
        onChange={(e) => setFind(e.target.value)}
      />
      <p className="muted">
        Searching reaches <b>every</b> parcel, including ones not packed yet — which is where a
        <b> cancelled</b> order is found. Cancelled is not RTO and not a return: nothing was sent,
        so it is deleted rather than marked, and it stops counting against the shelf.
      </p>

      {sent === null ? (
        <p className="muted">Looking…</p>
      ) : shown.length === 0 ? (
        <p className="muted">
          {sent.length === 0
            ? "No manifest has been read yet."
            : find.trim() === ""
              ? "Nothing has come back yet. Drop a report above, or search for one parcel — by SKU to find a cancelled one."
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((p) => (
              <tr key={p.subOrder} className={p.status ? "warn" : ""}>
                <td>{p.sku}</td>
                <td>{p.packedOn ? showDate(p.packedOn) : <span className="muted">not yet</span>}</td>
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
                <td>
                  <button className="drop-one" title="Cancelled — delete it" onClick={() => void drop(p)}>
                    Delete
                  </button>
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

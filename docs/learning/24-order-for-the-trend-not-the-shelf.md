# 24 — Ordering for the trend is a different question from topping up the shelf

**Decision (WW-192):** `forecast()` in `stock-core.ts` answers *at the rate these kits are selling,
what do I need for the next N days* — per SKU first, then rolled up per material, **keeping the
working**.

**Why it is not `nextCall`.** `nextCall` asks *what is running out* — cover, from how fast each
material has been consumed. That is the right question for the shelf and the wrong one for a plan:
a material burn rate has already averaged away *which kit* is burning it. Vansh, 2026-09-13, in his
own arithmetic:

> if each pkt of anp1 takes 2 pcs of golden fringes and 4 pcs of heart… and I get on an avg 10
> order of anp 1 then 4 × 10 × 15 should be the heart pcs req, nearly 12 pkt… and 2 × 10 × 15
> nearly 30 pkt of golden fringes

That sum is the specification, and it is the test: 600 pieces, 12 packets; 300 pieces, 30 packets.
If the code ever disagrees with the sum he does in his head, one of them is wrong and it should be
obvious which.

**The working is kept, not collapsed.** Every line carries the SKUs behind it, biggest first:

```
Black Balloon        89 pcs   1 pkt
    GTB007   0.15/day × 18 per kit × 14 = 38
    ANP009   0.13/day × 20 per kit × 14 = 35
    GTB003   0.03/day × 20 per kit × 14 = 8
```

Two reasons. A number with no arithmetic behind it is a number nobody can check — and it is the
only way to see that a figure jumped because **one** SKU started selling, rather than everything
drifting up. A total cannot tell those apart and they need opposite responses.

**Three refusals, each matching a rule this codebase already keeps:**

- **A kit that has not sold gets nothing.** No sales is not a small number, it is no answer.
  Ordering for a kit nobody bought is cash on a shelf; `nextCall` has its own reasons to stock
  something and they are better ones.
- **Packets round UP.** Half a packet cannot be ordered, and rounding down is how a kit runs one
  piece short.
- **No pack size, no packet count.** The same rule as `onHand`: a figure nobody can defend is worse
  than a blank, because a blank asks and a figure asserts.

**The window is the caller's choice**, because a fortnight of history and a quarter of it answer
honestly different questions — longer is steadier and slower to notice a change.

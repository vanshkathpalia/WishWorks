# 5 · "Closed" and "untested" look identical to a deletion pass

**Learned 2026-07-26, during the pre-GUI trim (WW-065), by nearly destroying the wrong thing.**

Asked to cut code before the Electron pivot, the obvious targets were the shipping-fee
experiments — `CLAUDE.md` says in bold that the Meesho shipping question is **closed, don't
re-run**. So the `--border=20` flag went, along with `docs/guides/SHIPPING-COST.md`.

Wrong. Three axes of that question are settled: image **content** (nine live variants), **metadata**
(five pixel-identical uploads, all ₹63), and **file size** (tested live, fee didn't move a rupee).
The **20 px border was never tested** — WW-064 built it as an opt-in flag *specifically* so it could
be, and `SHIPPING-COST.md` said so in as many words: *"never tested directly, and cheap to test."*

## The trap

Both states leave the same trace in a repo: **no recorded result.**

| | Looks like | Actually is |
|---|---|---|
| Closed | no result pending | the answer arrived; nothing more to learn |
| Untested | no result pending | the answer is still available, and cheap |

A deletion pass optimises for "does this earn its lines *today*", and an untested experiment
never does — its whole value is in a measurement nobody has taken. That makes it maximally
deletable and minimally *should*-be-deleted. It is the one category where the audit instinct
inverts.

## The rule

**Before deleting anything justified as a dead experiment, find the sentence that says the
question was *answered*.** Not the sentence saying the topic was dropped, closed, or deprioritised
— those describe attention, not knowledge. Here that sentence existed for metadata (*"Metadata has
no effect. Closed permanently."*) and for file size, and did not exist for the border. One `grep -i
border docs/` separated them.

Corollary: an untested axis is worth *more* than working code of the same size, because its payoff
is unrealised. The border test is also unusually cheap — the metadata probe proved the estimator is
deterministic and noise-free, so a two-image A/B settles it in one sitting, no averaging, no
repeats.

## Second lesson: reducing complexity ≠ removing features

The request was *"lower the code, make it less complex."* Deleting 4,900 lines of documentation
describing a Postgres/Fastify monorepo that was never built satisfies that completely. Deleting a
working flag does not — it trades the user's capability for the auditor's tidiness, which was never
the trade on offer. `CLAUDE.md` now carries a **"Reduce before adding"** rule drawing the line, and
requiring a question before removing anything that still answers an open question.

Full account: [`C-036`](../tracks/notion/CORRECTIONS.md). Related: [[verify-before-claiming]] —
same shape, one layer up. There, a claim was argued instead of tested; here, a *test* was deleted
instead of run.

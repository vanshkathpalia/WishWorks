# *Not on a note* is not *none in the room*

The supplier-call list has to name materials a costed kit is built on that no delivery note
carries — that is the half Vansh asked for by name, so a listing cannot be planned on something the
shop has none of.

The first run said `never-delivered` and produced **83 rows out of ~100 materials**. It was not
wrong: one delivery note was on record, saved that morning, covering 19 materials. Everything else
genuinely appeared on no note. But `never-delivered` reads as *you have none of this*, and acting on
83 such rows means ordering a second set of things already sitting on the shelf — a worse outcome
than not having the feature.

The flag is a statement about **the records**, not about **the room**, and the two only converge
once the records are complete. So:

- the reason is `not-on-a-note`, not `never-delivered` — the name carries the limit;
- the panel says *on none of the N delivery notes saved so far*, and when N is small it adds that
  this will include plenty he already has;
- that list is folded shut and carries no computed quantity, because nothing can be derived about a
  material with no history — every line is one packet until he changes it;
- the list with real arithmetic behind it (a rate, a shelf, a quantity) is a **separate** list, open
  by default, so two rows worth acting on are not buried under eighty that need reading.

The general shape: when a derived flag depends on how complete the input is, the flag has to say so
in its own name and in its own wording. A count of 83 is not a bug to suppress — it is the true
state of the records, and the fix is to describe it accurately rather than to hide it or to trust it.

Same family as `docs/learning/5-closed-is-not-untested.md`: two different states that leave an
identical trace, and picking the alarming reading of the two does real damage.

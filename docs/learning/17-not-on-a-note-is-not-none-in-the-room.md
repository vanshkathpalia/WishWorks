# *Not on a note* is not *none in the room*

The supplier-call list has to name materials a costed kit is built on that the shop may not have —
so a listing cannot be planned on something that does not exist yet. Vansh asked for it by name.

The first run flagged everything on a kit that no delivery note carried: **83 rows out of ~100
materials**. Not wrong — one note was on record, saved that morning, covering 19 materials. But
`never-delivered` reads as *you have none of this*, and acting on 83 such rows means ordering a
second set of what is already on the shelf. A flag that is wrong eighty times out of eighty-three is
worse than no flag.

The fix was not better wording. It was finding a **second signal that does not depend on the notes
at all**: whether the packing has ever eaten the material. Something packed is something he owns,
whatever the records say. That splits the 83 cleanly in two, and the halves want opposite actions:

- **21 used but never tallied in** — provably owned. A gap in the RECORDS. Putting these on a
  supplier call buys the shelf twice. They get their own list that says *not an order*, and the fix
  named on it is pasting the older delivery notes. Vansh had already worked this out: *"maybe it
  will automatically fix when I upload the delivery match for previous deliveries I had got."*
- **62 for kits that have never gone out** — no note, and never packed by anything. This is the
  question he actually asked: materials belonging to listings he is planning. Even here the honest
  instruction is *check you have these*, never *order these*, because one note still cannot prove
  absence.

Two lessons, and the second is the one that generalises.

**Reframing beat filtering.** Once the owned half was removed, the remainder was not a shorter
version of the same wrong list — it was a different list, with a different name and a different
verb. The original framing had been wrong, not merely noisy.

**When a derived flag depends on how complete the input is, look for an input that is already
complete.** The delivery notes were one month old; the parcel ledger went back a year. The answer
was sitting in a file the feature was not reading.

Same family as `docs/learning/5-closed-is-not-untested.md`: two states leaving an identical trace,
and picking the alarming reading of the two does real damage.

# A return rate belongs to the parcels that shipped, not to the month it arrived in

The obvious way to compute an RTO rate over a window is *returns received in the window ÷ parcels
packed in the window*. Both numbers are easy, both are already on screen, and the answer is wrong.

A parcel that comes back in August was shipped in July. So that division puts July's outcome over
August's volume — two different populations — and every rate moves whenever volume changes, for
reasons that have nothing to do with the SKU or the courier being measured. Double the packing in a
month and the RTO rate halves, with nothing about the product having changed.

`howItSells` instead walks the parcels **packed** in the window and asks which of them have since
come back, whenever that happened. That makes the rate a fact about a cohort: *of the parcels Valmo
carried in July, this fraction came back.* It is the only version of the number that a handover
decision can be made from, which is the whole reason the courier cut exists.

**The cost, stated on the screen:** a recent window under-reports, because parcels packed last week
have not had time to come back yet. Thirty days is the shortest window that says anything; ninety is
where it settles. A cohort-age cutoff — *only count parcels packed more than N days ago* — would fix
it properly, and nobody has yet asked the question that needs it.

The same reasoning is why returns are dated to the day they arrive rather than rewriting the packing
day ([`12-returns-are-dated-to-the-day-they-come-back.md`](12-returns-are-dated-to-the-day-they-come-back.md)).
Those two notes look opposed and are not: **the money moves on the day it moves, and the blame stays
with the parcel that earned it.** A day's reported total must never change; a rate about a courier
must never be about a month.

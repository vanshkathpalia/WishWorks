# A delivery note is one delivery in two people's handwriting

The supplier sends a claim. Vansh counts the boxes and writes his own list. Both describe the same
van, and the whole difficulty is that **they are not the same words**:

    2,pkt annprashan gold foil ok        vs   Annaprashan Gold Foil Balloon
    Groom to be foil 5 pkt ok            vs   5 pkt GTB Foil
    Blue no foil. 0 to9 450 pcs ok       vs   450 blue number foils

Three things came out of building against the real note rather than an imagined one.

## The quantity is not always first

`5 pkt kitty five pcs set` starts with it. `Groom to be foil 5 pkt` ends with it. `Blue no foil.
0 to9 450 pcs` buries it after a name that contains digits of its own — and reading the first number
there gives **0**, silently, for a line that is 450 pieces.

So the rule is *find the number with a UNIT against it*. The unit list (`pkt`, `pcs`, `petti`,
`bandal`, `kg`, `mtr`) is not decoration; it is the anchor that makes the other two cases work.

## Matching was already solved, and solving it again would have been the mistake

`candidates`/`score` in `inventory-core.ts` already matches free text against the same 121-row price
list, with three confidence bands and a human override that is never re-scored. That is exactly the
"flag the maybes, let me fix it" this needed. A second matcher would have been a second opinion about
which material a line is, and WW-115 already had that argument.

## The finding that shaped the design

Run against the real note: **61 lines read, 7 matched confidently, 36 not on the list at all.**

Not a bug. `categories/materials.json` prices **kits**, and the supplier names **raw goods** — plus
several genuinely are not on it (`8×10 meesho barcode`, `strow 2 kg`, `maniplant`).

The consequence is the design: without memory, that is three dozen dropdowns *every week*, and the
screen gets used once. So a pick is stored in `stock/aliases.json` against the wording it was made
for, and the second delivery matches itself.

**Aliases are deliberately not `aka` on the material.** `materials.json` ships with the app and is a
price list; one supplier's spelling is not a fact about a price. Keeping them apart means an app
update cannot lose his vocabulary, and his vocabulary cannot bloat the shipped list. (The `aka` rule
in CLAUDE.md is about *renames* of our own rows, which is a different problem.)

## And nothing stores a stock level

On-hand is `received − used`. Deliveries are a fact nobody can derive, so they are stored. Usage is
the parcel ledger times each kit's own material lines — already computed for the How it sells screen.
A stored total would be a second answer to a question that already has one, and this repo has been
bitten by that twice (C-049, C-061).

Usage counts only from the **first delivery on record**: before that there was no stock figure for it
to come off, and netting a year of packing against a carton that arrived on Tuesday would show every
material as deeply negative on day one.

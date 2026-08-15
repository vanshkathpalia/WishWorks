# An example in a prompt is an instruction

`PROMPT-inventory.md` asked for JSON and showed the shape like this:

```
{ "item": "Dark Pink Balloon", "qty": 20, "size": "10 inch" }
```

Vansh caught it: *"mentioning this particular name can make the prompt confusing and direct
towards that only — then ChatGPT may not pick the actual details but answer with this mentioned
only."* He is right, and the example was worse than a random one, because those were the items off
the packet we happened to be testing with. A blue kit could come back pink and look perfectly
plausible. `20` and `10 inch` anchor the same way for counts and sizes.

**The fix is not "no examples". It is that a slot the model FILLS must not contain a value it could
copy.** The skeleton now reads `"item": "<the item's full name>"`, with one line saying the
brackets are a description and that every value must come from the sheet. The rule that used to be
carried by two sample product names is now stated structurally — *carry every word that tells this
item apart from a similar one; if the sheet puts that in a separate column or a caption, fold it
into the name* — plus the reason, which is what makes a rule stick: the price list has rows that
differ by one word at two different costs.

## The check that missed one, and what it teaches

**This note originally said the other prompts were clean. That was wrong, and it was wrong the
same day.** Vansh sent an inventory whose `sku` was `HBD-Kitty01` and ChatGPT handed back
`image-meta-ANP003.json` — because `PROMPT-meta.md` said *"…named image-meta-<ID>.json — e.g.
image-meta-ANP003.json"*, and `ANP003` appeared **four times** in that section. The model copied
the example over the real value, exactly as here.

The reason the first sweep missed it: it grepped for example values sitting inside a JSON
*template*, and the filename instruction is prose. **A fillable slot is not a syntax, it is a
role** — anywhere the model must substitute a real value, in a code block or in a sentence.
Both filename lines now carry `<ID>` plus an explicit *do not substitute a code that appears in
these instructions*.

That fix uncovered a second fault the anchor had been hiding. The ID rule still said the code
lives in *"the inventory's own header row, which carries two codes"* — the Excel workflow. The
inventory is JSON from the Inventory panel now, with a clean `sku` field, and the prompt had
never heard of it. So the model had no correct source to read and the nearest concrete-looking
code won. **An anchor is most dangerous where the real instruction has gone stale**, because
there it is not competing with the truth, it is standing in for it.

## The distinction worth keeping

The attribute examples in `PROMPT-product.md` were checked again and genuinely are fine, because
those are **field definitions**, not fillable slots:

```
"Material"  – from: Latex, Foil, Paper, Plastic, Fabric, Rubber
"Occasion"  – from: Birthday, Anniversary, Baby Shower, Wedding, ...
```

A closed list of alternatives tells the model what the field MEANS and cannot be echoed as "the
answer", because there is no single answer on offer. The one that comes closest to the trap —
`"Character" – ... e.g. ["Happy Birthday"]` — is immediately followed by *only wording actually
printed*, *do not put the occasion here*, and *if nothing is printed, leave the field out*. It was
already defended.

So: one concrete value in a template = an anchor. Several alternatives in a definition = a
definition. Only the first kind needs replacing.

**Related:** WW-118, where the same prompt's other fault was found the same way — by reading what
the model actually replied instead of what the prompt asked for.

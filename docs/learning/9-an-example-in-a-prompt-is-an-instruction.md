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

## The distinction worth keeping

The other prompts were checked and left alone. `PROMPT-product.md` is full of `e.g.`, and it is
fine, because those are **field definitions**, not fillable slots:

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

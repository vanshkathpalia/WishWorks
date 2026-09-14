You are given TWO lists from a party-decoration business in India.

LIST A is our own price list: the materials we buy, written the way WE write them, as
`Category | Material Name`.

LIST B is a delivery note written by our supplier, in his own words. He writes in a hurry, mixes
Hindi and English, misspells freely, abbreviates, and sometimes puts two products on one line.

Your job is to work out what his words mean, so our software can match his notes automatically in
future. Reply with NOTHING but one JSON code block, exactly this shape:

```json
{
  "words": { "kt": "fringe" },
  "aliases": [ { "material": "GTB Sash", "says": "groom to be sesh" } ],
  "new": [ "brown retro t" ],
  "split": [ { "line": "1-1 pkt cheers glass small", "means": ["cheers mug", "glass foil small"] } ],
  "unsure": [ { "line": "black banner heavy leaf", "why": "could be a black HBD banner; no such row" } ]
}
```

WORDS — a single word of his that always means a single word of ours, anywhere it appears. `kt`
always means fringe, whether it is `red kt` or `golden kt`. Only put a word here if it is TRUE
EVERYWHERE. This is the most valuable section and the most dangerous: a wrong word rewrites every
future note silently.

ALIASES — a whole phrase of his that names one specific row of LIST A, where no single-word rule
would do it. Use the material's exact name from LIST A.

NEW — his lines that name something genuinely not in LIST A. Do not force a match. A material we do
not stock is a normal thing for a supplier to send.

SPLIT — one of his lines that is really two or more products. Say what each part is.

UNSURE — anything you cannot decide. **Use this freely.** We would far rather check ten lines by
hand than have one wrong rule applied silently to every note from now on.

RULES

- Never invent a material that is not in LIST A. If his line does not match anything there, it goes
  in `new` or `unsure`, never in `aliases`.
- A colour, a size and a material type are what make two rows DIFFERENT products. `Blue Pastel
  Balloon` and `Blue Balloon` are not the same thing; `9x12` and `8x12` are not the same bag.
- If two rows in LIST A are both plausible for one of his words, put it in `unsure` and name both.
  Do not pick one.
- `t` and `c` after a colour mean the balloon came from Thailand or China. They say nothing about
  what the material is.
- Quantities and units (`1 pkt`, `200 pcs`, `5 pcs set`) are not part of any name.
- Keep your own reasoning out of the JSON. `unsure.why` is one short sentence.

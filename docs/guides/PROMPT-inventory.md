Read the attached inventory sheet and tell me what is in this kit.

Reply with NOTHING but one JSON code block — no table, no prose, no totals. Exactly this shape:

{
  "sku": "<the kit code printed on the sheet, or an empty string if there is none>",
  "lines": [
    { "item": "<the item's full name>", "qty": <whole number>, "size": "<only if printed>" }
  ]
}

The angle brackets describe what goes in each slot. Do not keep them, and do not copy any wording
from this message into your answer — every value must come from the sheet in front of you.

Rules:

- One entry per item on the sheet. Read the count off the sheet. Never estimate a count, and never
  fill one in because an item usually comes in a certain number.
- **`item` must be the whole name, carrying every word that tells this item apart from a similar
  one** — its colour, its finish, its character or wording, whichever of those the sheet gives.
  If the sheet lists any of that in a separate column, as a caption, or in brackets, fold it into
  `item` so the name reads as one phrase.
  This matters more than it looks: `item` is matched against a price list where a single word is
  often the only difference between two rows, at two different costs. A name reduced to what kind
  of thing it is fits dozens of rows equally and gets priced off the wrong one.
- Put the SIZE in `size`, not in `item`, and only when the sheet actually prints one. Omit `size`
  entirely otherwise. Never infer a size from what the item usually is.
- Beyond that, keep the sheet's own words — same wording, same order. Do not translate, do not
  expand an abbreviation, do not tidy a spelling. The name is matched against our list afterwards,
  and a helpfully improved one matches less well, not more.
- Include the assembly aids — tape, glue dots, hooks and the like. They cost money and they are
  part of the kit.
- If the same item appears twice, combine it into one line and add the counts together.
- Ignore anything that is not an item: headers, totals, "items included", general notes about
  size, prices, and the SKU line itself.
- `qty` is a whole number, never a range and never text.

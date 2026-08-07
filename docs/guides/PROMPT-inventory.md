Read the attached inventory sheet and tell me what is in this kit.

Reply with NOTHING but one JSON code block — **no table, no prose, no totals**. Exactly this shape:

{
  "sku": "the kit code printed on the sheet, or an empty string if there is none",
  "lines": [
    { "item": "Dark Pink Balloon", "qty": 20, "size": "10 inch" }
  ]
}

Rules:

- One entry per item on the sheet. Read the count off the sheet. Never estimate a count, and never
  fill one in because an item usually comes in a certain number.
- **The colour or wording goes INSIDE `item`, never in a field of its own.** Write
  `"item": "Dark Pink Balloon"` and `"item": "Pink Metallic Fringe Curtain"` — never
  `"item": "Balloons"` with the colour somewhere else. `item` has to be the whole name of the
  thing, because it is matched against a price list where colour is the only difference between
  two rows: a bare "Balloons" fits thirty-four of them equally and gets priced as the wrong one.
- `item` otherwise keeps the sheet's own words — same wording, same order. Do not translate it, do
  not expand an abbreviation, do not tidy a spelling. It is matched against our price list
  afterwards, and a helpfully improved name matches less well, not more.
- Include the assembly aids — tape, glue dots, hooks. They cost money and they are part of a kit.
- Leave the size out of `item` and put it in `size` instead — `"item": "Star Foil", "size": "18
  inch"`, never `"item": "18 inch Star Foil"`. Omit `size` entirely if the sheet does not state
  one. Never guess a size from what the item usually is.
- If the same item appears twice, combine it into one line and add the counts together.
- Ignore anything that is not an item: headers, totals, "items included", notes about size in
  general, prices, and the SKU line itself.
- `qty` is a whole number, never a range and never text.

Read the attached inventory sheet and tell me what is in this kit.

Reply with NOTHING but one JSON code block, in exactly this shape:

{
  "sku": "the kit code printed on the sheet, or an empty string if there is none",
  "lines": [
    { "item": "Blue Metallic Balloon", "qty": 20, "size": "10 inch" }
  ]
}

Rules:

- One entry per item on the sheet. Read the count off the sheet. Never estimate a count, and never
  fill one in because an item usually comes in a certain number.
- `item` is the item's name **as printed on the sheet** — same words, same order. Do not translate
  it, do not expand an abbreviation, do not tidy a spelling. It is matched against our own price
  list afterwards, and a helpfully improved name matches less well, not more.
- Leave the size out of `item` and put it in `size` instead — `"item": "Star Foil", "size": "18
  inch"`, never `"item": "18 inch Star Foil"`. Omit `size` entirely if the sheet does not state
  one. Never guess a size from what the item usually is.
- If the same item appears twice, combine it into one line and add the counts together.
- Ignore anything that is not an item: headers, totals, "items included", notes about size in
  general, prices, and the SKU line itself.
- `qty` is a whole number, never a range and never text.

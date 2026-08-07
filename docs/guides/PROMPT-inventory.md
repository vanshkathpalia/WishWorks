Read the attached inventory sheet and tell me what is in this kit.

Reply with NOTHING but one JSON code block, in exactly this shape:

{
  "sku": "the kit code printed on the sheet, or an empty string if there is none",
  "lines": [
    { "material": "a name copied exactly from the price list below", "qty": 20 }
  ]
}

Rules:

- One entry per item on the sheet. Read the count off the sheet. Never estimate a count, and never
  fill one in because an item usually comes in a certain number.
- `material` must be copied **character for character** from the price list at the end of this
  message — same spelling, same capitalisation. Several of those names are misspelt. Copy the
  misspelling. They are the keys a costing table looks up, and a tidied-up name matches nothing.
- If an item on the sheet is not in the price list, still include it, with the name **as printed on
  the sheet**. Do not map it to the nearest row. It will be flagged and priced by hand, which is
  the correct outcome — a wrong row in a cost sheet is invisible in a total.
- If the same item appears twice, combine it into one line and add the counts together.
- Ignore anything that is not an item: headers, totals, "items included", notes about size,
  prices, and the SKU line itself.
- `qty` is a whole number, never a range and never text.

THE PRICE LIST — copy these names exactly:

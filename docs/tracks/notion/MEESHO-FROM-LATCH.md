# The Meesho half of a latch — what is known, and what is not yet built

A latch puts a product on Flipkart by attaching to somebody's catalog entry. Meesho has no catalog
and no API, so the same product gets there a different way: a **bulk sheet** plus an **image
upload**, in batches. This is what was established on 2026-09-13, before building the rest.

## How the two files actually connect — they don't

The question was *"how do these two files know what to put here?"* They do not know anything about
each other. From the template's own instructions:

> Please use the image uploader on the supplier panel to generate image link.

The panel takes images and hands back **URLs**. Those URLs are pasted into the sheet's image
columns. **The join is a link, typed in by a person** — nothing is matched by filename, and nothing
in the sheet points at a file on disk. Any automation has to do both halves: upload, collect the
links, then write them into the sheet.

## The template's fields

Sheet `Party-Items-Fill this`, headers below a block of instructions. Compulsory and recommended:

`Product Name` · `Variation` · `Meesho Price` · `Wrong/Defective Returns Price` · `MRP` · `GST %` ·
`HSN ID` · `Net Weight (gms)` · `Inventory` · `Country of Origin` · `Manufacturer Name/Address/Pincode` ·
`Packer Name/Address/Pincode` · `Importer Name/Address/Pincode` · `Color` · `Generic Name` ·
`Included Components` · `Net Quantity (N)` · `Number of Items` · `Occasion`

Most of these we already hold: the manufacturer/packer block is the **WishWorks** one (Meesho's
name, not PartyDreams — see `balloon-decoration.pricing.defaults.json`), HSN and GST come from the
same file, weight from `packaging.ts`, and the copy from `PROMPT-meesho-only.md`.

## The image rules, and why reusing Flipkart's images only half works

The template is explicit, and it conflicts with what a Flipkart listing looks like:

- `.JPEG` only, **RGB** — not CMYK
- Image 1 = front of packaging, image 2 = back
- **no text or watermark in primary images**
- **no price or brand logo**
- solo product, **no props**
- nothing graphic, inverted, pixelated or duplicate

**Our Flipkart hero has props and, on the bordered variant, badges. Our infographic is entirely
text.** Neither survives as a Meesho *primary*. That is exactly the polish Vansh described — remove
the sticker and the tag, fix a pixelated one — and it is not a nice-to-have: it is what makes the
image legal. The ones that pass untouched are the plain product shots.

## Two constraints stated, neither built

- **Skip the extreme-delivery listings.** *"I don't want high prices but low quantity supply
  listings, to maintain some standard."* Meesho sets a delivery charge per listing; where it is
  punitive the listing is not worth having. Wanted, but explicitly optional if it adds complexity.
- **Settlement must clear the cost.** Meesho's settlement has to be more than materials plus the
  markup set on the kit — the `flatPaise` figure in the costing panel, ₹60 by default and editable
  per kit. This is the same rule as the Flipkart side and must read the same field, not a copy.

## What exists today (2026-09-18)

**Latch screen → "Which go on Meesho?"** lists `forMeesho(book)` — latched, with our SKU, not yet
done, **oldest first**. **"Write the Meesho sheet"** runs one ChatGPT chat per costed kit
(`PROMPT-meesho-only.md` with the pack, then `PROMPT-meesho-sheet.md` for the six dropdowns, chat
named `<SKU> — meesho`) and writes every row into Meesho's own template, in Downloads
(`meesho-core.ts`, `categories/meesho-party-items.xlsx`). **"I uploaded these"** calls `markMeesho`.

- **Price** = (materials + the kit's `flatPaise`) + 5% GST, rounded up — the settlement rule above.
- **Fixed answers** in `categories/meesho-sheet.json`: WishWorks + the Hisar address, HSN **950300**
  (Meesho offers no 95030020), GST 5, MRP 999, stock 100, origin India, importer Not Required.
- **Still by hand:** the four image links (upload in the supplier panel, paste its links), and any
  column the result note names. Every row's problems are listed in that note: an unpriced line, a
  name whose piece count disagrees with the kit, a field over its limit, a dropdown ChatGPT missed.
- **Never run against real ChatGPT or a real Meesho upload.** Round-tripped through openpyxl only.
- Not built: skipping the extreme-delivery listings, and anything that uploads images.

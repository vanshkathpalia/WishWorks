# 10 — A marketplace manifest is read with `node:zlib`, not a PDF library

**Decision (WW-172):** `src/orders-core.ts` reads the Meesho Supplier Manifest itself, in about
thirty lines, rather than adding `pdfjs-dist`.

**Why it works.** A manifest is a machine-generated table. Every cell is drawn as one
`x y Td (text)Tj` inside a Flate-compressed content stream, in plain single-byte strings — no
custom font encoding, no CID maps, no shading, no encryption. Inflate the streams, pull out the
`Tj` calls with their coordinates, and a *row* is the cells that share a `y`. That is the whole
reader. `pdfjs-dist` is 3 MB of dependency for the features this document does not use.

**The bug that cost the most time, so it is worth knowing:** scanning for the `stream` keyword
must jump past `endstream`, not to it — the word *endstream* contains *stream*, so landing on it
puts the next read three bytes into the wrong place. The symptom was 1 of 13 streams inflating and
a manifest full of orders reading as empty. `tests/fixtures/meesho-manifest.pdf` is a real
manifest kept in the repo for exactly this: a hand-written sample would only prove we can read a
PDF we wrote.

**When to change it.** If a numeric-only SKU ever appears, or a marketplace's manifest turns out
to be scanned rather than generated. The one structural guess in the parser is that a picklist row
is four cells whose last is a whole number and whose first is not — the rule separating it from
the four-cell shipment rows on the courier pages.

**Not the same answer for Flipkart.** Flipkart has a manifest PDF too (Orders → Pending Handover),
but it also has an Order Management API that returns the orders as JSON, and price/stock/orders
were always the API-automatable half. When Flipkart orders start arriving, take the API, not the
PDF. Nothing has been built for it — there are no Flipkart orders yet to build against.

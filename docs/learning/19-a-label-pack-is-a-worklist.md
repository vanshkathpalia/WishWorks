# 19 — A competitor's label pack is a work list, and the titles on it are truncated

**Decision (WW-181):** `src/latch-core.ts` reads a Flipkart label PDF into `{sku, description}` and
that is the input to latching. 86 labels came out as 39 products.

**Why a PDF at all.** These are another seller's listings, so there is no CSV export to ask for —
the label pack is the only machine-readable list of what that seller actually ships, and how often
each one appears is a decent proxy for how well it sells. Deduplicating by SKU and sorting by label
count puts their bestseller first.

**Two things about the text that shape the code:**

1. **The QTY column is at the end of the FIRST line**, so a title that wraps puts it in the middle:
   `Partyfox Annaprashan Decoration Kit - Pastel 1 Balloons, Cutouts`. Stripping a trailing number
   from the joined title leaves the 1 exactly where it does the most damage.
2. **Every title is cut to fit the box.** That is fine for searching — a truncated title is a
   prefix of the real one — and it is why the search result is chosen **by prefix, not by score**:
   the real listing's title *starts with* what the label printed. Highest-score-wins was measured
   against a real pack and would have latched a ZYRIC kit onto a Magic Balloons one at 0.83.

   The same truncation is why **two prefix matches is a refusal**: `ZYRIC Solid Happy birthday
   black and gold` is the start of both that seller's *decoration kit* and their *balloons set*,
   and the label cut off the word that told them apart.

**Not the zlib reader in `orders-core.ts`.** A Meesho manifest draws text as `x y Td (text)Tj` in
plain strings; a Flipkart label is Qt-generated with subsetted CID fonts and arrives as `<0001> Tj`
glyph ids, which need each page's ToUnicode CMap resolved. `pdftotext` (poppler) does it in one
line. That makes this half Mac/Linux only, which is fine while latching is Vansh's own job on his
own machine — see the `ponytail:` note in the file for what changes if it ever ships in the .exe.

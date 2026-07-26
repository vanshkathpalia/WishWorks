# 2. A `finish` shortcut for already-clean images, separate from the crop pipeline

**Decision.** Added `npm run finish` (`src/finish.ts`) — a second, simpler image path that
only embeds descriptions and renames files flat. The three-folder crop/convert/square pipeline
in `images.ts` stays exactly as it is, for tagged Meesho downloads.

**Context.** Vansh's business partner now supplies photos that are already clean: JPEG, no
Meesho tag, sized as-is. For those, the whole reason `images.ts` exists — AVIF→JPG conversion,
cropping the `s-####` watermark, squaring to 1500px — is unnecessary work. The one part Vansh
wanted was the description-into-EXIF step (stage 2, `--final`), plus a naming/layout change.

**What `finish` does.**
- Input: a listing folder of numbered images (or a parent of such folders).
- Derives the ID from the folder name: `ANP 1 - p` → `ANP-1` (leading letters + first number).
- Writes each image's description (from `image-meta/<ID>.json`) into its EXIF.
- Outputs **flat** to `~/Downloads/wishworks-ready/` as `<ID>.<n>.jpg` (e.g. `ANP-1.1.jpg`),
  so upload files aren't buried in per-listing subfolders. Source folders are never touched —
  they stay as the archive/categorisation Vansh wants to keep.

**Deliberately does NOT resize or square.** Confirmed with Vansh: neither Flipkart nor Meesho
*requires* the seller to upload exactly 1500×1500 — that target was this tool-builder's choice,
not a marketplace rule, and his partner uploads as-is with no problem. Forcing a resize would
only hurt (e.g. upscaling a 350px prop sheet makes it blurrier). Pixels go out untouched; the
tool only re-encodes to JPEG so the EXIF description lands reliably. A `--resize` flag can be
added later if uniformity is ever wanted.

**Meesho metadata is dropped automatically.** sharp does not copy source metadata unless asked
(`withMetadata()`), which we never call — so any Meesho seller-code embedded in a source AVIF's
metadata never reaches the output. Both image tools additionally *scan* source metadata for `meesho`
or an `s-######` code and print a ⚠️ heads-up. A tag burned into the **pixels** is invisible
to this check — that still needs the crop/erase path in `images.ts` (or a clean AI redo).

**Measured (2026-07-24):** a real Meesho `.avif` download carries EXIF, but **no seller code
and no "meesho" string** in it — the `s-971393175` tag is pixel-only. So in practice this scan
returns null on current Meesho files; it will only ever fire if Meesho starts embedding a code
in metadata. Kept as cheap insurance, not as the tag defence. The tag defence is pixels:
`--crop-bottom` / `--erase-tag` in `images.ts`, plus the human corner-check now spelled out
after Prompt A in `image-playbook.md`.

**Refactor.** The shared EXIF/description helpers (`buildExif`, `composeDescription`,
`descriptionsFor`, `Descriptions`) moved from `images.ts` into `src/image-meta.ts` so both
tools use one copy. `images.ts`'s 50 tests (subprocess CLI, unaffected by internal moves) all
still pass.

**Rejected alternative.** Adding a `--flat --no-crop` mode onto `images.ts`. It already carries
two stages and a lot of flags; a distinct, clearly-named tool for the clean-image case is
easier to explain to a non-technical operator than yet another flag combination.

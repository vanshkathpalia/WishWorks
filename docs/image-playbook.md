# Image playbook — specs, AI prompts, and marketplace image SEO

> **What this is.** The reasoning behind every image decision: what format and size, the exact
> AI prompts, and what actually moves ranking. If you just want the steps, read
> [`guides/THE-FLOW.md`](guides/THE-FLOW.md) instead.
>
> **How to read it.** Every factual claim carries its source. Blog-sourced marketplace specs
> have been wrong three times in this project (C-007, C-014, C-016), always caught by looking
> at the real thing. Trust the 🟢 rows; challenge the 🟡 ones.

---

## Part 0 — What we actually know

| Claim | Confidence | Basis |
|---|---|---|
| Meesho serves **`.avif`**, ~512×512 | 🟢 Measured | Real download, `sharp` metadata |
| Uploads must be JPEG | 🟢 Safe | Accepted everywhere; the only format never refused |
| 1:1 square, ≥1000px, sRGB | 🟢 Safe | Consistent across all sources; square is never rejected |
| Product fills **≥85%** of frame | 🟡 Blog-sourced | Widely quoted from Flipkart. It is a *minimum* — fill generously |
| Non-square is rejected | 🔴 **Contested** | Blogs say yes; a live selling Meesho listing runs 512×212. See C-014. Use square anyway — it costs nothing |
| Meesho reads image metadata | 🔴 **Unknown** | Answered wrongly 3×. Experiment pending — see Part 4 |
| CMYK is required | ❌ **False** | A widely-copied blog says this. CMYK renders muddy and Meesho rejects it. Always sRGB |
| Filenames matter | 🟡 Almost certainly not | Platforms rename on upload |
| Title + attribute keywords matter | 🟢 High | Every source agrees; also what Flipkart's Listing Quality Score measures |

---

## Part 1 — Formats and specs

### The chain

| Stage | Format | Note |
|---|---|---|
| Downloaded from Meesho | **`.avif`** | Not WebP — that was an early wrong assumption (C-017). Never edit or upload this |
| Working / AI output | anything | PNG or JPEG both fine |
| **Uploaded** | **JPEG, quality 90** | The only format guaranteed accepted on both platforms |

> ⚠️ **Renaming does not convert.** Saving `1.avif` as `1.jpg` changes the label, not the
> bytes — verified: a renamed file still reports `ISO Media, AVIF Image`. Your Mac previews it
> happily; the marketplace reads the bytes and rejects it. `npm run images` does the real
> conversion.

### Target spec

| Spec | Value |
|---|---|
| Aspect | 1:1 square |
| Size | **1500 × 1500** (min 1000×1000 — below 1000 loses Flipkart zoom) |
| Format | JPEG q90 |
| Colour | sRGB, never CMYK |
| File size | under 5 MB (Meesho cap) |
| Background (main) | **decoration kit:** assembled on a clean but *real* wall/room (not pure white) — see the main-image method in Part 2. Pure white is for generic parts-combos, not decoration sets |
| Product fill | decoration fills most of the frame, generous |
| Text/logo/watermark on **main** | none — instant QC fail |
| Count | 4–7 images |

**You do not hit these by hand.** `npm run images` guarantees every row above, and 50 tests
prove it. Never ask the AI for a pixel size — image models generate at their own fixed
resolutions (~1024²) and will agree to "1500×1500" while ignoring it.

### 🔴 The real bottleneck: 512×512 sources

Website downloads are **512×512** — half the zoom threshold, a third of the target.
Upscaling cannot restore detail that was never captured. The main image is the one thing
that decides click-through, and a soft one loses to a sharp competitor regardless of every
other optimisation in this document.

**Get originals from whoever shot them** (phone/camera, 2000px+), or reshoot. No prompt,
setting or command fixes this. It is the highest-value open item in the project (WW-035).

---

## Part 2 — The AI prompts

### The one rule

You are re-editing your partner's photos. Two risks pulling opposite ways:

1. **Uploading unchanged** → duplicate-image detection. Meesho flags reused images and
   suppresses duplicate catalogs. So it *must* change.
2. **Letting the AI redraw the products** → the image stops matching the box. That drives
   returns and 1–2★ ratings, and Meesho's **Quality Score is computed from the % of 1–2★
   ratings vs orders**. Below ~3.5 they quietly stop showing you.

> **Change the setting, never the product — and for a decoration kit, keep the arrangement
> assembled.** Wall, backdrop colour, lighting, camera angle — fair game. The *assembled setup*
> (garland/arch, banner, props in place), and the products themselves — colours, foil shapes,
> printed text, piece counts — are kept as-is, never rebuilt into a white flat-lay, never
> "beautified". The finished-on-the-wall look is the whole reason someone buys the kit (C-020).

Image models are also genuinely bad at counting: ask for 30 balloons, get 22–40. **So don't
ask them to count.** You pack these kits — you already know what's in them. Type the
inventory yourself and hand it to the AI as fact. That removes the single biggest source of
error in the flow, and takes about a minute.

The AI's job is then narrow and reliable: look at the photos, and **draw exactly the list you
gave it**.

### Which AI, and the watermark trap

| Job | Use | Why |
|---|---|---|
| Main image (read pack → build decoration) | **ChatGPT** | Fast, no watermark, follows the two-message read→build flow and honours distinct counts most reliably. AI Studio (`aistudio.google.com`) also works and is watermark-free; the Gemini *app* is not (see below) |
| Prompt B (infographic with text) | GPT Image / ChatGPT | Better text layout. Proofread every number |

> ⚠️ **Do not use the Gemini app for listing images.** It stamps a visible sparkle logo in a
> corner — an instant QC rejection, on your main image. AI Studio is the same model without
> it, and free. (SynthID, the *invisible* marker, is harmless — nothing checks for it and it
> violates nothing. Ignore tools that claim to strip it.)
>
> **Always check the corners of AI output before uploading.**

---

### Step 0a — Write the inventory yourself (1 minute, no AI)

You pack the kit; you know what's in it. **Never make the AI count.** Write it as plain text:

```
1 x Shubh Annaprashan banner (red/gold, Devanagari)
20 x red latex balloons
20 x golden latex balloons
4 x red heart foil balloons
2 x backdrop net curtains
1 x fairy light, 10 metre
16 x photo props on sticks
1 x glue tape roll
TOTAL: 65 pcs
```

If image 2 is already a "what's inside" infographic, this is just reading it off. This text
is then the **authoritative list** for everything below — the AI is told to draw exactly
this, never to work it out for itself.

### Step 0b — Per-image descriptions · ⛔ SUPERSEDED, DO NOT RUN

> **This step no longer exists in the flow.** Per-image descriptions now come from the **single
> merged prompt in [`guides/START-HERE.md`](guides/START-HERE.md) Part 3**, which returns the
> `image-meta` descriptions *and* the Flipkart `products` fields from one conversation. Running
> Step 0b as well would duplicate that work and risk two different sets of descriptions.
>
> A **Meesho-only** product is covered too — keep the `image-meta` half of that JSON and discard
> the `products` half.
>
> The old standalone prompt is in the [Archive](#archive--superseded-prompts-kept-for-reference)
> at the foot of this file.

**What you still need from this part of the doc:** [Step 0a](#step-0a--write-the-inventory-yourself-1-minute-no-ai)
(write the inventory yourself — still required, it feeds both conversations),
[the main image flow](#the-main-image--read-the-pack-then-build-the-decoration), and
[Prompt B](#prompt-b--the-whats-in-the-pack-infographic). That is all this file is for now:
**making the pictures.** The JSON comes from `START-HERE.md`.

---

### The main image — read the pack, then build the decoration

> **For the partner (plain version).** You give the AI the **"what's in the packet" sheet** — the
> image that lists every item with counts. It reads the contents, then *builds* a fresh, realistic
> photo of that decoration set up on a wall. **Two messages, and a third only if a count looks
> off.** Use **ChatGPT** — it's fast, adds no watermark, and gets this right most reliably.
> (This replaced the old "edit the existing photo" prompt, which is archived at the end of this file.)

**Why we build a new photo instead of editing the old one.** The old photo is usually the
supplier's, carries a Meesho tag, and reused unchanged it risks Meesho's duplicate-image
detection. Building fresh from the *contents sheet* gives a distinct, tag-free image grounded in
the real items and their real counts. The sheet is the source of truth — it prints the quantities.

**The one thing that matters: honest counts.** The photo must never show MORE of any item than the
pack contains — an image that looks fuller than the kit is what causes returns and bad ratings.
Three honest limits, so nobody is surprised:
- The AI **can** count big distinct items (foil moon, stars, banner, hearts) — those come out exact.
- It **cannot** count a dense latex balloon garland precisely (20 may render as 22–25). We hold it
  down by telling it to *space* the balloons, not pack them, and to treat the numbers as caps.
  Close, not laser-exact — and this is the low-harm case, since nobody tallies balloons in a garland.
- The **only** guarantee of exact counts is a photo of the actually-assembled kit. That is the
  ceiling of what any AI can do today.

---

**Message 1 — read the pack**  *(attach the "what's in the packet" image)*

```
This image is the "what's in the packet" sheet for a party-decoration kit. In TEXT ONLY (do NOT
make an image), list every item with its exact count, colour, and any foil/banner wording, and
mark each DISPLAYED (goes on the wall — balloons, foils, banner, fringe curtain, fairy lights) or
ASSEMBLY AID (arch tape, glue, pump — never shown). Then give the TOTAL pieces — if the sheet
doesn't print a total, add the counts up yourself. Just so I can confirm.
```

Glance at the list it returns. It also doubles as your **description inventory** (Step 0b) and the
counts you type into the listing — one read, several uses. If it misread anything, correct it in
your next message *before* it draws.

**Message 2 — build the decoration**  *(no attachment; send after the list)*

> **This is the prompt to use.** Nine image variants were tested against Meesho's shipping
> estimator (2026-07-25) — plain white, tiny-in-frame, flat-lay, compact bundle, floating on
> white. Every one of them was *worse* looking and most were *more* expensive, up to ₹256.
> This version is the winner on both counts. See [`SHIPPING-COST.md`](guides/SHIPPING-COST.md).

```
Now make ONE realistic photograph: the DISPLAYED items assembled as a finished wall decoration,
lit by soft even daylight. A professional decorator's setup, aspirational but real.

SHAPE: a PERFECT SQUARE image — 1:1 aspect ratio, equal width and height. NOT portrait, NOT
landscape, not 2:3 or 3:4. It must be square.

SETTING: a clean, modern Indian home — a plain smooth wall in a soft neutral colour, soft even
daylight, and at most a hint of plain tiled floor at the very bottom. NOTHING MAY BE PLACED IN
THE SCENE. The frame contains the DISPLAYED items from your list, the bare wall and the floor,
and nothing else at all. Specifically NO stool, chowki, bench, chair, table, cot, sofa or
furniture of any kind; NO cake, food, plates, thali or trays; NO people, babies, hands or
mannequins; NO plants, cushions, rugs, lamps, gift boxes or ornaments; NO window, curtain or
drape that is not itself an item on the DISPLAYED list. If the pack contains a fringe or
curtain backdrop then show it, because it is a real item — but never invent one.

This rule is absolute and applies to every kit type. Do not add a prop because it "suits the
occasion": a baby stool in a groom-to-be photo, or a cake in a rice-ceremony photo, is wrong
twice over — it misrepresents what the buyer receives, and props of that kind are not what we
are selling.

COMPOSITION: a balloon garland FRAMING the top and one side of the backdrop, the foil-letter
banner centred on the fringe/curtain backdrop, and the foil shapes (moon, stars, hearts) placed
to balance the frame. Full and well-arranged, like a premium party backdrop.

THE IMAGE MUST CONTAIN ZERO TEXT — no labels, numbers, tables or captions drawn anywhere.

COUNTS — use exactly the DISPLAYED numbers from the list, NEVER more:
- Distinct items (moon, stars, banner, hearts, "love"/letter foils, fringe curtains, confetti
  balloons): show the EXACT number. 2 stars means 2, 3 confetti means 3 — no extras to fill space.
- Plain latex balloons (the big counts): SPACE them along the garland to frame the backdrop — do
  NOT pack them densely to look fuller. Treat the numbers as caps (e.g. 15 red = no more than 17).
  A well-spaced frame at the true count, not a crowded arch.

No tape/glue/pump in the scene. Spell any foil letters exactly. A real photograph — no cartoon,
3D, flat-lay, watermark or added graphics. Output it as a square (1:1) image.
```

> **On size:** you're asking for **square (1:1)**, not an exact pixel size — 1500×1500 is not
> required from the AI (the marketplaces resize, and `npm run images -- --final` makes it exactly
> 1500² anyway). What matters is the *shape*. If ChatGPT still hands you a portrait/landscape,
> reply *"regenerate as a perfect square, 1:1"*. The tool will square whatever you give it as a
> fallback — but it does so by cropping, which can cut the decoration, so it's better to get 1:1
> from ChatGPT directly.

**Message 3 — fix a count (only if you spot one — you write this yourself).**
Look at the result and count the distinct items against the pack. If something is off, tell it
exactly what you see; nothing else changes. This is *your review line*, not a fixed one:

```
Keep everything exactly the same, only fix the count: there are exactly <N> <item> — remove the
extra(s).
```

Examples you'd type: *"4 confetti but there are 3 — remove one"*, or *"the garland looks too
full — use fewer balloons"*. Only send it when a real miss is worth one more generation.

> ⚠️ **Before accepting any output, check two things.** (1) **No ✦ sparkle watermark** — if there
> is one, you used the Gemini *app*; ChatGPT and **aistudio.google.com** don't add it. (2) **No
> leftover Meesho tag/code** anywhere. If either slips through: regenerate, or fix it with the
> tool — `npm run images -- --erase-tag=150,30`.

**Fuller-room / lifestyle variant** — for *supporting* images 3–5 ONLY. **Never for image 1.**
Add to Message 2: *"place it in a warm, softly-lit living room with a little visible furniture
edge, no people, shallow depth of field on the background only — the decoration and its counts
stay exactly the same."*

> ⚠️ **No props in image 1 — the frame holds the pack and the bare wall, nothing else (C-026,
> C-031).** Two separate incidents, one week apart. First, a staged room shot for ANP-1 put
> curtains in the background and the field-writing AI read them as pack contents, inventing
> "2 red curtain backdrops" into a kit that has none. Then a briefly-relaxed `SETTING` — which
> allowed "a tasteful stool or chowki" for the Annaprashan look — produced a **carved wooden baby
> chowki in a groom-to-be photo**. The model has no idea which props suit which occasion, so any
> permission gets applied everywhere.
>
> Belt and braces: `SETTING` above now bans furniture and props outright, **and** `START-HERE.md`
> tells the field-writing model that image 1 is a staged scene from which no pack item may ever be
> taken. Still worth a glance when the JSON comes back.

---

### Prompt B — the "what's in the pack" infographic

Listing image 2. **This is where text is allowed, and competitors don't use it.**

```
Create a clean "what's in the box" product infographic from IMAGE 2 for an Indian
e-commerce listing.

INVENTORY (authoritative, do not recount): <paste your typed inventory>

- Pure white background. All items laid out flat, grouped by type, evenly spaced, nothing
  overlapping, soft drop shadows.
- Label each group in the format "8 x Chrome Balloons". Simple bold sans-serif, dark grey,
  no boxes, no arrows, no decorative fonts.
- Total piece count as one line at the top: "42 Pcs Combo Kit".
- No logo, no brand name, no watermark, no price, no offer badge, no border. If IMAGE 2
  carries a seller tag or code anywhere (Meesho stamps one near the bottom-left), do not
  reproduce it — the rebuilt white background must be completely clean.
- 1:1 square at the highest resolution you can produce. Photorealistic products with flat
  graphic labels.
- Every number must exactly match the inventory. Read them back before generating.
```

> **Note: the labels here are text printed ON the picture, which shoppers read.** That is a
> completely separate thing from the metadata in Part 4 (invisible, unproven). This visible
> text is the part that reliably works.

<details>
<summary><b>Optional, only if the AI's text comes out fuzzy or misspelled — not part of the normal flow</b></summary>

Image models misrender text sometimes ("42 Pcs" → "4Z Pcs"), which is why the prompt says to
proofread every number. **Normally you just proofread and move on.**

If a particular infographic keeps coming out wrong, you can type the labels yourself instead
of having the AI draw them: lay it out in Figma / Canva / Illustrator over the photographed
items, export at **3000×3000 JPEG**, and run it through `npm run images -- --final` like any
other image. Typed text is pin-sharp and cannot misspell itself.

This is a fallback, not a step. It adds manual design work to a workflow built to remove it —
so only reach for it if the generated version actually fails you.

**Never upload the SVG/design file itself.** Vector is an authoring format, never a delivery
one. Neither platform lists SVG as accepted (high confidence, not verified in official docs),
and SVG can carry JavaScript — which is why marketplaces block user-uploaded SVG as an XSS
risk. Vector also cannot represent a photograph: tracing a product photo produces a flat
cartoon, and non-photographic depictions of real products fall foul of Meesho's authenticity
rules.

</details>

---

### Where the prompts sit in the pipeline

```
images/1-raw/<ID>/       downloads (.avif, Meesho tag on)
   │  npm run images -- --crop-bottom=N      convert · crop tag · square · 1500px
   │      (or, if your images arrive already clean: npm run finish — see THE-FLOW.md)
images/2-clean/<ID>/     ← FIRST build the images: main image (ChatGPT, 2 messages) + image 2
   │                        via Prompt B. Save them back over 1.png / 2.png (delete the old
   │                        1.jpg / 2.jpg — ONE file per number; don't rename png→jpg, same
   │                        relabelling trap as avif, --final converts it anyway).
   │  THEN describe those finals: run the START-HERE Part 3 prompt on the saved 1.png/2.png/3/4
   │  (the images you'll upload) → image-meta/<ID>.json. Descriptions must match what goes live.
   │  npm run images -- --final              square · 1500px · embed descriptions
images/3-final/<ID>/     upload these
```

**The tool runs last on purpose.** Let the model be creative; let deterministic code enforce
the spec. Same principle as the autofill bot — code enforces rules, AI only writes the
creative part.

Squaring is asked for in the build prompt (it requests a 1:1 image), with the tool's
squaring in `--final` as the guaranteed fallback. The tool is the real guarantee — the model
often ignores the aspect request, which is exactly why deterministic code runs last.

---

## Part 3 — Image SEO: what actually works

### Unlearn the website version

On your own site, image SEO = filenames, alt text, captions. On a marketplace you upload into
a form and the platform re-encodes onto its own CDN. There is no alt-text field and filenames
are discarded.

Marketplace image SEO is **CTR engineering**:

```
better main image → higher click-through on the search grid
                  → algorithm reads that as relevance → higher rank
                  → more orders → (if the image was honest) low returns
                  → high quality score → more rank
```

Keywords get you *into* results. The image decides whether you're *clicked*. Returns decide
whether you *stay*.

### Levers, by impact

1. **Legibility at thumbnail size.** Search results are a ~150px tile on a phone. Open your
   listing on mobile and squint. Fewer, bigger, well-separated items beat a dense pile.
2. **Honest piece count.** Combos are bought on "what do I get for ₹399". The image that
   communicates volume wins the click; the one that *overstates* earns the return that kills
   the listing.
3. **Images 2–7 carry the text.** The main image must be clean, but the rest can carry piece
   counts, size references, assembly steps, occasion tags. This answers the questions that
   otherwise become returns — and it is the most likely explanation for the "image
   description" tactic a competing seller reported success with.
4. **Zoom.** ≥1000px activates it on Flipkart. Below that, conversion drops.
5. **Distinctness from your partner's listing.** Same image in two catalogs = competing with
   yourself, plus duplicate-detection risk. This is the actual reason for the AI editing.
6. **One visual signature across the catalog.** Same background, light, layout. Shoppers
   recognise the next kit in the grid. Free brand recall.

### Where keywords actually go

- **Title** — `[Brand] + [Product Type] + [Occasion] + [Piece Count] + [Colour]`, 70–80
  chars, natural phrasing. e.g. `WishWorks Annaprashan Decoration Kit 42 Pcs Red Gold Balloons`
- **Attributes** — every field. This is what the Flipkart Listing Quality Score measures and
  what powers filter discovery. Cheapest ranking win available, and exactly what the autofill
  bot makes painless.
- **Description / highlights** — long-tail: "rice ceremony decoration items", "annaprashan
  banner set".
- **Meesho titles** — their search rewrite made titles heavily keyword-driven; generic names
  get buried.

### Gets you rejected or suppressed

- Text, watermark, logo or badge on the **main** image (including a Gemini sparkle)
- Below 500×500, or CMYK
- Collage as the main image
- Another seller's photo used unedited
- AI images that don't depict the real product — Meesho treats this as an authenticity
  violation: suspension territory, not a warning

---

## Part 4 — The open metadata question

**Status: unknown. Answered wrongly three times (C-008, C-016, C-019) — twice with
confidence. Do not trust anything here that isn't marked measured.**

**Measured:**
- Meesho serves `.avif` that **does carry EXIF** (Orientation, X/YResolution, ResolutionUnit,
  YCbCrPositioning) — so metadata travels through their pipeline.
- No ImageDescription in it — **but that image never had one**, so it proves nothing.
- `YCbCrPositioning` is a JPEG-domain tag inside an AVIF, suggesting the EXIF block was
  **carried over from the original upload** rather than regenerated. Weak evidence *for*
  descriptions surviving.
- Our tool's metadata is genuinely embedded — verified down to raw bytes.

**What we write** (only tags sharp verifiably writes — XPKeywords/XPTitle/XMP are silently
dropped, so we don't pretend to write them):

| Tag | Content |
|---|---|
| ImageDescription | per-image description · product name · keyword list |
| Artist | WishWorks |
| Copyright | © year WishWorks. All rights reserved. |
| Software | WishWorks Listing Factory |
| DateTime | processing time |

Artist + Copyright are Google's recommended attribution pair — if any channel does read this,
they're what earns a credit link in Image Search.

**The experiment (WW-037).** `docs/samples/METADATA-TEST-upload-this.jpg` carries the unique
marker `WISHWORKS-METADATA-TEST-XK7Q9`. **Do not upload it as-is** — it is the partner's
image with the tag still on it. Instead: run a real product through the full pipeline, upload
that, download the served `.avif`, and check whether its description survived.

Until then: free, harmless, unproven. **Don't build strategy on it.**

---

## Part 5 — Priorities

Ranked by payoff per hour.

1. **Get full-resolution source images.** 512×512 is the ceiling on everything else. Nothing
   in this document compensates for a soft main image.
2. **Fix the counts, not the pixels.** Step 0 plus a 20-second manual check. Protects the one
   metric — returns → quality score — that can't be recovered once damaged.
3. **Own image 2 as the contents infographic.** Most balloon listings show only pretty
   decoration shots and never what you actually receive. Easiest differentiation available,
   directly reduces returns, converts.
4. **Fill every attribute field.** The ranking reason to care about the autofill bot, beyond
   time saved.
5. **Lock one visual signature.** Same background, light, layout in every prompt. Compounds.
6. **Shoot your own kits.** Even one phone session on a white bedsheet by a window gives
   original assets, kills duplicate-detection risk permanently, and gives the AI a better
   base. AI-editing someone else's photos is right for speed today, not for a year from now.
7. **Measure.** Log which image style each SKU launched with; compare CTR in Seller Hub after
   2–3 weeks. Two variants of one kit beats every blog listed below.

---

## Sources

**Official** (thin — platforms publish little):
- [Flipkart Seller Hub — image guidelines](https://seller.flipkart.com/sell-online/image-guidelines-and-image-uploading)
- [Meesho — single catalog upload](https://supplier.meesho.com/learning-hub/lessons/how-to-list-your-catalog-using-single-upload)
- [Meesho — bulk catalog upload](https://supplier.meesho.com/learning-hub/lessons/how-to-list-your-catalogs-using-bulk-uploads)
- **The category Excel template's "Guidelines" sheet** from the Supplier Panel — category-specific
  and current. **Outranks everything else here.** Still not collected (WW-022).

**Third-party** — useful, but they contradict each other and have been wrong three times:
- [Flipkart listing rules](https://www.loharstudio.com/blog/flipkart-listing-guidelines-product-requirements-photo-rules) ·
  [Meesho listing rules](https://www.loharstudio.com/blog/meesho-listing-guidelines-image-size-rules-rejection-reasons) ·
  [2026 cross-platform specs](https://remove-bg.io/blog/flipkart-meesho-myntra-seller-image-guide-2026/)
- [Meesho quality score](https://www.digicommerce.in/blog/how-to-improve-meesho-catalog-quality-score/) ·
  [Meesho algorithm](https://infobeamsolution.in/meesho-algorithm-for-sellers/) ·
  [Flipkart ranking](https://qbitecommerce.com/how-to-optimize-flipkart-product-listings-for-maximum-visibility/)

Full history of what was claimed, what was wrong, and how it was caught:
[`tracks/notion/CORRECTIONS.md`](tracks/notion/CORRECTIONS.md).

---

## Archive — superseded prompts, kept for reference

Not deleted on purpose — if the current "read the pack → build it" method ever fails a product,
these show what we tried before and why we moved on. **Do not use these as the default.**

<details>
<summary><b>Superseded v2 — "edit the existing photo, keep the arrangement" (the version before the read→build flow)</b></summary>

Fed BOTH images plus a typed inventory, and asked the model to *edit image 1* (keep the assembled
arrangement, restyle only the wall/lighting). It worked, but had two problems in practice
(see C-020 and the turns after it): (1) with an already-good source it returned a near-identical
image — good for accuracy, but no visible distinctness; and (2) the readback guard could make the
model refuse. The read→build-from-the-contents-sheet flow above replaced it because it gives a
genuinely fresh arrangement while still grounding counts in the real pack.

```
You are editing a real product photo for an Indian party-decoration seller (Flipkart / Meesho).
This is a DECORATION KIT. The main image must show the buyer how it looks once SET UP on a wall.
Do NOT turn it into a plain white-background flat-lay; that is image 2.

IMAGE 1 = the current photo of the decoration already set up. This is the one you edit.
IMAGE 2 = reference ONLY, showing each item up close.

INVENTORY (authoritative — do not recount or adjust): <paste your typed inventory here>

KEEP THE ASSEMBLED DECORATION — keep the garland/arch, banner, backdrop, props in place. Do NOT
break balloons into bunches, lay items flat, or strip to a white void.
DO NOT CHANGE any colour, printed/banner text, foil shape, count, letter or sticker. If IMAGE 1
and IMAGE 2 disagree (e.g. the banner), follow IMAGE 2. Add nothing not in the inventory.
YOU MAY CHANGE the wall/backdrop colour, lighting, camera angle; tidy clutter. Keep a believable
room, not a cutout on white.
REMOVE any watermark / seller tag / code and rebuild behind it.
OUTPUT a photorealistic 1:1 square, decoration filling most of the frame, sharp lettering.
BEFORE GENERATING (a check, not a blocker): list the inventory back, flag anything you can't see,
then wait for me to reply "go" — do not refuse, do not invent.
```
</details>

<details>
<summary><b>Superseded v1 — "clean white studio flat-lay" (the original, wrong for decoration kits)</b></summary>

The very first Prompt A ordered a *near-white studio backdrop* and told the model to *cluster the
balloons* and *group items along the lower area*. On a decoration kit this destroyed the assembled
look that sells the product, turning every hero shot into a parts flat-lay on white. This is the
mistake logged as **C-020**. Kept only as a record of what not to do; the exact text lives in that
correction entry and in git history.
</details>

---

### Step 0b — the old standalone per-image description prompt (superseded 2026-07-25)

> Replaced by the merged prompt in `guides/START-HERE.md` Part 3, which produces these
> descriptions *and* the Flipkart fields in one pass. Kept only for the description rules it
> encodes. **Do not run it** — you would end up with two different sets of descriptions.

> **Now merged.** The per-image descriptions are produced by the **single prompt in
> `guides/START-HERE.md` Part 3** — one conversation returns both the `image-meta` descriptions
> and the Flipkart `products` fields from the same photo upload + Excel inventory. Use that prompt.
> The standalone version below is kept only as reference for the description rules it encodes (and
> for a Meesho-only run where you don't want the Flipkart half — though START-HERE's `image-meta`
> half alone covers that too).

Upload **all** images for the product, in order, from `images/2-clean/<ID>/`, and paste your
inventory text along with the prompt.

```
You are a product cataloguer for an Indian party-supplies seller (balloons, foil letters,
banners, decoration kits).

I am uploading all the photos for one product listing, in order.
IMAGE 1 is the decorated/hero shot. IMAGE 2 shows the complete pack contents.
Any further images are additional views of the same product.

INVENTORY (authoritative — I packed this kit. Use these exact items and counts. Do not
recount from the photos, do not adjust, do not add anything not listed):
<paste your Step 0a inventory text here>

Write one description for EVERY image I uploaded. Return ONLY this JSON:

{
  "images": {
    "1": "",
    "2": ""
  },
  "not_visible": [""]
}

- "not_visible": any inventory item you cannot actually find in any photo. Leave empty if
  everything is there. This is a check on me, not on the list — flag it, don't fix it.
  Go through the inventory one line at a time. A pack-contents photo is often a SINGLE
  COMPOSITE IMAGE of several labelled sub-panels — read every sub-panel and caption,
  including small corner ones. Setup aids (balloon pump, arch tape, glue dots, LED light)
  sit in a corner panel and never appear in the decorated hero shot, because they are not
  decoration — that is expected, not a flag. Only list an item if it is missing from the
  contents photo too. A false entry here is worse than an empty list.

DESCRIPTION RULES ("images")
- One key per image I uploaded ("1", "2", "3", "4" — as many as there are).
- 150-250 characters each. Write a full, informative sentence, not a label.
- Describe what is ACTUALLY VISIBLE in THAT specific image. They must not be
  interchangeable — a reader should be able to tell which photo each line refers to.
    "1" = the decorated arrangement as set up, naming the main colours and hero pieces
    "2" = the pack contents laid out. MUST open with the total piece count as a number —
          sum every inventory count, e.g. "All 69 pieces laid out: …". Never "the full
          pack" or "multiple items". Then name the main groups with their own counts.
    "3", "4", … = whatever that image genuinely shows (close-up, angle, in-use)
- Each description must naturally include, where true and visible:
    the occasion (birthday / annaprashan / anniversary / baby shower / groom-to-be),
    the product type ("decoration kit", "balloon combo"),
    the dominant colours,
    the main materials (latex, foil, chrome, confetti),
    the piece count for image 2.
- Natural shopper language. Full sentences. No keyword stuffing, no marketing slogans
  ("stunning", "must-have"), no invented items, no claims you cannot see.
```

**The counts come from your Step 0a text, not from the AI.** A wrong count becomes a return,
which becomes a rating, which becomes lost ranking — so this is the one number never left to
a model.

**Where the output goes:**

```json
{
  "category": "balloon-decoration",
  "images": {
    "1": "Annaprashan rice ceremony decoration kit set up as a wall backdrop in red and gold, with a Shubh Annaprashan banner, chrome balloons and confetti balloons.",
    "2": "All 42 pieces of the Annaprashan decoration kit laid out flat — latex and chrome balloons, the banner, arch tape and glue dots."
  },
  "values": { "Model Name": "…", "Search Keywords": ["…"] }
}
```

Save as **`image-meta/<ID>.json`** — a marketplace-agnostic file holding only picture
descriptions:

```json
{
  "title": "Annaprashan Decoration Kit 65 Pcs",
  "keywords": ["annaprashan decoration items", "rice ceremony decoration"],
  "images": { "1": "…", "2": "…" }
}
```

`npm run images -- --final` reads it and writes each line into that specific image. Missing
positions fall back to title + keywords, and the tool says which ones did.

**Kept separate from `products/<ID>.json`**, which holds the 66 Flipkart listing fields.
Meesho has no such form, so a Meesho-only product needs the `image-meta/` file and nothing
else. (For older products that kept everything in one file, `products/<ID>.json` is still
read as a fallback.)

Keep your inventory text too — it feeds the pack-contents and highlights fields for the
autofill bot, and it's your cross-check against the list the AI reads back in Message 1 of the
main-image flow below.

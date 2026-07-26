# WishWorks — Flipkart listing filler

Filling a new Flipkart listing means typing ~66 fields by hand, per product. This types
them for you. You still review and click Save — nothing goes live without a human.

**You need no programming knowledge to use this.** Two things happen each time:

1. You give an AI (Claude or Gemini) the product photos → it writes a small file.
2. You run one command → it fills the Flipkart form from that file.

---

## Part 0 — One-time setup (about 10 minutes, once ever)

Open the **Terminal** app and type these, pressing ENTER after each:

```bash
cd "<the folder this project is in>"/flipkart-autofill
npm install
npx playwright install chrome
npm run login
```

The last one opens a Chrome window. Log in to Flipkart Seller Hub as you normally would
(OTP included). **You never have to log in again** — it remembers.

> If a command fails, copy the whole red message and send it to whoever set this up.
> Nothing here can damage your listings; the worst case is it does nothing.

---

## Part 1 — Make the product file (using AI)

> **Do this AFTER you've made the images.** Generate the AI pictures first (main image +
> Prompt B infographic — see `image-playbook.md`), because this step **describes the images you
> will actually upload**. Describing the originals would put the wrong description on the final
> picture.

Open **Claude** (claude.ai) or **Gemini**. Then give it three things and send:

1. **The final product images** — the exact pictures you'll upload (the AI-built main image, the
   Prompt B "what's inside" infographic, and your other photos), in order.
2. **Your inventory rows, pasted from Excel** — `category / specific material / number`,
   exactly as they copy. This is where the **counts** come from, so you never hand-type them
   and the AI never has to guess. Example of what you paste:
   ```
   Banner    Annaprasan banner                    1
   Balloon   GOLDEN BALLOONS                      15
   Balloon   WHITE BALLOONS                       15
   Foil      Heart foil                           4
   Kit       Annaprasan with props kit complete   1
   ```
3. **The whole prompt from Part 3 below.**

The AI replies with **one JSON that has two halves** — `"products"` and `"image-meta"`. You
save each half into its own file, both named after the product ID (e.g. `ANP-1`):

1. Copy the inside of **`"products"`** (the `{ "category": …, "values": … }` object) → save as
   **`products/ANP-1.json`**. This is what fills the Flipkart form.
2. Copy the inside of **`"image-meta"`** (the `{ "title": …, "keywords": …, "images": … }`
   object) → save as **`image-meta/ANP-1.json`**. This is the picture descriptions, used by
   **both** Meesho and Flipkart images.

> **A Meesho-only product** needs just the `image-meta` file — there's no 66-field form on
> Meesho. A Flipkart product needs both.

That's the only typing you do — everything else is copy, paste and review.

---

## Part 2 — Fill the form

In Terminal:

```bash
cd "<the folder this project is in>"/flipkart-autofill
npm start
```

It will:

1. **Show a numbered list of your products.** Type the number, press ENTER.
2. **Open Chrome.** Go to `Listings → Add New Listing → your category`, open the
   **Additional Description** tab, scroll to the bottom once, leave it on screen.
3. Come back to Terminal, press ENTER. It types everything.
4. Show you a result, and offer to click Save.

Then **switch Chrome to the "Price, Stock and Shipping" tab and run `npm start` again**,
same product. Each run fills only the tab you're looking at. Two runs = one listing.

> ⚠️ **Not yet proven:** the Additional Description tab is tested and working. The
> Price/Stock/Shipping tab has never been run against the real form — those field names
> came from an older script. Expect some ⏭️ or ⚠️ there on the first try, and send the
> result to your developer. Don't let it save until that run comes back clean.

### Reading the result

| Symbol | Meaning | What to do |
|---|---|---|
| ✅ | Typed, and checked it actually landed | Nothing |
| ⏭️ | Belongs to the *other* tab | Nothing — normal |
| ⚠️ | Typed, but the form shows something else | Look at that field in Chrome |
| ❌ | Couldn't type it at all | Send the message to your developer |

If anything is ⚠️ or ❌, it **will not save automatically**. That's deliberate.

### Two rules that matter

- **Never close Chrome before saving.** Nothing is saved until you click Save. Closing
  the window throws away everything it typed.
- **No commas in list-type values.** Flipkart treats a comma as "next value", so
  `"Good for birthdays, weddings"` becomes two entries. The tool refuses to run if it
  finds one, and tells you which line to fix.

---

## Part 3 — THE PROMPT (copy everything in the box)

Upload **all** the product images (in order, image 1 first), paste your **inventory rows from
Excel** where marked, then paste this whole box into Claude or Gemini.

````text
You are preparing ONE product for WishWorks, an Indian seller of balloons and party
decoration items, to list on Flipkart and Meesho. I am giving you TWO things:

(a) ALL the product photos, uploaded in order. IMAGE 1 is the decorated/hero shot,
    IMAGE 2 shows the full pack contents, any further images are extra views.
    IMPORTANT — IMAGE 1 IS A STAGED SCENE, often AI-generated. It deliberately contains
    background and setting that I am NOT selling: room walls, curtains, drapes, stools,
    tables, furniture, cushions, plants, floor, cake, food, string lights that are part of
    the room, people and babies. NONE of that is in the pack. Never take a pack item, a
    material or a "Decoratives Attached" entry from something you see in IMAGE 1. If an
    item is not in the INVENTORY, it does not exist, no matter how clearly you can see it.
    IMAGE 1 tells you colour, mood and how the kit looks set up — nothing about contents.
(b) an INVENTORY table exported from my stock sheet. I packed this kit, so the inventory
    is the AUTHORITATIVE list of what is in the pack and how many.

INVENTORY (category / specific material / number — use these exact items and counts.
Do NOT recount from the photos, do NOT adjust, do NOT add anything not listed):
<PASTE YOUR EXCEL ROWS HERE>

Return ONLY one JSON object — no explanation before or after, no markdown fences — with
exactly these THREE parts:

{
  "products": {
    "category": "balloon-decoration",
    "values": { "Model Name": "...", ... }
  },
  "image-meta": {
    "title": "<same text as products Model Name>",
    "keywords": [<same list as products Search Keywords>],
    "images": { "1": "", "2": "" },
    "not_visible": [""],
    "meesho": {
      "title": "",
      "description": "",
      "pack_contents": ""
    }
  }
}

WHERE EACH PART COMES FROM
- "products.values" = the Flipkart listing fields. The COUNTS, materials and items come
  from the INVENTORY, never from re-counting the photos. Use the photos only to confirm
  colour, shape, finish and printed/banner wording.
- "image-meta.images" = one description PER uploaded photo, written by LOOKING at that
  specific photo (see the description rules below).
- "image-meta.title" must equal products Model Name; "image-meta.keywords" must equal
  products Search Keywords (do not write two different versions).
- "image-meta.meesho" = the copy I paste by hand into the Meesho Supplier Panel. This is
  DIFFERENT text from the Flipkart fields and from image-meta.title — Meesho and Flipkart
  rank on different things, so do not copy one into the other. See its own section below.
- "image-meta.not_visible" = any inventory item you cannot find in ANY photo. Leave empty
  if all are present. This flags a mismatch for me — do not fix it, just report it.
  Work through the INVENTORY one line at a time and search every photo for that line
  before you decide. A pack-contents photo is often a SINGLE COMPOSITE IMAGE made of
  several labelled sub-panels — read every sub-panel and every caption in it, including
  small corner panels. Setup accessories (balloon pump, arch tape, glue dots, LED light)
  are usually grouped in one small corner panel and are easy to miss. Setup aids will
  never appear in the decorated hero shot (IMAGE 1) because they are not decoration —
  that is expected and is NOT a reason to list them. An item is only "not visible" if it
  is missing from the pack-contents photo as well. A false entry here is worse than an
  empty list: it sends me looking for a problem that does not exist.

=== HARD RULES ===
1. Counts and pack contents come ONLY from the INVENTORY. Never invent a fact; if unsure
   of a field, LEAVE IT OUT. A missing field is fine; a wrong field gets the listing
   rejected by Flipkart's quality check.
2. NO COMMAS anywhere inside any list value. Flipkart splits list values on commas. Use
   "and" or a dash instead. This is the single most common mistake — check every line.
   (Commas ARE allowed in the free-text "Description" and in image descriptions.)
3. Values written as ["a", "b"] are lists — one idea per entry. Values written as "text"
   are single values.
4. Do not put the brand name "WishWorks" in Model Name.
5. Write for an Indian shopper searching on a phone. Plain, concrete, no marketing fluff
   like "elevate your celebration". Say what is in the box and what it is for.

=== products.values — FIELDS TO FILL ===

Identity
  "Model Name"   – short descriptive name, under 128 characters, no brand name.
                   e.g. "Red Rose Anniversary Decoration Kit"
  "Pack of"      – number of units sold as one, usually "1"
  "Series"       – product line, e.g. "Classic" / "Premium"
  "Design"       – what it looks like, e.g. "Heart Shaped Foil Balloons with Rose Garland"

Lists (arrays — no commas inside any entry)
  "Ideal For"            – from: Boys, Girls, Men, Women
  "Material"             – from: Latex, Foil, Paper, Plastic, Fabric, Rubber
  "Theme"                – e.g. ["Red and White", "Anniversary"]
  "Occasion"             – from: Birthday, Anniversary, Baby Shower, Wedding,
                           Bachelorette Party, Festival, Housewarming
  "Purpose"              – usually ["Decoration"]
  "Character"            – ONLY wording actually PRINTED on an item in the photos, quoted
                           as printed, e.g. ["Happy Birthday"]. Do NOT put the occasion or
                           ceremony name here unless those exact words are printed on
                           something. If nothing is printed, leave the field out.
  "Decoratives Attached" – extras included, e.g. ["Banner", "Arch Strip", "Garland"]
  "Balloon Type"         – every KIND of balloon in the pack, not just the main one.
                           Metallic/chrome latex balloons and foil balloons are different
                           types — a pack with both needs both, e.g. ["Metallic", "Foil"].
  "Key Spec"             – 3 short specs, each a COUNT or a MEASUREMENT, e.g.
                           ["50 Balloons", "12 inch", "Red and White"]. Never a slogan —
                           "Complete Decoration Kit" is not a spec.
  "Key Features"         – 4 to 6 selling points, each one short line, NO COMMAS
  "Search Keywords"      – 6 to 8 phrases a real Indian buyer would type into Flipkart
                           search. Include the occasion and the colour. Think
                           "birthday decoration items", not "premium party solutions".
  "Precautions"          – safety warnings, e.g. ["Keep away from fire"]
  "Safety Features"      – e.g. ["Non-toxic"]

Single values
  "Shape"        – ONE value from the form's dropdown, e.g. "Round" / "Heart" / "Star".
                   If the pack has several shapes, pick the dominant one.
  "Description"  – 5 to 8 sentences, under 5000 characters. Cover: what is in the pack
                   with exact counts (from the INVENTORY), what it is made of, which
                   occasions it suits, and how easy it is to set up. Commas allowed here.
                   It must account for EVERY line of the INVENTORY, including the
                   unglamorous ones — pump, arch tape, glue dots, LED light. An item the
                   buyer is paying for and cannot read about is a wasted selling point.
                   Give counts for accessory groups too ("16 printed cutouts"), never
                   "a complete props kit".

Yes/No dropdowns — answer exactly "Yes" or "No"
  "Hand Crafted", "Gift Pack", "Foldable", "Carry Bag Included", "Birthday Ribbon"
  "Foldable" applies to the pack as a whole: answer "Yes" only if the MAIN product folds
  flat for storage and reuse. A balloon-led kit is "No" even though its banner folds —
  a partial "Yes" here earns nothing and invites a return claim.

Size of the product (numbers only, in inches)
  "Width", "Height", "Depth", "Diameter"
  "Weight"  – in kilograms, e.g. "0.16"

=== image-meta.images — DESCRIPTION RULES ===
- One key per image I uploaded ("1", "2", "3", "4" — as many as there are).
- 150-250 characters each. A full informative sentence, not a label. They must NOT be
  interchangeable — a reader should be able to tell which photo each line describes.
    "1" = the decorated arrangement as set up, naming the main colours and hero pieces.
    "2" = the pack contents laid out. It MUST open with the total piece count as a
          number — add up every count in the INVENTORY and write the sum, e.g.
          "All 69 pieces laid out: …". Not "the full pack", not "multiple items", not
          "all the contents". A number, or this description is wrong.
          Then name the main groups with their own counts.
    "3", "4", … = whatever that image genuinely shows (close-up, angle, in-use).
- Include, where true and visible: the occasion, the product type ("decoration kit",
  "balloon combo"), the dominant colours, the main materials (latex, foil, chrome), and
  the piece count for image 2.
- Natural shopper language. No keyword stuffing, no slogans, no invented items.

=== image-meta.meesho — THE COPY I PASTE INTO THE MEESHO SUPPLIER PANEL ===

Act as an experienced Meesho catalogue seller. Meesho does NOT read image metadata, so
unlike Flipkart, everything Meesho knows about this product comes from the product name
and the description text. Search ranking and click-through both hang on this section.

Write for the Meesho buyer specifically: price-conscious, on a phone, scrolling a grid of
near-identical thumbnails, deciding in about a second. That is a different reader from the
Flipkart shopper, which is why this text is NOT a copy of the Flipkart fields.

"meesho.title"
  TARGET 70-95 characters. Treat 120 as the ceiling.
  Structure, in this order:
     <product type>  <main colours>  <occasion>  <differentiator>  (Set of N Pcs)
  Example:
     "Annaprashan Decoration Kit Red Golden Balloons Banner Cutouts LED Light (Set of 69 Pcs)"
  Rules:
  - IT MUST END WITH THE PIECE COUNT IN BRACKETS: "(Set of 69 Pcs)", or "(Pack of 69 Pcs)".
    Always in brackets, always at the very end, always a numeral, and the number must be the
    INVENTORY total — the same figure the image "2" description opens with. This is a
    convention Indian marketplace buyers scan for, and it is a direct instruction from the
    seller. It is not optional and it does not move somewhere else in the title.
  - THE FIRST 40 CHARACTERS MUST WORK ALONE. Meesho cuts the name off under the thumbnail
    on a phone, so the exact search phrase goes first. Everything after character 40 is a
    bonus, not the hook. Do NOT repeat the piece count up front — it already has its
    reserved place in the brackets at the end, and repeating it wastes characters.
  - Open with the exact words a buyer types. "Annaprashan Decoration Kit", never
    "Premium Celebration Ensemble". Match the query, don't be clever.
  - No brand name — nobody searches "WishWorks", so it is wasted characters.
  - No ALL CAPS. No emoji. No symbols like * | # % @. No "best", "cheapest", "premium
    quality", "100% original", "free delivery", "lowest price". No price. These read as
    spam and are a common reason catalogues get rejected.
  - Do not repeat a keyword to game the search. It costs characters you need and Meesho
    ranks readable titles.
  - Every single word must be one a buyer would either search for or want to read.

"meesho.description"
  TARGET 600-900 characters. NEVER one solid paragraph — use short lines.
  Only the first line or two are visible before the buyer taps "read more", so the whole
  offer has to land there.
  Use this shape exactly:
     Line 1   One sentence naming the product, the piece count and the occasion. It must
              sell on its own, with nothing below it.
     (blank)
     "What you get:" then ONE SHORT LINE PER ITEM GROUP, each with its count, taken from
              the INVENTORY. Every inventory line must appear here.
     (blank)
     "Perfect for:" then 3-5 occasions this genuinely suits. More query surface, and it
              helps the buyer picture using it.
     (blank)
     One or two plain lines on setup, material or reusability — only if true.
  Rules:
  - The main search phrase should appear 2-3 times across the whole description, only
    where it reads naturally. More than that is stuffing, and it reads as spam.
  - Facts only, every one from the INVENTORY. No guarantees, no delivery or return
    promises, no MRP, discount or price talk, and never a phone number, email, website
    or social handle. Any of those can get the catalogue rejected outright.
  - Commas are fine here. Emoji are not.
  - State the material and rough size if the INVENTORY gives them.

"meesho.pack_contents"
  ONE single clean line listing everything in the pack with counts, for the panel's
  "what is in the packet" field.
  - Format: "40 Metallic Balloons - 16 Printed Cutouts - 8 Heart Foil Balloons - 1 Banner"
  - Separate items with " - " (space hyphen space). NO COMMAS.
  - Taken from the INVENTORY and nothing else.
  - COLLAPSE ALL WHITESPACE. My inventory is pasted straight out of Excel and arrives full
    of stray spaces, tabs, line breaks, double spaces and trailing blanks. Output exactly
    ONE space between words, no leading or trailing space, and NO line break anywhere in
    this value. It has to be a single clean line I can copy directly into the panel.
  - The counts here must add up to the same total you used in the image "2" description.

=== LEAVE THESE OUT OF products.values ALWAYS ===
This Flipkart category is shared with hand fans, party blowouts, crackers and
battery-powered toys. These fields exist on the form but do NOT apply to balloons and
decoration. Never include them:
Handle, Handle Shape, Handle Material, Hand Fan Type, Animal Type, Guardstick Material,
Rib Material, Leaf Material, Leaf Shape, Printed Text, Other Hand Fan Features,
Mouthpiece Material, Tube Shape, Tube Material, Other Blowout Features, Burn Time,
Visual Effects, Sound Features, Cracker Type, Other Cracker Features, Powered by,
Power Requirement, Type of Batteries, Number of Batteries, Other Power Features.

=== ALREADY SET FOR EVERY PRODUCT — only include if THIS product differs ===
Warranty fields, Country of Origin, HSN code, tax, manufacturer and packer details,
stock and shipping settings are already configured. Do not include them.

=== BEFORE YOU ANSWER, CHECK ===
- Do all counts and items match the INVENTORY exactly?
- Does any list value contain a comma? Remove it.
- Did you invent a size or material you cannot see? Remove that field.
- Is there one image-meta description per uploaded photo, each clearly about that photo?
- Does the image "2" description start with the total piece count as a NUMBER?
- Does the Description mention every single INVENTORY line, accessories included?
- Is EVERY item you named as pack contents actually on the INVENTORY list? Anything you
  took from the staged scene in IMAGE 1 — a curtain, a stool, lights, furniture — must
  come out of Model Name, Design, Decoratives Attached, Material and Description.
- For each item you put in "not_visible": did you check every sub-panel of every photo,
  including the contents photo? Remove anything you can actually find.
- Is every entry in "Character" wording that is genuinely printed on an item?
- Does "Balloon Type" cover every kind of balloon in the pack?
- Is Model Name free of the word WishWorks, and does image-meta.title match it?
- Does the Meesho title END with the piece count in brackets — "(Set of 69 Pcs)" — using
  the INVENTORY total, and is that number the same one the image "2" description opens with?
- Is the Meesho title 70-95 characters, and do its FIRST 40 carry the search phrase alone?
- Is the Meesho title free of the brand name, ALL CAPS, emoji, symbols and every
  promotional word ("best", "premium quality", "free delivery", any price)?
- Is the Meesho description laid out in short lines with "What you get:" and
  "Perfect for:", rather than one paragraph?
- Does the Meesho description contain no phone number, email, website, social handle,
  guarantee, delivery promise or price?
- Is meesho.pack_contents ONE line, separated by " - ", with no commas, no line breaks
  and no double spaces anywhere?
- Do the counts in meesho.pack_contents add up to the same total as the image "2"
  description?
- Is it valid JSON, with every quote and bracket closed?
````

### After the AI replies

Give it a quick read — you know the product better than it does. Two checks:
- **Counts and items** should match your Excel inventory exactly (they should, since the AI was
  told to copy them — but confirm). If `not_visible` lists anything, an inventory item isn't
  shown in your photos: decide whether to add a photo or drop the item.
- **Colours** against the photos — the one thing the AI still reads from the images.

Then split the reply into its two files: `products/<ID>.json` (the `products` half) and
`image-meta/<ID>.json` (the `image-meta` half, `meesho` block included).

**For the Meesho listing**, open `image-meta/<ID>.json` and copy the three values out of its
`meesho` block into the Supplier Panel by hand — `title`, `description`, `pack_contents`.
Nothing automates this yet; Meesho has no public API.

> **Check the character limits once, in the panel.** The 70-95 / 120 title target above comes
> from third-party seller-service blogs, **not** from Meesho's own documentation — we could not
> find an official figure, and no source at all states a description limit. The Supplier Panel
> field itself is the real authority: paste a title in once, watch its counter or its rejection,
> and if it disagrees with this guide, **the panel wins** — tell Claude the real number and
> correct this file. The targets here are deliberately conservative so they are safe under every
> figure we found.

---

## Part 4 — When something goes wrong

| What you see | What it means |
|---|---|
| `Not logged in` | Run `npm run login` and log in again |
| Everything says ⏭️ | You're on the wrong tab in Chrome, or on the dashboard |
| `Refusing to run — comma` | Fix the listed line in your product file, remove the comma |
| A field is ⚠️ every time | The field name changed on Flipkart's side — developer job |
| Chrome won't open | Close every Chrome window and try again |

For a developer: `HANDOFF.md` has the technical detail, and `npm run verify` checks the
engine in ~2 seconds without touching Flipkart.

---

## Part 5 — What's next (Phase 2): learn from the 2,200 existing listings

We already have ~2,200 live listings created by hand. They are the best training data we
have, and right now we throw that knowledge away on every new product.

The plan, in order:

1. **Export them.** Flipkart's API *can* read existing listings (it just can't create new
   products). Pull all 2,200 with their attributes, titles, keywords and current sales.
2. **Build a keyword bank per category.** Which search keywords appear in the listings
   that actually sell? That becomes a real, evidence-based list instead of the AI guessing
   phrases.
3. **Learn the defaults.** For each category, find the attribute values used most often
   and generate the `categories/<name>.defaults.json` files automatically, instead of
   writing them by hand as we did for balloons.
4. **Feed the prompt.** Insert the keyword bank and the known-good values into the Part 3
   prompt, so the AI picks from what has worked rather than inventing.
5. **Flag the weak listings.** The same data shows which existing listings are missing
   attributes or keywords — a ranked to-do list of fixes worth more than new listings.

Rough order of value: step 2 pays for itself fastest, step 3 removes the most manual work,
step 5 is where the existing catalogue starts earning more without new products.

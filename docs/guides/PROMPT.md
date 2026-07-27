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

ANSWER IN ONE MESSAGE, IN THREE LABELLED SECTIONS, IN THIS ORDER. Print each divider line
exactly as written — they are how I find where to cut. Nothing before section 1, nothing
between the sections except the dividers, nothing after section 3. No commentary, no
markdown fences, no closing offer to help.

Before you write anything, decide "Model Name" and "Search Keywords" first — section 1
copies both of them, so they have to exist before section 1 can be correct.

══════ SECTION 1 — IMAGE METADATA — save as image-meta/<ID>.json ══════

{
  "title": "<same text as Model Name in section 2>",
  "keywords": [<same list as Search Keywords in section 2>],
  "images": { "1": "", "2": "" },
  "not_visible": [""],
  "meesho": {
    "title": "",
    "description": "",
    "pack_contents": ""
  }
}

══════ SECTION 2 — FLIPKART LISTING FIELDS — save as products/<ID>.json ══════

{
  "category": "balloon-decoration",
  "values": { "Model Name": "...", ... }
}

══════ SECTION 3 — PASTE BLOCK — copy by hand, do not save ══════

(described at the end of this prompt)

Each of the first two sections is ONE complete standalone JSON object that I save straight
to that filename. Do not wrap them in an outer object, do not put them both in one object,
and do not add a key that is not shown above — either file has to parse on its own.

WHERE EACH PART COMES FROM
- section 2 "values" = the Flipkart listing fields. The COUNTS, materials and items come
  from the INVENTORY, never from re-counting the photos. Use the photos only to confirm
  colour, shape, finish and printed/banner wording.
- section 1 "images" = one description PER uploaded photo, written by LOOKING at that
  specific photo (see the description rules below).
- section 1 "title" must equal section 2 Model Name; section 1 "keywords" must equal
  section 2 Search Keywords (do not write two different versions).
- section 1 "meesho" = the copy I paste by hand into the Meesho Supplier Panel. This is
  DIFFERENT text from the Flipkart fields and from section 1 "title" — Meesho and Flipkart
  rank on different things, so do not copy one into the other. See its own section below.
- section 1 "not_visible" = any inventory item you cannot find in ANY photo. Leave empty
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
5. Write for an Indian shopper searching on a phone. Concrete over clever: say what is in
   the box, what it is for, and what the buyer gets out of it. This does NOT mean flat and
   dull — the "Description" field has its own template below and it is allowed to sell.
   What is banned is the EMPTY claim, the kind with nothing behind it: "elevate your
   celebration", "unmatched quality", "transform your space". Every sentence must survive
   the question "how would a buyer check that?"
6. BANNED WORDS — unverifiable quality claims. Never use these anywhere, in any field:
   "premium", "elegant", "luxury", "royal", "exclusive", "best", "cheapest", "finest",
   "100% original", "guaranteed", "high quality", "superior". Rule of thumb: if a word
   describes how GOOD something is rather than WHAT IT IS, leave it out. "Elegant" was
   flagged on a real listing. A closed list — these are the whole set.

7. BRAND COLLISION — the trap no word list can ever cover, so learn the pattern instead.
   The marketplace automatically checks every phrase against registered brand names and
   rejects anything that merely RESEMBLES one. On a real listing it flagged "Golden Star":
     "This keyword is similar to brand 'Golden Star'. Please change it."
   That is an ordinary colour next to an ordinary shape. There is no way to know which
   combinations are already taken, and there are thousands — so do not try to memorise a
   list, follow this rule everywhere:

   NEVER leave a colour or quality word sitting directly in front of a noun as a bare
   two-word pair. That is the shape a brand name has, and it is what trips the checker.
   ALWAYS put the shape, material or function word in between, so the phrase can only read
   as a description:

     "Golden Star"          → "Star Shape Gold Foil Balloon"
     "Silver Crown"         → "Crown Shape Silver Foil Balloon"
     "Royal Purple"         → "Purple Colour Decoration Set"
     "Golden Curtain"       → "Gold Colour Fringe Foil Curtain"
     "Black Magic"          → do not write it at all

   The expanded form is also what buyers actually type, so this costs nothing in search and
   removes the risk. Applies to EVERY field without exception: Model Name, Search Keywords,
   Key Spec, Key Features, Decoratives Attached, Theme, Design, Description, and all three
   Meesho values.

   Before you answer, re-read every phrase you wrote and ask of each one: "could this be
   somebody's company name?" If yes, expand it using the pattern above. Prefer the boring
   descriptive phrase every time — it is the one that survives review.

=== products.values — FIELDS TO FILL ===

Identity
  "Model Name"   – Flipkart does NOT let me type a title. It BUILDS the title from
                   Brand + Model Name + other attributes, so Model Name is the only part of
                   the title I control. Write it as a title, not as a label.
                   TARGET 80-120 characters. 128 is the ceiling.
                   Structure, in this order:
                     <product type> <theme/colours> <hero items> for <occasion> (Set of N Pcs)
                   Example:
                     "Groom To Be Decoration Kit Black Gold Foil Banner Sash Star Balloons
                      Curtain for Bachelor Party (Set of 44 Pcs)"
                   Rules:
                   - THE FIRST 60 CHARACTERS MUST WORK ALONE — that is what a phone shows in
                     the search grid. The exact phrase a buyer types goes first.
                   - End with the piece count in brackets, same INVENTORY total used everywhere
                     else: "(Set of 44 Pcs)".
                   - No brand name. No ALL CAPS, no emoji, no | / * # symbols, no commas.
                   - Do NOT dump the full pack list here. Item-by-item counts ("12 Gold
                     Balloons 12 White Balloons 12 Black Balloons") belong in Key Spec, Key
                     Features, Decoratives Attached and Description — Flipkart's search reads
                     those fields too, so repeating them in the title buys no extra reach and
                     Flipkart penalises stuffed titles.
                   - Never repeat a word to game ranking. Each word earns its place once.
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
                           search, MOST VALUABLE FIRST — the field may cap at 3-5 entries
                           (not confirmed yet), so put the ones that must survive at the top.
                           Include the occasion and the colour. Think "birthday decoration
                           items", not "premium party solutions".
                           Do NOT reuse phrases already in Model Name — Flipkart indexes the
                           title too, so a duplicate wastes a slot. This field is for the
                           phrases the title had no room for.
  "Precautions"          – safety warnings, e.g. ["Keep away from fire"]
  "Safety Features"      – e.g. ["Non-toxic"]

Single values
  "Shape"        – ONE value from the form's dropdown, e.g. "Round" / "Heart" / "Star".
                   If the pack has several shapes, pick the dominant one.
  "Description"  – HARD LIMIT 1400 CHARACTERS including spaces, line breaks and emoji.
                   Count them before you answer. Over 1400 and Flipkart cuts it off.
                   Commas allowed here. Write it in EXACTLY this shape, blank line between
                   every block, in this order:

                     <Product Name> (<N> Pieces) – <Occasion> Set          ← one line, ≤85 chars

                     One paragraph, 2-3 sentences: what it is, who it is for, and the
                     colours. Name the occasions a buyer searches for.

                     One short paragraph, 1-2 sentences: the all-in-one / easy-setup /
                     good-for-photos angle. Only say what is true.

                     🎁 What You Get (<N> Pieces)
                     One line per INVENTORY group, count first: "12 Gold Colour Balloons".
                     EVERY inventory line appears here, including arch tape, glue dots,
                     pump and LED light. No commas, no bullets, no dashes — just the lines.

                     ✨ Key Features
                     5 lines, each: "<emoji> <Short Label> – <benefit in a few words>"

                     🎈 Perfect For
                     5 occasions this genuinely suits, one per line.

                     💡 Why Choose This Kit?

                     One or two closing sentences on easy setup or the result the buyer gets.

                     👉 One final line starting with 👉.

                   Emoji: ONLY as the section markers 🎁 ✨ 🎈 💡 👉 and one at the start of
                   each Key Features line. Never inside a sentence, never in What You Get.

                   IF YOU GO OVER 1400, cut in this order and stop as soon as you fit:
                     1. the second paragraph
                     2. the whole "💡 Why Choose This Kit?" block and the 👉 line
                     3. Key Features 5 → 4 → 3
                     4. Perfect For 5 → 4
                   NEVER cut the headline, the first paragraph, or any line of What You Get.
                   An item the buyer is paying for and cannot read about is a wasted selling
                   point — give counts for accessory groups too ("16 Photo Props"), never
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

=== SECTION 3 — THE PASTE BLOCK ===

Inside JSON, every line break has to be written as \n — that is the JSON format, not a
choice, and there is nothing you can do about it. But I cannot paste \n into a marketplace
form. So in section 3, print the same four values AGAIN as real text with real line breaks,
ready for me to copy straight into the form. Do not summarise them, do not improve them, do
not re-write them — they must be character-for-character the same text as in sections 1
and 2, just unescaped.

Print exactly this, under the section 3 divider:

[FLIPKART DESCRIPTION]
<the section 2 "Description" value, with real line breaks>

[MEESHO TITLE]
<the section 1 meesho.title>

[MEESHO DESCRIPTION]
<the section 1 meesho.description, with real line breaks>

[MEESHO PACK CONTENTS]
<the section 1 meesho.pack_contents, one single line>

Nothing after that. No closing remark, no summary, no offer to help further.

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
- Is the Description 1400 characters or fewer, counted with spaces, line breaks and emoji?
  If not, cut in the order given and count again.
- Does the Description follow the template — headline, paragraphs, 🎁 What You Get,
  ✨ Key Features, 🎈 Perfect For, 💡 Why Choose This Kit?, 👉 — with a blank line between
  each block and emoji only as section markers?
- Does any field anywhere contain a banned quality word ("premium", "elegant", "luxury",
  "royal", "best", "high quality")?
- BRAND CHECK — go through every phrase in every field, including the Meesho ones, and find
  each place a colour or quality word sits directly in front of a noun as a two-word pair
  ("Golden Star", "Silver Crown", "Gold Curtain"). Expand every one of them with the shape,
  material or function word in the middle. This is the check that catches the rejection I
  actually got, so do it phrase by phrase — do not skim.
- Are all three section dividers present and spelled exactly as given, with sections 1 and 2
  each a standalone JSON object that would parse on its own?
- Is the PASTE BLOCK there as section 3, with all four values unescaped and identical to
  what is in sections 1 and 2?
- Is EVERY item you named as pack contents actually on the INVENTORY list? Anything you
  took from the staged scene in IMAGE 1 — a curtain, a stool, lights, furniture — must
  come out of Model Name, Design, Decoratives Attached, Material and Description.
- For each item you put in "not_visible": did you check every sub-panel of every photo,
  including the contents photo? Remove anything you can actually find.
- Is every entry in "Character" wording that is genuinely printed on an item?
- Does "Balloon Type" cover every kind of balloon in the pack?
- Is Model Name free of the word WishWorks, and does image-meta.title match it?
- Is Model Name 80-120 characters, ending in the piece count in brackets, with the buyer's
  search phrase inside the first 60 — and WITHOUT the item-by-item pack list repeated in it?
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

This is the SECOND of two prompts, sent in the SAME chat, right after the one that produced
image-meta-<ID>.json. You already have the product photos and the INVENTORY table above —
use them, do not ask me to send them again. Same rules: the INVENTORY is the authoritative
list of what is in the pack and how many, and IMAGE 1 is a staged scene whose background
(walls, curtains, furniture, cake, people) is NOT in the pack and never becomes a pack item,
a material or a "Decoratives Attached" entry.

Now fill the Flipkart listing form fields.

GIVE ME THE ANSWER AS A DOWNLOADABLE FILE named products-<ID>.json — same <ID> as the first
file, the second code from the inventory header row, e.g. products-ANP003.json. The file
contains ONLY this JSON object, nothing else: no commentary, no markdown fences, no closing
offer to help. If you cannot attach files, print the JSON on its own instead.

{
  "category": "balloon-decoration",
  "values": { "Model Name": "...", ... }
}

REUSE, DO NOT REWRITE: "Model Name" is the "title" you already wrote in the first file, and
"Search Keywords" is the "keywords" list from that same file — character for character. Two
different versions of either one is a bug, not a variation.

Every other value comes from the INVENTORY. Use the photos only to confirm colour, shape,
finish and printed/banner wording.

=== HARD RULES ===
1. Counts and pack contents come ONLY from the INVENTORY. Never invent a fact; if unsure
   of a field, LEAVE IT OUT. A missing field is fine; a wrong field gets the listing
   rejected by Flipkart's quality check.
2. NO COMMAS anywhere inside any list value. Flipkart splits list values on commas. Use
   "and" or a dash instead. This is the single most common mistake — check every line.
   (Commas ARE allowed in the free-text "Description".)
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
   Key Spec, Key Features, Decoratives Attached, Theme, Design, Description.

   Before you answer, re-read every phrase you wrote and ask of each one: "could this be
   somebody's company name?" If yes, expand it using the pattern above. Prefer the boring
   descriptive phrase every time — it is the one that survives review.

=== FIELDS TO FILL ===

Identity
  "Model Name"   – the "title" from the first file, copied exactly.
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
  "Search Keywords"      – the "keywords" list from the first file, copied exactly.
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

=== LEAVE THESE OUT ALWAYS ===
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
- Is "Model Name" character-for-character the "title" from the first file, and
  "Search Keywords" character-for-character its "keywords" list?
- Do all counts and items match the INVENTORY exactly?
- Does any list value contain a comma? Remove it.
- Did you invent a size or material you cannot see? Remove that field.
- IS THE "Description" FIELD THERE? It is the longest field and the easiest to drop. So are
  the five Yes/No dropdowns and "Weight" — a truncated answer loses the tail of the file
  first. Count the fields against the list above before you send.
- Does the Description mention every single INVENTORY line, accessories included?
- Is the Description 1400 characters or fewer, counted with spaces, line breaks and emoji?
  If not, cut in the order given and count again.
- Does the Description follow the template — headline, paragraphs, 🎁 What You Get,
  ✨ Key Features, 🎈 Perfect For, 💡 Why Choose This Kit?, 👉 — with a blank line between
  each block and emoji only as section markers?
- Does any field anywhere contain a banned quality word ("premium", "elegant", "luxury",
  "royal", "best", "high quality")?
- BRAND CHECK — go through every phrase in every field and find each place a colour or
  quality word sits directly in front of a noun as a two-word pair ("Golden Star", "Silver
  Crown", "Gold Curtain"). Expand every one of them with the shape, material or function
  word in the middle. This is the check that catches the rejection I actually got, so do it
  phrase by phrase — do not skim.
- Is EVERY item you named as pack contents actually on the INVENTORY list? Anything you
  took from the staged scene in IMAGE 1 — a curtain, a stool, lights, furniture — must
  come out of Model Name, Design, Decoratives Attached, Material and Description.
- Is every entry in "Character" wording that is genuinely printed on an item?
- Does "Balloon Type" cover every kind of balloon in the pack?
- Is it valid JSON, with every quote and bracket closed?

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

ALWAYS INCLUDE THESE THREE, EXACTLY AS SHOWN, AND NEVER GUESS THEM:

  "Seller SKU ID": "TODO_SKU",
  "MRP": "TODO_MRP",
  "Your selling price": "TODO_PRICE"

They are prices and a stock code. You cannot know them, and a plausible-looking number is
far worse than an obvious gap — it would be typed into a live listing. Leave them as the
TODO_ text above and the tool stops before the browser opens and asks a human for them.
Everything else on that tab (stock, dimensions, HSN, tax) is already stored and is NOT
your job — do not add those fields.

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

8. NAME EVERY ITEM THE WAY A BUYER SEARCHES FOR IT, not the way a supplier invoices it.
   Applies to every field, and most of all to "Decoratives Attached", "Key Spec",
   "Key Features" and the Description's What You Get list:

     "Foil Letter Kit"   → "Groom To Be Foil Banner"   (people search BANNER)
     "Mug Foil Balloon"  → "Beer Mug Foil Balloon"     (people search BEER MUG)
     "Fringe Curtain"    → "Fringe Foil Curtain Backdrop"

   Searched word first, technical word after. Never invent a detail the INVENTORY does not
   give — if it does not say beer mug, do not write beer mug.

9. THE ATTRIBUTES MATTER MORE THAN THE PROSE. Marketplace filters and category browse run on
   these structured fields, not on the Description — a buyer filtering "Occasion: Bachelor
   Party" never sees a listing that left Occasion blank, however good its copy is. So:
   **fill every field you have a truthful answer for.** Leaving one out is invisible and
   costs real traffic. This does NOT license guessing: rule 1 still stands, a wrong value is
   worse than a missing one. Fill what you know, omit what you do not.

10. NO URGENCY OR SCARCITY WORDING anywhere: "limited stock", "selling fast", "hurry",
   "trending", "best seller", "no. 1". Marketplace badges make those claims; a seller making
   them is a policy risk. This overrides any listing advice you have been given elsewhere.

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
  "Description"  – TARGET 2500-4500 CHARACTERS including spaces and line breaks.
                   5000 is the HARD LIMIT — Flipkart's own counter on this field reads
                   "0/5000". Over it, the tail is cut silently.
                   2500 is the FLOOR. Flipkart indexes this field and it is the single
                   largest piece of search surface in the whole listing. A 1400-character
                   description uses 28% of it — the other 72% is queries you cannot be
                   found for, for free.
                   MORE IS NOT PADDING. Fill it with things a buyer would actually search
                   or want to read: every item named in full with its count, more places
                   the kit gets used, more occasions, setup detail, what the finished
                   backdrop looks like. If a sentence is there only to make the number
                   bigger, cut it — a padded description reads as spam and ranks worse.
                   Count them before you answer. Both ends are checked after you reply.

                   THIS IS THE LONGER OF THE TWO DESCRIPTIONS, AND DELIBERATELY SO.
                   The first prompt already wrote "meesho.description" with a 1400-character
                   ceiling. This field holds 5000. They cover the SAME product and must never
                   contradict each other, but they are NOT the same text and neither is a copy
                   of the other:
                     - Meesho (1400): the main points, each with a brief line of explanation
                       where the budget allows. Compact by necessity.
                     - Flipkart (5000, this field): the same main points EXPANDED. Room to say
                       what each item is for, what the finished setup looks like, where it gets
                       used, how it goes up, and who buys it. Use the extra 3600 characters on
                       depth about the points that matter — never on repeating them.
                   If you find yourself writing the Meesho text again here, you are wasting the
                   field. If you find yourself inventing a new fact here, you are breaking rule 1.

                   *** ABSOLUTELY NO EMOJI IN THIS FIELD. NOT ONE. ***
                   This is not a style preference. An earlier version of this template used
                   emoji as section headings and **Flipkart's server returned HTTP 500 on
                   every save** — the listing could not be saved at all, and once the text
                   was in the draft even switching tabs failed. Proven by deleting the
                   Description on a live listing, at which point it saved immediately.
                   Emoji are 4-byte characters and something in Flipkart's backend cannot
                   store them. Plain ASCII headings only. No emoji anywhere else in this
                   file either.

                   Commas allowed here. Write it in EXACTLY this shape, blank line between
                   every block, in this order:

                     <Product Name> (<N> Pieces) - <Occasion> Set          ← one line, ≤85 chars

                     One paragraph, 2-3 sentences: what it is, who it is for, and the
                     colours. Name the occasions a buyer searches for.

                     One short paragraph, 1-2 sentences: WHERE it gets used — home, hotel
                     room, banquet hall, party venue — plus the all-in-one / good-for-photos
                     angle. Only say what is true. Flipkart indexes this field, and "room
                     decoration" / "hotel room decoration" are queries almost every listing
                     in this category forgets to answer.

                     WHAT YOU GET (<N> Pieces)
                     One line per INVENTORY group, count first: "12 Gold Colour Balloons".
                     EVERY inventory line appears here, including arch tape, glue dots,
                     pump and LED light. No commas, no bullets, no dashes — just the lines.

                     KEY FEATURES
                     5 lines, each: "<Short Label> - <benefit in a few words>"
                     The part after the dash must say what it DOES for the buyer, never
                     restate the label. "52 Pieces - Complete decoration set" is the label
                     twice; "52 Pieces - Enough to cover a full wall backdrop" is a benefit.
                     "Arch Tape - Easy balloon arrangement" is vague; "Arch Tape - Holds the
                     balloons in a curve without tying knots" is specific. Specific beats
                     enthusiastic every time.

                     PERFECT FOR
                     5 to 8 occasions and PLACES this genuinely suits, one per line.
                     Mix both: "Bachelor Party", "Groom Welcome", "Hotel Room Decoration",
                     "Home Party", "Photo Booth Backdrop".

                     WHY CHOOSE THIS KIT

                     One or two closing sentences on easy setup or the result the buyer gets.

                     One final plain line telling the buyer what to do first, e.g.
                     "Inflate the balloons and fix the arch tape to shape the display."

                   Use a plain hyphen "-" everywhere, never an en-dash or em-dash. ASCII
                   punctuation only in this field: no emoji, no arrows, no bullet glyphs,
                   no smart quotes. The section headings above are the whole formatting
                   vocabulary — CAPITALS and blank lines, nothing else.

                   IF YOU GO OVER 5000, cut in this order and stop as soon as you fit:
                     1. the second paragraph
                     2. the whole "WHY CHOOSE THIS KIT" block and the closing line
                     3. Key Features 5 → 4 → 3
                     4. Perfect For 8 → 6 → 5
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
- Is the Description between 2500 and 4500 characters, counted with spaces, line breaks and
  emoji? Over 5000: cut in the order given and count again. Under 2500: you have left most of
  the field empty — add the places it is used, more Perfect For lines, fuller item names with
  counts, setup detail, and what the finished backdrop looks like. Then count again. Both ends
  are checked by tooling after you answer. **This field is 5000 characters, not 1400** — an
  earlier version of this prompt said 1400 and every listing written under it is running at a
  quarter of its search surface.
- Does the Description follow the template — headline, paragraphs, WHAT YOU GET, KEY FEATURES,
  PERFECT FOR, WHY CHOOSE THIS KIT — with a blank line between each block?
- **IS THE DESCRIPTION FREE OF EVERY EMOJI AND OF EN-DASHES?** Read it character by character.
  Emoji in this field made Flipkart's server return 500 on every save — the listing could not
  be saved at all. Plain ASCII only. This is the single most important check in this list.
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
- BUYER-WORD CHECK (rule 8) — read back every item name in Decoratives Attached, Key Spec,
  Key Features and What You Get. Would a buyer type it? "Foil Letter Kit" and "Mug Foil
  Balloon" fail; "Groom To Be Foil Banner" and "Beer Mug Foil Balloon" pass.
- ATTRIBUTE SWEEP (rule 9) — go back through the FIELDS TO FILL list and count how many you
  actually filled. For each one you skipped, is that because you genuinely do not know, or
  because you stopped early? Filters run on these, so a blank field is a filter you never
  appear in. Fill the ones you know.
- Does the Description say WHERE the kit is used — room, home, hotel room, banquet hall —
  and not only when?
- Does each KEY FEATURES line say what the feature DOES, rather than repeating its label?
- Does any field contain urgency or scarcity wording ("limited stock", "trending", "hurry",
  "selling fast", "best seller")? Remove it.
- Is it valid JSON, with every quote and bracket closed?

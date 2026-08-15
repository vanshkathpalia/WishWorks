This is the SECOND of two prompts, sent in the SAME chat, right after the one that produced
image-meta-<ID>.json. You already have the product photos and the INVENTORY table above —
use them, do not ask me to send them again. Same rules: the INVENTORY is the authoritative
list of what is in the pack and how many, and IMAGE 1 is a staged scene whose background
(walls, curtains, furniture, cake, people) is NOT in the pack and never becomes a pack item,
a material or a "Decoratives Attached" entry.

Now fill the Flipkart listing form fields.

GIVE ME THE ANSWER AS A DOWNLOADABLE FILE named products-<ID>.json, where <ID> is THE SAME
value you used for the first file in this chat — character for character. Do not re-derive
it, do not tidy it, and do not substitute any code that appears in these instructions. The
two files are matched to each other by that name, so a listing whose first file was
image-meta-ABC-123.json needs products-ABC-123.json here. The file contains ONLY this JSON
object, nothing else: no commentary, no markdown fences, no closing offer to help. If you
cannot attach files, print the JSON on its own instead.

{
  "category": "balloon-decoration",
  "values": { "Model Name": "...", ... }
}

ALWAYS INCLUDE THESE THREE:

- Seller SKU ID: If the inventory contains a SKU, use that exact SKU.
- MRP: If the user has provided an MRP anywhere in the conversation, use it.
- Your selling price: If the user has provided a selling price anywhere in the conversation, use it.
- Only use TODO placeholders when the user has not supplied those values.

Example:
"Seller SKU ID": "<SKU_ID>", -> going to come form the inventory json's sku field.
"MRP": "999",
"Your selling price": "349"

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

=== IF YOU ARE NOT SURE, SAY SO — "_ask" ===

Rule 1 tells you to leave a field out rather than invent it, and that is right. But a field left
out because nobody knew looks exactly like a field nobody thought of, and I cannot tell them
apart afterwards.

So when you are genuinely unsure of something, add a "_ask" key to the JSON:

  "_ask": ["<the question, in one sentence, naming the field it is about>"]

Give your best answer in the real field as well. The app shows me every "_ask" before the listing
goes anywhere near being live, so a flagged guess is safe and a silent one is not. Keys starting
with "_" are never typed into the form.

Use it for a real doubt, not for everything — a file that asks about ten fields is a file I stop
reading. If there is nothing to ask, leave the key out entirely.

=== HARD RULES ===
1. Counts and pack contents come ONLY from the INVENTORY. Never invent a fact; if unsure
   of a field, LEAVE IT OUT. A missing field is fine; a wrong field gets the listing
   rejected by Flipkart's quality check.
2. NO COMMAS anywhere inside any list value. Flipkart splits list values on commas. Use
   "and" or a dash instead. This is the single most common mistake — check every line.
   (Commas ARE allowed in the free-text "Description".)
3. Values written as ["a", "b"] are lists — one idea per entry. Values written as "text"
   are single values.
4. Do not put a brand name in "Model Name" — not "PartyDreams", not "WishWorks", not any
   other. The marketplace adds the seller's brand to the front of the name by itself, so
   writing it yourself gets it printed twice.
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
  "Series"       – the occasion this kit is bought for, used as a product line, taken from the
                   INVENTORY. NOT a quality tier: "Premium" and "Classic" are banned words and
                   empty claims. A REQUIRED-BY-US field — it was skipped on every listing.
  "Design"       – what it looks like, e.g. "Heart Shaped Foil Balloons with Rose Garland"

Lists (arrays — no commas inside any entry)
  "Ideal For"            – from: Boys, Girls, Men, Women
  "Material"             – from: Latex, Foil, Paper, Plastic, Fabric, Rubber
  "Theme"                – e.g. ["Red and White", "Anniversary"]
  "Occasion"             – WORK IT OUT FROM THE INVENTORY AND THE PHOTOS. This is a free-text
                           field, not a menu: whatever the kit is genuinely bought for is a valid
                           answer, and there are far more occasions than any list would hold.
                           Read the printed wording on the banner and cutouts, the theme of the
                           props, and what the INVENTORY calls things. Name the ceremony or event
                           the way an Indian shopper says it.
                           ALWAYS INCLUDE IT, even when the answer feels obvious. It is the one
                           field where leaving it out does NOT leave a blank: a stored default
                           fills in, and that default is a birthday one. A kit for any other
                           occasion then goes live claiming Birthday and Anniversary, which is a
                           WRONG value, not a missing one.
                           If you cannot tell what the occasion is, say so with "_ask" (below)
                           and give your best answer alongside it.
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
  "Other Features"       – 3 to 5 TRUE things about the kit that no other field on this form has
                           a box for. This is the catch-all, and it was blank on every listing —
                           which is a filter we never appear in, for free. Use what the INVENTORY
                           supports: ["Reusable Banner", "No Helium Needed", "Air Filled Balloons",
                           "DIY Setup", "Balloon Pump Included"]. Never a quality claim, never a
                           repeat of Key Features word for word.
  "Other Dimensions"     – LEAVE OUT unless the INVENTORY gives a measurement that has no box of
                           its own (a banner's length, a curtain's drop). The parcel's own size is
                           already stored and is not this field.

Single values
  "Shape"        – ONE value from the form's dropdown, e.g. "Round" / "Heart" / "Star".
                   If the pack has several shapes, pick the dominant one.
  "Description"  – TARGET 2500-4500 CHARACTERS including spaces and line breaks.
                   === DESCRIPTION FORMATTING RULES (VERY IMPORTANT) ===

The Description MUST contain REAL newline characters.

Do NOT escape newlines as "\n".
Do NOT convert newlines into spaces.
Do NOT collapse the Description into one paragraph.

The Description must be readable when pasted directly into the Flipkart Description field.

Formatting rules:

• Leave exactly ONE blank line between every section.

• Every section heading MUST begin on its own line.

• Every inventory item MUST be on its own line.

• Every Key Feature MUST be on its own line.

• Every Perfect For entry MUST be on its own line.

• Every setup step MUST be on its own line.

Never place multiple inventory items, features or setup steps on the same line.

Never use HTML.
Never use Markdown.
Never use bullets.
Never use numbering.

Only plain text with real line breaks.
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

One inventory item per line.

Generic example:

<qty> <Item Name 1>

<qty> <Item Name 2>

<qty> <Item Name 3>

Every inventory line MUST appear exactly once.

Never combine two inventory items onto one line.

Wrong:

<qty> Item 1 <qty> Item 2 <qty> Item 3

Correct:

<qty> Item 1

<qty> Item 2

<qty> Item 3

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

Size and weight — LEAVE THESE OUT. DO NOT GUESS THEM.
  "Width", "Height", "Depth", "Weight", "Quantity"
  These describe the posted parcel and its weight, and the app measures them from the packed
  kit and writes them into this file itself. You cannot see a parcel in a photo, and a size the
  courier disagrees with is charged back to me after the sale — so a guess here does not
  save me a step, it costs me money. Omit all five. If you have already written them,
  delete them. "Quantity" is a weight in GRAMS on the form, not a piece count — writing the
  piece count there is the specific mistake to avoid.
  "Diameter" — omit as well unless the product is genuinely round and the INVENTORY gives
  the figure.

=== "Color" AND "Type" — THESE TWO WRITE THE PRODUCT NAME. TREAT THEM AS THE TITLE. ===

This is the most valuable thing on the form and it does not look like it. Flipkart does not show
buyers the "Model Name". It BUILDS the name they see out of these two fields:

  NAME = <my brand> + <every "Color" value, comma-separated, in the order you list them> + <Type>

The brand is set by my account and is added automatically. Everything after it is yours. So
"Color" is not a colour: it is the body of the title, and "Type" is the words it ends on.

GIVE ME EXACTLY THIS, ALL OF IT FROM THE INVENTORY AND THE PHOTOS:
  "Color" – THREE phrases, in the order they should be read:
      1st  who this kit is for and the occasion it is bought for
      2nd  what is mainly in it, with the actual colours of those items
      3rd  the pieces that make this kit different from a cheaper one
  "Type"  – the last words of the name. It must read correctly straight after the 3rd phrase,
           because Flipkart puts no comma between them.

Derive all four from THIS kit. Do not carry over wording from any other listing, and do not use a
phrase because it sounds like a product name — every word has to be answerable from the INVENTORY
or visible in the photos.

RULES, ALL OF WHICH COST REAL SEARCHES WHEN BROKEN:
  1. SPELL EVERY WORD CORRECTLY, THEN READ IT BACK ONE WORD AT A TIME. A typo here is a typo in
     the name every buyer sees, and a misspelt word matches nothing anybody searches for. This is
     the most expensive single mistake available in this file, and it has already happened.
  2. NAME THE REAL COLOURS. Never a catch-all colour word when the INVENTORY tells you what the
     colours actually are — a colour a buyer types is worth more than a category word they do not.
  3. NO WORD TWICE anywhere in the composed name. The name is short and every repeat spends it
     on nothing. Compose the whole line, then check word by word.
  4. Write "and", never "&".
  5. NO COMMAS INSIDE a "Color" value. Flipkart splits this field on commas, so a comma silently
     turns one phrase into two and reorders the title.
  6. Rule 7 (brand collision) applies HARDEST here, because this is the text the checker reads.
     Never leave a colour sitting directly in front of a noun — put the material or shape between.
  7. Rules 6 and 10 apply too. A banned quality word or an urgency word is at its most visible,
     and most rejectable, in the product name.
  8. Front-load. Assume the name is cut short in the search grid and only the beginning is read.
     That is why the occasion comes first, and it is not negotiable.

=== LEAVE THESE OUT ALWAYS ===
This Flipkart category is shared with hand fans, party blowouts, crackers and
battery-powered toys. These fields exist on the form but do NOT apply to balloons and
decoration. Never include them:
Handle, Handle Shape, Handle Material, Hand Fan Type, Animal Type, Guardstick Material,
Rib Material, Leaf Material, Leaf Shape, Printed Text, Other Hand Fan Features,
Mouthpiece Material, Tube Shape, Tube Material, Other Blowout Features, Burn Time,
Visual Effects, Sound Features, Cracker Type, Other Cracker Features, Powered by,
Power Requirement, Type of Batteries, Number of Batteries, Other Power Features.

=== ALREADY WRITTEN BY THE APP — NEVER INCLUDE THESE ===
  "Model Number"    – the app copies it from "Seller SKU ID". They are the same string, and a
                      second copy is only a place for a typo to appear.
  "Quantity"        – the app converts it from the parcel weight it measured. It is a WEIGHT IN
                      GRAMS on this form, not a piece count, and writing the piece count there
                      is the specific mistake to avoid.
  "Items Included"  – the app reads it off the "WHAT YOU GET" lines of the "Description" you
                      just wrote. Which means those lines have to be right: one item per line,
                      each line starting with its count, nothing else between them.
If any of the three appears in your answer, delete it.

=== ALREADY SET FOR EVERY PRODUCT — only include if THIS product differs ===
Warranty fields, Country of Origin, HSN code, tax, manufacturer and packer details,
stock and shipping settings are already configured. Do not include them.
Also already set, and only worth including when this product genuinely differs: "Size"
("Medium") and "Size in Number" ("8"). "Type" and "Color" are NOT in that list — they write the
product name, and they have their own section above.

DO NOT "correct" "Size in Number" from the INVENTORY. The inventory says things like "10 INCH
METALLIC BALLOONS", and that is the INFLATED size — but nothing ships inflated. The latex goes in
flat and the foil is folded, so the piece the buyer receives is smaller than the number on the
material row. Reading 10 off the inventory and writing it here describes an item that does not
exist in the parcel. Leave the field out.

=== BEFORE YOU ANSWER, CHECK ===
- Is "Model Name" character-for-character the "title" from the first file, and
  "Search Keywords" character-for-character its "keywords" list?
- Do all counts and items match the INVENTORY exactly?
- Does any list value contain a comma? Remove it.
- Did you invent a size or material you cannot see? Remove that field.
- IS THE "Description" FIELD THERE? It is the longest field and the easiest to drop. So are
  the five Yes/No dropdowns — a truncated answer loses the tail of the file first. Count the
  fields against the list above before you send.
- Are "Width", "Height", "Depth", "Weight" and "Quantity" ABSENT? They are the parcel, the app
  measures it, and a guessed size costs me money at settlement. If any of the five is in your
  answer, take it out. So are "Model Number" and "Items Included" — the app writes all of them
  from things you have already given it.
- In the Description's WHAT YOU GET block, does EVERY line start with a digit, and does the
  block end at the next heading with nothing else mixed in? The app reads "Items Included"
  straight off those lines, so a stray sentence in there becomes a stray listing value.
- Does the Description mention every single INVENTORY line, accessories included?
- Is the Description between 2500 and 4500 characters, counted with spaces, line breaks and
  emoji? Over 5000: cut in the order given and count again. Under 2500: you have left most of
  the field empty — add the places it is used, more Perfect For lines, fuller item names with
  counts, setup detail, and what the finished backdrop looks like. Then count again. Both ends
  are checked by tooling after you answer. **This field is 5000 characters, not 1400** — an
  earlier version of this prompt said 1400 and every listing written under it is running at a
  quarter of its search surface.
- Open the Description mentally and check that it visually resembles a well-formatted text document.
- Every heading must be separated by one blank line.
- Every inventory item must occupy its own line.
- Every Key Feature must occupy its own line.
- Every Perfect For entry must occupy its own line.
- Every setup instruction must occupy its own line. 
If any section appears as one long paragraph, rewrite it before answering.
- Does the Description follow the template — headline, paragraphs, WHAT YOU GET, KEY FEATURES,
  PERFECT FOR, WHY CHOOSE THIS KIT — with a blank line between each block?
- **IS THE DESCRIPTION FREE OF EVERY EMOJI AND OF EN-DASHES?** Read it character by character.
  Emoji in this field made Flipkart's server return 500 on every save — the listing could not
  be saved at all. Plain ASCII only. This is the single most important check in this list.
- Does any field anywhere contain a banned quality word ("premium", "elegant", "luxury",,
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
- COMPOSE THE PRODUCT NAME ON PAPER: <brand> + your three "Color" phrases + "Type". Is any word
  in it repeated? Is every word spelt correctly? Does it start with the occasion? Is there an "&"
  or a comma inside a value? That one line is what every buyer sees; check it before anything else.
- ARE "Series", "Occasion" AND "Other Features" ALL THERE? They are the fields that get skipped
  most often, they are all easy to answer truthfully, and each one is a filter the listing
  otherwise never appears in. "Occasion" is the urgent one: skipping it does not leave a gap, it
  lets a birthday default onto a kit that is not for a birthday.
- ATTRIBUTE SWEEP (rule 9) — go back through the FIELDS TO FILL list and count how many you
  actually filled. For each one you skipped, is that because you genuinely do not know, or
  because you stopped early? Filters run on these, so a blank field is a filter you never
  appear in. Fill the ones you know.
- Does the Description say WHERE the kit is used — room, home, hotel room, banquet hall —
  and not only when?
- Does each KEY FEATURES line say what the feature DOES, rather than repeating its label?
- Does any field contain urgency or scarcity wording ("limited stock", "trending", "hurry",
  "selling fast", "best seller")? Remove it.
- Is it valid JSON, with every quote and bracket closed??

You are preparing ONE product for WishWorks, an Indian seller of balloons and party
decoration items, to list on Flipkart and Meesho. This is the FIRST of two prompts. This one
describes the photos and writes the Meesho copy. The second one fills the Flipkart form
fields, in this same chat, so keep the photos and the inventory in mind after you answer.

I am giving you TWO things:

(a) ALL the product photos, uploaded in order. IMAGE 1 is the decorated/hero shot,
    IMAGE 2 shows the full pack contents, any further images are extra views.
    IMPORTANT — IMAGE 1 IS A STAGED SCENE, often AI-generated. It deliberately contains
    background and setting that I am NOT selling: room walls, curtains, drapes, stools,
    tables, furniture, cushions, plants, floor, cake, food, string lights that are part of
    the room, people and babies. NONE of that is in the pack. Never take a pack item or a
    material from something you see in IMAGE 1. If an item is not in the INVENTORY, it does
    not exist, no matter how clearly you can see it. IMAGE 1 tells you colour, mood and how
    the kit looks set up — nothing about contents.
(b) an INVENTORY table exported from my stock sheet. I packed this kit, so the inventory
    is the AUTHORITATIVE list of what is in the pack and how many.

INVENTORY (category / specific material / number — use these exact items and counts.
Do NOT recount from the photos, do NOT adjust, do NOT add anything not listed):
<PASTE YOUR EXCEL ROWS HERE>

THE LISTING ID is in the inventory's own header row, which carries two codes like
"WKU004  ANP003". The SECOND code is the listing ID — here "ANP003". Use it exactly as
written, same capitals, no spaces. If the header has only one code, use that one; if you
cannot find a code at all, say so in one line and stop.

GIVE ME THE ANSWER AS A DOWNLOADABLE FILE named image-meta-<ID>.json — e.g.
image-meta-ANP003.json. The file contains ONLY the JSON object below, nothing else: no
commentary, no markdown fences, no closing offer to help. If you cannot attach files, print
the JSON on its own instead. Either way the content is identical.

{
  "title": "",
  "keywords": [],
  "images": { "1": "", "2": "" },
  "not_visible": [],
  "meesho": {
    "title": "",
    "description": "",
    "pack_contents": ""
  }
}

WHERE EACH PART COMES FROM
- "title" is the FLIPKART product title. Flipkart does not let me type a title — it BUILDS
  one from Brand + Model Name + attributes, so this is the only part I control. The second
  prompt will copy this value into "Model Name", so decide it here and decide it well.
- "keywords" are the Flipkart search keywords. The second prompt copies these too.
- "images" = one description PER uploaded photo, written by LOOKING at that photo.
- "not_visible" = any inventory item you cannot find in ANY photo. Empty list if all present.
- "meesho" = the copy I paste by hand into the Meesho Supplier Panel. DIFFERENT text from
  "title" and from anything Flipkart gets — Meesho and Flipkart rank on different things, so
  do not copy one into the other.

=== HARD RULES ===
1. Counts and pack contents come ONLY from the INVENTORY. Never invent a fact. A wrong fact
   gets the listing rejected.
2. NO COMMAS anywhere inside "keywords" entries or inside "meesho.pack_contents". Flipkart
   splits list values on commas. Use "and" or a dash instead. (Commas ARE allowed in the
   image descriptions and in meesho.description.)
3. Do not put the brand name "WishWorks" anywhere.
4. Write for an Indian shopper searching on a phone. Concrete over clever: say what is in the
   box, what it is for, and what the buyer gets. Every sentence must survive the question
   "how would a buyer check that?"
5. BANNED WORDS — unverifiable quality claims. Never use these anywhere, in any field:
   "premium", "elegant", "luxury", "royal", "exclusive", "best", "cheapest", "finest",
   "100% original", "guaranteed", "high quality", "superior". Rule of thumb: if a word
   describes how GOOD something is rather than WHAT IT IS, leave it out. "Elegant" was
   flagged on a real listing. A closed list — these are the whole set.

6. BRAND COLLISION — the trap no word list can ever cover, so learn the pattern instead.
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
   removes the risk. Applies to EVERY value in this file without exception, including all
   three Meesho ones.

=== "title" — THE FLIPKART TITLE ===
TARGET 80-120 characters. 128 is the ceiling.
Structure, in this order:
  <product type> <theme/colours> <hero items> for <occasion> (Set of N Pcs)
Example:
  "Groom To Be Decoration Kit Black Gold Foil Banner Sash Star Balloons Curtain for
   Bachelor Party (Set of 44 Pcs)"
Rules:
- THE FIRST 60 CHARACTERS MUST WORK ALONE — that is what a phone shows in the search grid.
  The exact phrase a buyer types goes first.
- End with the piece count in brackets, the INVENTORY total: "(Set of 44 Pcs)".
- No brand name. No ALL CAPS, no emoji, no | / * # symbols, no commas.
- Do NOT dump the full pack list here. Item-by-item counts belong in the Flipkart fields the
  second prompt writes — Flipkart's search reads those too, so repeating them buys no extra
  reach and Flipkart penalises stuffed titles.
- Never repeat a word to game ranking. Each word earns its place once.

=== "keywords" — FLIPKART SEARCH KEYWORDS ===
6 to 8 phrases a real Indian buyer would type into Flipkart search, MOST VALUABLE FIRST —
the field may cap at 3-5 entries (not confirmed yet), so put the ones that must survive at
the top. Include the occasion and the colour. Think "birthday decoration items", not
"premium party solutions". Do NOT reuse phrases already in "title" — Flipkart indexes the
title too, so a duplicate wastes a slot. This is for the phrases the title had no room for.

=== "images" — DESCRIPTION RULES ===
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

=== "not_visible" — THE MISMATCH FLAG ===
Any inventory item you cannot find in ANY photo. Leave the list empty if all are present.
This flags a mismatch for me — do not fix it, just report it.
Work through the INVENTORY one line at a time and search every photo for that line before
you decide. A pack-contents photo is often a SINGLE COMPOSITE IMAGE made of several
labelled sub-panels — read every sub-panel and every caption in it, including small corner
panels. Setup accessories (balloon pump, arch tape, glue dots, LED light) are usually
grouped in one small corner panel and are easy to miss. Setup aids will never appear in the
decorated hero shot (IMAGE 1) because they are not decoration — that is expected and is NOT
a reason to list them. An item is only "not visible" if it is missing from the pack-contents
photo as well. A false entry here is worse than an empty list: it sends me looking for a
problem that does not exist.

=== "meesho" — THE COPY I PASTE INTO THE MEESHO SUPPLIER PANEL ===

Act as an experienced Meesho catalogue seller. Meesho does NOT read image metadata, so
unlike Flipkart, everything Meesho knows about this product comes from the product name
and the description text. Search ranking and click-through both hang on this section.

Write for the Meesho buyer specifically: price-conscious, on a phone, scrolling a grid of
near-identical thumbnails, deciding in about a second. That is a different reader from the
Flipkart shopper, which is why this text is NOT a copy of "title" above.

"meesho.title"
  TARGET 90-115 characters. 120 is the ceiling — do not exceed it.
  USE THE SPACE. A title at 82 characters has thrown away a third of its search surface.
  But length only helps if every added word is a DIFFERENT phrase a buyer might type. Meesho
  is reported to penalise repetition ("Kurti Cotton Kurti Women Kurti Ethnic Kurti"), so a
  longer title earns its length with new words or not at all. Never pad, never repeat.
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
  - USE " | " (space pipe space) TO SEPARATE THE PARTS. At 90+ characters a run-on title is
    unreadable on a phone, and the pipe is what every marketplace listing uses to break it up:
      "Annaprasan Decoration Kit | Red Gold Metallic Balloons | Heart Foil Banner |
       Props LED Light (Set of 54 Pcs)"
    Keep the piece count in brackets at the very end, AFTER the last pipe, never inside one.
    Three to five parts. The pipe is the ONLY symbol allowed.
  - No ALL CAPS. No emoji. No other symbols — no * # % @ & +. No "best", "cheapest",
    "premium quality", "100% original", "free delivery", "lowest price". No price. These
    read as spam and are a common reason catalogues get rejected.
  - Do not repeat a keyword to game the search. It costs characters you need and Meesho
    ranks readable titles.
  - Every single word must be one a buyer would either search for or want to read.

"meesho.description"
  TARGET 1100-1400 characters. 1400 is the ceiling.
  THIS IS THE MOST UNDER-USED FIELD IN THE WHOLE LISTING. Meesho does not read image
  metadata, so this text and the title are the ENTIRE basis on which Meesho can match your
  product to a search. A 470-character description is two thirds of the field left empty —
  every sentence you do not write is a query you cannot be found for. Fill it.
  NEVER one solid paragraph — use short lines.
  Only the first line or two are visible before the buyer taps "read more", so the whole
  offer has to land there.
  Use this shape exactly:
     Line 1   One sentence naming the product, the piece count and the occasion. It must
              sell on its own, with nothing below it.
     (blank)
     Two or three lines describing the finished look: the colours, what goes on the wall,
              what the buyer ends up with. Written for a person, not a keyword field.
     (blank)
     "What you get:" then ONE SHORT LINE PER ITEM GROUP, each with its count, taken from
              the INVENTORY. Every inventory line must appear here. Name the material and
              the size where the INVENTORY gives them — "20 Red Metallic Latex Balloons"
              beats "20 Red Balloons" and costs four words.
     (blank)
     "Perfect for:" then 5-7 occasions this genuinely suits. This is pure query surface —
              every line is a search someone types. Only real ones: a kit that does not
              suit a wedding must not claim weddings.
     (blank)
     "How to set it up:" two or three plain lines using the accessories that are actually
              in the pack (pump, arch tape, glue dots).
     (blank)
     Two or three closing lines on material, reusability or what the photos will look
              like — only what is true.
  IF YOU GO OVER 1400, cut in this order and stop as soon as you fit:
     1. the closing lines
     2. the "How to set it up:" block
     3. "Perfect for" 7 → 6 → 5
     4. shorten the look-and-feel lines
  NEVER cut line 1, and never drop a "What you get:" line — an item the buyer is paying for
  and cannot read about is a wasted selling point.
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
  "what is in the packet" field. HARD LIMIT 255 CHARACTERS — count them.
  - Format: "20 Red Metallic Balloons - 20 Gold Metallic Balloons - 8 Heart Foil Balloons
    - 1 Annaprasan Banner"
  - Separate items with " - " (space hyphen space). NO COMMAS.
  - Taken from the INVENTORY and nothing else.
  - ONE ENTRY PER INVENTORY LINE. NEVER MERGE TWO LINES INTO ONE. If the inventory lists
    "20 red metallic balloons" and "20 gold metallic balloons", write both — never
    "40 Metallic Balloons". The colour is the part a buyer searches for and the part that
    tells them what they are getting; collapsing the two throws it away and makes the line
    disagree with the photos, which reads as a mismatch.
  - KEEP THE COLOUR, MATERIAL AND SHAPE WORDS on every entry: "20 Red Metallic Balloons",
    not "20 Balloons". Same for foil shapes ("8 Heart Foil Balloons") and printed items
    ("1 Annaprasan Banner").
  - IF YOU EXCEED 255: shorten the WORDING — "1 LED Light 10m" instead of
    "1 LED String Light 10 Metre", "1 Glue Dot Strip" instead of "1 Glue Dot Stripe Roll".
    Never merge two inventory lines to save space, and never drop a line entirely.
  - COLLAPSE ALL WHITESPACE. My inventory is pasted straight out of Excel and arrives full
    of stray spaces, tabs, line breaks, double spaces and trailing blanks. Output exactly
    ONE space between words, no leading or trailing space, and NO line break anywhere in
    this value. It has to be a single clean line I can copy directly into the panel.
  - The counts here must add up to the same total you used in the image "2" description.

=== BEFORE YOU ANSWER, CHECK ===
- Is the ID the SECOND code from the inventory header row, spelled exactly as it appears
  there, and used in the filename?
- Do all counts and items match the INVENTORY exactly?
- Is there one "images" description per uploaded photo, each clearly about that photo?
- Does the image "2" description start with the total piece count as a NUMBER?
- For each item you put in "not_visible": did you check every sub-panel of every photo,
  including the contents photo? Remove anything you can actually find.
- Is EVERY item you named actually on the INVENTORY list? Anything you took from the staged
  scene in IMAGE 1 — a curtain, a stool, lights, furniture — must come out.
- Is "title" 80-120 characters, free of the word WishWorks, ending in the piece count in
  brackets, with the buyer's search phrase inside the first 60 — and WITHOUT the
  item-by-item pack list repeated in it?
- Does the Meesho title END with the piece count in brackets — "(Set of 69 Pcs)" — using
  the INVENTORY total, and is that number the same one the image "2" description opens with?
- Is the Meesho title 90-115 characters (never over 120), do its FIRST 40 carry the search
  phrase alone, and is every word past character 40 a NEW phrase rather than a repeat?
- Is the Meesho title split into 3-5 parts with " | ", with the piece count in brackets at
  the very end after the last pipe?
- COUNT the Meesho description and the Flipkart-facing values. Being over the limit is worse
  than being under it — the form silently truncates, so the end of your text simply vanishes.
- Is the Meesho description at least 1100 characters and no more than 1400? COUNT IT. Coming
  in at half the allowance is the most common failure in this field and it costs search
  reach directly.
- Is the Meesho title free of the brand name, ALL CAPS, emoji, symbols and every
  promotional word ("best", "premium quality", "free delivery", any price)?
- Is the Meesho description laid out in short lines with "What you get:" and
  "Perfect for:", rather than one paragraph?
- Does the Meesho description contain no phone number, email, website, social handle,
  guarantee, delivery promise or price?
- Is meesho.pack_contents ONE line, 255 characters or fewer, separated by " - ", with no
  commas, no line breaks and no double spaces anywhere?
- Does meesho.pack_contents have ONE entry per INVENTORY line, with no two lines merged?
  Two balloon colours on the inventory means two entries, never a combined "40 Balloons".
- Does every pack_contents entry keep its colour, material or shape word?
- Do the counts in meesho.pack_contents add up to the same total as the image "2"
  description?
- Does any value contain a banned quality word ("premium", "elegant", "luxury", "royal",
  "best", "high quality")?
- BRAND CHECK — go through every phrase in every value, including the Meesho ones, and find
  each place a colour or quality word sits directly in front of a noun as a two-word pair
  ("Golden Star", "Silver Crown", "Gold Curtain"). Expand every one of them with the shape,
  material or function word in the middle. This is the check that catches the rejection I
  actually got, so do it phrase by phrase — do not skim.
- Is it valid JSON, with every quote and bracket closed?





# The whole flow — one listing, start to finish

> **You do not need to know how to code to use this.** You type two commands; the computer
> does the fiddly parts — converting formats, making every image exactly the right size,
> cutting the Meesho tag off, writing the descriptions in.
>
> Everything else is downloading pictures, pasting text, and looking at the result.

---

## What this actually does for you

Putting one product on Flipkart means filling about 66 boxes by hand and preparing several
images to exact specifications. This does both. **Nothing goes live without you looking at it
first** — the computer never presses Save on its own.

| The computer does | You do |
|---|---|
| Convert `.avif` → `.jpg` | Download the photos |
| Make every image exactly 1500×1500 | Rename them 1, 2, 3, 4 |
| Cut the Meesho tag off | Ask the AI to redo the pictures |
| Write descriptions into the files | **Check it looks right** |
| Type the 66 listing fields | Press Save |

---

## Part 1 — Setup (once ever, ~10 minutes)

Open the **Terminal** app. Type each line, pressing ENTER after each:

```bash
cd "<the folder this project is in>/flipkart-autofill"
npm install
npx playwright install chrome
npm run login
```

The last one opens Chrome. Log in to Flipkart Seller Hub as normal, OTP and all.
**You never have to log in again** — it remembers.

> If a line fails, copy the whole red message and send it to whoever set this up.
> Nothing here can damage your listings.

---

## Part 2 — The three folders

This is the only thing worth understanding. Pictures move in **one direction** through three
folders, and nothing is ever overwritten:

```
images/1-raw/      what you downloaded          (Meesho tag still on it)
      ↓
images/2-clean/    tag cut off, right size      ← give these to the AI
      ↓
images/3-final/    finished                     ← upload these
```

If anything looks wrong, delete a folder and run the command again. **Your downloads in
`1-raw/` are never touched**, so nothing can be lost.

---

## Part 3 — Doing one listing

### Step 1 · Download the photos

Pick a **product ID** — a short code for the kit type plus a number:

| Code | Kit |
|---|---|
| `ANP` | Annaprashan / rice ceremony |
| `GTB` | Groom-to-be |

Example: **`ANP-1042`**.

Make a folder with that name and put the downloads in, **renamed to plain numbers**:

```
images/1-raw/ANP-1042/
    1.avif    ← MAIN photo (the decorated one people see first)
    2.avif    ← what's inside the pack
    3.avif
    4.avif
```

**The number is its position on the listing.** Getting 1 and 2 right matters most.

> ⚠️ Renaming `1.avif` to `1.jpg` does **not** convert it. The name is only a label; the file
> is unchanged. That is exactly what Step 2 is for. Leave the names as they download.

### Step 2 · Clean them up

The Meesho tag (`s-971393175`) sits bottom-left on every image. **Use this one command:**

```bash
cd "<project folder>/flipkart-autofill"
npm run images -- --crop-bottom=25 --crop-images=1 --erase-tag=150,30 --erase-images=2,3,4
```

Two different treatments, on purpose:

| Image | Treatment | Why |
|---|---|---|
| **1** (main photo) | **cropped** | It is busy and colourful — a painted patch would show. It goes to the AI next anyway, which rebuilds the background and squares it up |
| **2, 3, 4** | **tag painted out** | Their backgrounds are plain, so the patch is invisible. Cropping would cut real content — on the "what's inside" image the `1 PC GLUE TAPE` label sits at the same height as the tag |

The patch samples the surrounding background colour rather than assuming white (your images
are `rgb(248,244,241)`, not pure white), so the seam does not show. 150×30 is measured on a
real 512×512 download with room to spare — scale it up if your originals are bigger.

Costs nothing — no AI, no internet, no credits. Just your Mac doing arithmetic.

**Open `images/2-clean/ANP-1042/` and check the tag is gone.** If a sliver remains, run again
with a bigger number. Free to repeat.

### Step 3 · The AI (two conversations)

Use **Google AI Studio** (`aistudio.google.com`), *not* the Gemini app — the app stamps a
sparkle logo on the picture, and any logo gets your listing rejected.

**First, type the item list yourself** (one minute, no AI). You pack these kits — you know
what's in them, and the AI cannot count reliably. If image 2 is already a "what's inside"
picture, just read it off:

```
1 x Shubh Annaprashan banner
20 x red latex balloons
20 x golden latex balloons
4 x red heart foil balloons
2 x backdrop net curtains
1 x fairy light, 10 metre
16 x photo props
1 x glue tape
TOTAL: 65 pcs
```

> **Order matters — build the images FIRST, then describe them.** The metadata describes the
> picture that actually goes live, so it has to be written from the **final AI images**, not the
> originals. So Conversation 1 makes the images; Conversation 2 (the JSON) runs on those finals.

**Conversation 1 — build the pictures you'll upload (in ChatGPT). Do this first.**
Full explanation and exact prompts: **"The main image"** and **"Prompt B"** in
`docs/image-playbook.md`.

1. **Main image — a two-message flow** (a third only if a count looks off):
   - *Message 1 — read the pack.* Attach the **"what's in the packet"** image (image 2). Ask it to
     list the contents in text only. Glance at the list.
   - *Message 2 — build it.* It draws a fresh, realistic **square** photo of that decoration set up
     on a wall, using the exact counts (never more).
   - *Message 3 — only if a count is off* (e.g. "4 confetti but there are 3 — remove one").
   → Save it as **`1.png`**, and **delete the old `1.jpg`** — one file per number.
2. **Image 2 — Prompt B** builds the "what's inside" infographic. → Save as **`2.png`**, delete
   the old `2.jpg`.
3. **Images 3, 4** — leave exactly as they are.

> **Where do the generated images go?** Straight into **`images/2-clean/<ID>/`**, replacing what
> stage 1 put there:
>
> ```
> images/2-clean/ANP-1042/1.png   ← the AI's hero shot (delete 1.jpg)
> images/2-clean/ANP-1042/2.png   ← the AI's "what's inside" (delete 2.jpg)
> images/2-clean/ANP-1042/3.jpg   ← untouched from stage 1
> images/2-clean/ANP-1042/4.jpg   ← untouched from stage 1
> ```
>
> Not a new folder, not `1-raw/`, not `3-final/`. Stage 1 deliberately names its output with
> plain numbers (`1.jpg`, not `ANP-1042-1.jpg`) **so the AI's files drop straight in** — the
> product ID only gets stamped on at `--final`. And **the folder name is the product ID**: it
> is how `--final` finds `image-meta/ANP-1042.json` to read the descriptions from. Rename the
> folder and the descriptions silently stop being embedded.
>
> **Delete the file you replaced.** `1.png` and `1.jpg` both sitting there is position 1 twice;
> the tool stops and names the position rather than guessing which you meant.

> ⚠️ Keep the `.png` name — do **not** rename it to `1.jpg`. That's the same relabelling trap as
> `.avif → .jpg`: it changes the label, not the bytes. `npm run finish` (or `images -- --final`)
> converts it for you.

> **The count rule:** the AI builds a fresh arrangement, but the **items and counts must match the
> pack** — never more than the buyer receives. Distinct items (moon, stars, banner) come out exact;
> a dense balloon garland is close, not perfect — check it. A photo promising more than the box
> holds is what kills a listing with returns.

**Conversation 2 — now get the JSON from those final images (Claude/Gemini).**
Upload the pictures you just finished — **the exact images you'll upload** (`1.png`, `2.png`, and
the real `3`, `4`) — paste your **Excel inventory rows**, then **the whole of
`guides/PROMPT-meta.md`** (select all, copy — the file is nothing but the prompt). It replies
with **`image-meta-<ID>.json`**: a description per photo written from these finals, plus the
Meesho copy. Then, **in that same chat**, paste **`guides/PROMPT-product.md`** and send — back
comes **`products-<ID>.json`**, the Flipkart form fields. **Drop each download into `image-meta/`
and `products/` exactly as it downloaded — no renaming.** `image-meta-ANP003.json`, `ANP003.json`
and `ANP-3.json` all read as the same product as a folder called `ANP 3`; prefix, capitals,
spaces, dashes and leading zeros are ignored when matching. A **Meesho-only** product needs only
the first prompt. To copy text into the websites, run `npm run paste -- <ID>` — any of those ID
shapes works — and it prints the Flipkart Description and the Meesho values with the `\n`
escapes undone.

> Save the download *and* a renamed copy and nothing breaks: both match, the **newest** is used,
> and the older one is printed as ignored. Re-download and re-save any time — the fresh file wins.

**Check the corners of what the AI made.** If there's a sparkle logo, generate it again.

### Step 4 · Check the two files landed

You wrote nothing by hand — you saved two downloads in Step 3. This reads them back:

```bash
npm run paste -- ANP003
```

Any ID shape works (`ANP003`, `ANP-3`, `image-meta-ANP003`). It prints the four values you will
paste into the websites, and checks three things you cannot see by looking at the files:

```
[FLIPKART DESCRIPTION]  1144/1400
[MEESHO TITLE]          98/120
[MEESHO DESCRIPTION]    1139/1400
[MEESHO PACK CONTENTS]  212/255
```

| It says | Meaning |
|---|---|
| `(missing)` | the AI's reply was cut short — re-run that prompt, this is WW-081 |
| `⚠️ OVER` | the form will silently truncate it. Shorten it now |
| `⚠️ short — room for more` | a description at half its allowance is search reach thrown away |
| `⚠️ image-meta and products disagree` | **fix this before listing** — see below |

That last one matters most. `Model Name` and `Search Keywords` in `products/` must be
**character for character** the `title` and `keywords` in `image-meta/`, because Flipkart builds
the listing title out of Model Name. Run the two prompts twice, or hand-edit one file, and you
end up with two or three different phrasings of the same kit — the keyword work split between
them instead of compounding, and invisible until the listing is live. `paste` prints both
versions side by side; pick one and copy it into the other file.

**Two files per product, kept apart on purpose:**

| File | Holds | Needed for |
|---|---|---|
| `image-meta/<ID>.json` | picture descriptions + the Meesho copy | **Meesho and Flipkart** |
| `products/<ID>.json` | the 66 Flipkart form fields | **Flipkart only** |

**A Meesho listing needs only the first one.** There is no 66-field form on Meesho, so you never
create a `products/` file for a Meesho-only product. See `START-HERE.md` for the Flipkart one.

<details>
<summary>Writing an <code>image-meta</code> file by hand (rare — only if you skipped the AI)</summary>

Put it in `image-meta/` under any name carrying the ID (`ANP-1042.json`,
`image-meta-ANP1042.json`, …). Copy `image-meta/EXAMPLE-ANP-1042.json` as a starting point.

```json
{
  "title": "Annaprashan Decoration Kit 65 Pcs",
  "keywords": ["annaprashan decoration items", "rice ceremony decoration"],
  "images": {
    "1": "Annaprashan kit set up as a wall backdrop with red and gold balloons",
    "2": "All 65 pieces laid out flat - balloons, banner, fairy light and photo props",
    "3": "Close-up of the Shubh Annaprashan banner"
  }
}
```

The `"meesho"` block (title / description / pack_contents) is what `npm run paste` prints for
the Meesho panel — without it, Step 8 has nothing to copy.

</details>

### Step 5 · Finish the images

```bash
npm run images -- --final
```

Writes each description into its own picture and puts the finished files in
`images/3-final/ANP-1042/`.

**It shows you which file each folder is reading its descriptions from, before it writes
anything:**

```
  Folder -> description file (the folder name IS the product ID):
    2-clean/ANP-1042/             ->  image-meta/ANP-1042.json  (4 per-image descriptions)
    2-clean/GTB-1/                ->  image-meta/GTB-1.json  ✖ NOT FOUND
```

A `✖ NOT FOUND` **stops the run and writes nothing.** That is on purpose: the folder name *is*
the product ID, so a folder named even slightly differently from its JSON used to produce
perfect-looking images with no descriptions in them at all — and nothing told you. Fix the name
or create the file, then run it again.

Genuinely don't have the descriptions yet and just want the pictures?

```bash
npm run images -- --final --force
```

It will not crop again — the tag came off in Step 2, and cutting twice would eat into the
product. If you try, it stops you.

### Step 6 · Look at it

Open `images/3-final/ANP-1042/` in Finder:

- [ ] Is **-1** the main decorated photo?
- [ ] Is **-2** the pack contents?
- [ ] Tag gone? No sparkle logo?
- [ ] Do the products match what's really in the box?

**The computer cannot check any of this.** It doesn't know which photo is which or what's in
your pack. Thirty seconds here prevents uploading in the wrong order.

### Step 7 · Flipkart — upload and fill the form

Upload the `3-final/` files in numbered order, then:

```bash
npm start
```

Pick the product from the list. Follow `START-HERE.md`. Run once per tab of the form.
(`npm run fill -- ANP003` does the same thing without the menu, if you already know the ID.)

**Never save while any field reads ⚠️.** The bot types every value and reads it back; a ⚠️ means
what landed is not what was sent, and that is the whole safety model.

### Step 8 · Meesho — by hand

There is no Meesho API, so this part is copy-paste. Keep the terminal open:

```bash
npm run paste -- ANP003
```

Copy `MEESHO TITLE`, `MEESHO DESCRIPTION` and `MEESHO PACK CONTENTS` straight out of it — they
print with real line breaks, so they go into the panel as-is. Upload the same `3-final/` images
in the same order.

> ⚠️ **Read the shipping figure before you submit.** Meesho sets it from the main image, and one
> of our test images produced **₹256** — a listing that would have sat there earning nothing with
> no obvious cause. Five seconds, every time the main image changes. Everything else about that
> fee has been tested to death: see `SHIPPING-COST.md` and **do not re-run those tests.**

---

## Flow B — when the photos are already clean (`npm run finish`)

Everything above is **Flow A**: raw Meesho downloads with the tag on, going through
`1-raw → 2-clean → 3-final`. But often the photos arrive **already fine** — a WhatsApp folder
from your partner, or images you've already cleaned. Then you don't want the three-folder
pipeline. You want the one useful part: **write the descriptions in, and rename everything into
one flat folder ready to upload.** That is `npm run finish`.

> **When to use which.** Tag still on / needs cropping / needs squaring → **Flow A**
> (`npm run images`). Already clean, square-ish JPEGs → **Flow B** (`npm run finish`).

### The folder shape it expects

```
Whatsapp DW/            ← wherever the downloads live
   ANP/                 ← category code
      ANP 1/            ← one listing   (the FOLDER NAME becomes the ID: ANP 1 → ANP-1)
         1.jpg  2.jpg  3.jpg  4.jpg     ← numbered by position on the listing
      ANP 2/
         1.jpg  2.jpg  ...
   GTB/  HA/  WB/  ...
```

**The only naming rule: name each listing folder `CODE number` (e.g. `ANP 1`, `HBD 2`), and
number the images inside `1, 2, 3, 4`.** That is all the renaming you ever do. The tool turns
`ANP 1` → `ANP-1` and outputs `ANP-1.1.jpg`, `ANP-1.2.jpg` … itself.

### Where the AI's new image goes

Drop the ChatGPT PNG straight into the listing folder as the position it replaces:
- new main image → save as **`1.png`** and **delete the old `1.jpg`**
- regenerated image 2 (Prompt B) → save as **`2.png`** and **delete the old `2.jpg`**
- images 3, 4 you're not redoing → **leave them exactly as they are**

> ⚠️ **One file per number.** If `1.png` and `1.jpg` both sit in the folder, the tool counts
> *two* images at position 1 and pushes every later image down a slot. Always delete the file
> you're replacing.

### The command — one line does everything

Go to the project once:
```bash
cd "/Users/vansh/Coding/Side projects (new ideas)/WishWorks/flipkart-autofill"
```

Then point `--in` at the **whole downloads folder** — it walks every category and every listing
inside on its own:
```bash
npm run finish -- --in="/Users/vansh/Downloads/Whatsapp DW"
```

You can also aim it narrower — at one category, or one listing (a single listing prints which
descriptions file it matched; it only asks when *nothing* matched):
```bash
npm run finish -- --in="/Users/vansh/Downloads/Whatsapp DW/ANP"          # one category
npm run finish -- --in="/Users/vansh/Downloads/Whatsapp DW/ANP/ANP 1"    # one listing
```

Add **`--square`** if the AI handed you a non-square image and you want `finish` to pad/crop it
to 1:1 (off by default — it otherwise leaves your pixels untouched):
```bash
npm run finish -- --in="/Users/vansh/Downloads/Whatsapp DW" --square
```

Everything lands **flat, all listings together**, in `~/Downloads/wishworks-ready/` —
`ANP-1.1.jpg`, `ANP-1.2.jpg`, `ANP-2.1.jpg` … no sub-folders. Those are the upload files.

### Three things to know

1. **Two files at the same number is now caught, not silent.** If you dropped the AI's `1.png`
   in but forgot to delete the old `1.jpg`, `finish` **stops that listing** with
   *"two files share a position number"* instead of quietly shifting every later image down a
   slot. Delete the one you replaced and re-run. (One file per number — always.)
2. **Folder names are up to you — number *or* descriptor.** `ANP 1` → `ANP-1`;
   `HBD-kitty` → `HBD-kitty`; `HBD-space - p` → `HBD-space`. When the name has a number that's the
   ID; when it doesn't, the descriptive word **is** the ID (kept, just tidied to a clean slug).
   A trailing **`- p` (your "pending" flag) is dropped**, so the ID is the same before and after
   the listing stops being pending. So name folders however you identify the listing — no `--id`
   needed. (`--id=` is still there to force one on a single folder.) Just make sure two listings
   don't clean to the *same* ID, or their files would overwrite each other in the flat output.
3. **Descriptions come from `image-meta/`**, keyed by position:
   `{"images": {"1": "…", "2": "…"}}`. **Save the download under whatever name it arrives with** —
   `image-meta-ANP003.json`, `ANP003.json` and `ANP-3.json` are all read as the same product as a
   folder called `ANP 3`, so there is no renaming step. (Prefix, capitals, spaces, dashes and
   leading zeros are all ignored when matching.) If no file matches, `finish` still renames and
   copies the images — it just embeds no description and says so.

   If **two** files match — say you kept `ANP003.json` *and* `image-meta-ANP003.json` — it uses
   the **one you saved last** and prints the older one as ignored. No menu, nothing to delete:
   they are the same product either way, so the only question is which copy is current.

> ⚠️ **Without `--square`, `finish` does not resize or square** — it trusts the pixels as-is. So
> either get a square (1:1) image from ChatGPT, add `--square`, or use **Flow A**'s
> `npm run images -- --final`, which always squares.

### Then carry on with Flow A

`finish` replaces Steps 1, 2 and 5 only. Everything after the images exist is identical:
**Step 4** (`npm run paste -- <ID>` — check the two files landed and agree), **Step 6** (look at
the output), **Step 7** (`npm start` for Flipkart) and **Step 8** (Meesho by hand, reading the
shipping figure before you submit). The only difference is where the finished files are:
`~/Downloads/wishworks-ready/` instead of `images/3-final/<ID>/`.

---

## Reading the messages

| You see | Meaning |
|---|---|
| `1.avif -> 1.jpg  512x512 -> 1500x1500` | Worked |
| `padded white` | Photo wasn't square; white added at the edges. Invisible on white backgrounds |
| `centre-cropped` | Wasn't square and the background wasn't white, so edges were trimmed |
| `cropped 40px off bottom` | The tag was cut off |
| `erased 130x26px tag at bottom-left` | The tag was painted over with the background colour |
| `⚠️ SOURCE ONLY 512px` | **Photo is too small** — see below. **Flow A only.** `finish` does not count pixels: there the size is your call, and a smaller main image is often the deliberate one (`SHIPPING-COST.md`). 1254×1254 is a fine image |
| `⚠️ NOT SQUARE 1024x1536` | **`finish` only.** The image isn't 1:1, so it would go out the odd one in a listing of squares. Ask the AI again for a square, or re-run with `--square` to pad/crop it. Nothing is resized without that flag |
| `no per-image description for position 3` | Add a line for `"3"` in the product file |
| `not named 1, 2, 3…` | Rename the files to plain numbers |
| `Problems: ✖ …` | That one file failed; the rest still worked |

---

## The one problem the software cannot fix

Photos downloaded from the Meesho website are **512×512**. That is half what the zoom feature
needs and a third of the target. Enlarging cannot put back detail that was never there — the
picture will look soft next to competitors', on the exact image that decides whether anyone
clicks.

**Get the original photos from whoever took them** — the phone or camera they came off,
which will be 2000px or more. No setting, prompt or command fixes this.

---

## Every command

| To do this | Type this |
|---|---|
| Clean up downloaded photos *(Flow A)* | `npm run images -- --crop-bottom=25 --crop-images=1 --erase-tag=150,30 --erase-images=2,3,4` |
| …without removing any tag | `npm run images` |
| Finish photos + write descriptions *(Flow A)* | `npm run images -- --final` |
| Same, for photos already clean *(Flow B)* | `npm run finish -- --in="<folder>"` |
| **Get the copy to paste into the websites** | `npm run paste -- <ID>` |
| Fill the Flipkart form | `npm start`  (or `npm run fill -- <ID>`) |
| Did the descriptions really go in? | `npm run check` |
| Log in to Flipkart (once ever) | `npm run login` |
| Flipkart changed the form — re-read its fields | `npm run scan balloon-decoration` |
| Check the tool still works | `npm test` |

Every one starts with going to the right folder:
```bash
cd "<project folder>/flipkart-autofill"
```

---

## What's proven, and what isn't

Straight answers, because guessing costs real money.

**Tested and certain:**
- Flow A output is exactly 1500×1500, correct colour, correct format. **Flow B does not resize** —
  the pixels you give `finish` are the pixels that go out, which is deliberate
- Each image carries its own description inside the file
- Your downloads are never modified; re-running is always safe
- Meesho's shipping fee is set by the **main image**, deterministically — but **fourteen live
  tests found no rule for which image is cheap.** Closed. Read the figure, don't chase it
- **75 automated tests** cover this — run `npm test`

**Not certain yet:**
- **Whether Meesho or Flipkart read the descriptions inside images.** The text is definitely
  in the file; whether it does anything is unknown, and a test is planned. It costs nothing,
  so it stays on — but don't count on it.
- **The Price/Stock/Shipping tab** of the listing form has never been run on the real site.
  Expect warnings there; don't let it save until a run comes back clean.

Every mistake made while building this is written down in `docs/tracks/notion/CORRECTIONS.md`.

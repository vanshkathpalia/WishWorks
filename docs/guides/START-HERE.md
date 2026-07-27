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
3. **The whole of [`PROMPT.md`](PROMPT.md)** — see Part 3 below.

The AI replies in **three labelled sections**. Sections 1 and 2 are each a complete file,
named after the product ID (e.g. `ANP-1`); section 3 is text you copy into the websites:

1. **Section 1 — Image metadata** → save as **`image-meta/ANP-1.json`**. The picture
   descriptions, used by **both** Meesho and Flipkart images, plus the Meesho copy.
2. **Section 2 — Flipkart listing fields** → save as **`products/ANP-1.json`**. This is what
   fills the Flipkart form.
3. **Section 3 — Paste block** → don't save it anywhere. It's the description and Meesho text
   as plain readable text, ready to copy straight into the two websites.

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

## Part 3 — THE PROMPT

**The prompt lives in its own file: [`PROMPT.md`](PROMPT.md).**

That file is nothing but the prompt — no headings, no notes, no fence to dodge. Open it,
select all, copy. There is nothing in it you need to leave out.

Then, in Claude or ChatGPT, in ONE message:

1. Upload **all** the product images, in order — image 1 first.
2. Paste the whole of `PROMPT.md`.
3. Replace the `<PASTE YOUR EXCEL ROWS HERE>` line with your inventory rows.

Send. The reply comes back in the three sections described below.

> Editing the prompt? Edit `PROMPT.md`. Nothing else reads it, and it is deliberately kept
> free of anything that is not the prompt itself, so that select-all stays safe.

### After the AI replies

Give it a quick read — you know the product better than it does. Two checks:
- **Counts and items** should match your Excel inventory exactly (they should, since the AI was
  told to copy them — but confirm). If `not_visible` lists anything, an inventory item isn't
  shown in your photos: decide whether to add a photo or drop the item.
- **Colours** against the photos — the one thing the AI still reads from the images.

The reply comes back in three labelled sections, so there is nothing to cut apart by hand:

| Section | What to do with it |
|---|---|
| **1 — Image metadata** | Select the whole JSON block, save as `image-meta/<ID>.json` |
| **2 — Flipkart listing fields** | Select the whole JSON block, save as `products/<ID>.json` |
| **3 — Paste block** | Do **not** save. This is what you copy into the two websites |

Each of the first two is already exactly one file's worth of JSON. **Never paste section 3
into a `.json` file** — it is plain text, it will not parse, and the tools will refuse to run.

The paste block exists because JSON has no other way to store a line break than `\n`. That
is not the AI getting it wrong and no prompt wording removes it — the escape is required for
the file to parse. Section 3 is the same text with the escapes undone, so you copy from
there and never from the JSON.

**For the Meesho listing**, take `[MEESHO TITLE]`, `[MEESHO DESCRIPTION]` and
`[MEESHO PACK CONTENTS]` straight out of section 3 into the Supplier Panel. Nothing
automates this yet; Meesho has no public API.

> **Why this is still one message and not three prompts.** Splitting it into "images first,
> then copy, then Flipkart fields" looks tidier and is worse: the photos are only genuinely
> *seen* in the message they were uploaded with. By message three the AI is working from its
> own earlier summary of the photos, not the photos — which is exactly how invented items
> and wrong colours get in. One message, three sections, keeps the evidence and the answer
> in the same place.

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
4. **Feed the prompt.** Insert the keyword bank and the known-good values into `PROMPT.md`,
   so the AI picks from what has worked rather than inventing.
5. **Flag the weak listings.** The same data shows which existing listings are missing
   attributes or keywords — a ranked to-do list of fixes worth more than new listings.

Rough order of value: step 2 pays for itself fastest, step 3 removes the most manual work,
step 5 is where the existing catalogue starts earning more without new products.

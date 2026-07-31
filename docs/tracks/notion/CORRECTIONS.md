# Corrections ledger — every mistake, how it was caught, what fixed it

> **Purpose.** A diagnosis trail. When a more capable model (or a new chat, or a new person)
> picks this project up, this file tells them *where the assistant's judgement failed and
> why* — which is far more useful than a clean summary of what shipped.
>
> One entry per mistake. Append-only, newest at the bottom. Never delete an entry — a
> withdrawn claim is the most valuable kind of record here.
>
> Companion to [`TICKET_STATUS.md`](TICKET_STATUS.md) (what's done).

## How to read an entry

| Field | Meaning |
|---|---|
| **Class** | `Design` (wrong plan) · `Code` (wrong implementation) · `Fact` (wrong claim about the world) · `Process` (didn't follow the project's own rules) |
| **Caught by** | Who/what found it. **"Vansh"** entries are the ones to worry about — they mean it shipped past the assistant |
| **Cost** | Rough time or trust lost |
| **Status** | `Fixed` · `Withdrawn` · `Open` |

---

## C-001 · Architecture-first build that helped nobody
**2026-07-19 · Class: Design · Caught by: Vansh · Cost: ~6 hours · Status: Fixed**

Built a full `docs/architecture/` set centred on a data-analytics/intelligence dashboard
before building anything runnable. Vansh: *"very very bad architecture you have made i must
say — this isn't helping me with anything."*

**Root cause.** Took the planning doc's framing (a "seller intelligence platform") as the
goal, when the actual goal was "listing new products is hectic, make it stop being hectic."
Also ignored an explicit instruction given the same day: *"don't care about role part — FE BE
track and all, just build the architecture basic one, then we will proceed coding straight
after."*

**Fix.** Pivoted to `flipkart-autofill/`. Recorded as a standing rule in `CLAUDE.md`:
*"Tools first, docs second: an architecture-doc-first approach was tried and rejected."*

**Lesson for the next model.** In this project, a document that does not make a listing go up
faster is overhead. Build the thing that kills the next manual task.

---

## C-002 · Login check looked for guessed cookie names
**2026-07-20 · Class: Code · Caught by: Vansh · Cost: ~45 min · Status: Fixed**

`npm run login` reported *"No Flipkart session cookie found — did the login finish?"* after
Vansh had genuinely logged in. The check searched for cookies matching `session|Token` —
names that were guessed, never verified. Flipkart actually uses `connect.sid` / `sellerId` /
`is_login`.

**Root cause.** Assumption stated as a check. Compounded by a second wrong assumption: that
cookie *presence* proves a live session, when only the server's redirect behaviour does.

**Fix.** Check the real cookie names, and treat the server's response as the authority.

**Lesson.** A false green is worse than a red — it sends Vansh debugging his own setup.

---

## C-003 · `npm run scan` captured 0 fields, then 40 wrong ones
**2026-07-20 · Class: Code · Caught by: Vansh · Cost: ~1 hour · Status: Fixed**

First scan: *"Captured 0 new fields (2 total)"*. After fixing, it captured 40 — but the
labels were garbage: `string`, `WishWorks`, `Select`, `0/5000`. Vansh: *"bro many of these
are wrong."*

**Root cause.** The label-detection walked to the nearest text node rather than the element's
actual associated label, so it picked up placeholder text, character counters and the brand
name.

**Fix.** Label-based targeting, written up in `docs/learning/1-label-targeting-over-keyboard-macros.md`.

---

## C-004 · Regex matched the wrong thing and a code path silently never ran
**2026-07-20 · Class: Code · Caught by: Vansh (via garbage output) · Cost: ~30 min · Status: Fixed**

Scan output contained `SearchSearchCheckSelect OneCheckYesCheckNo`. The regex `/^Search+Check/`
matches `"Searc"` + one-or-more `"h"` + `"Check"` — not a repeated `"Search"` as intended. The
branch meant to clean up combobox labels never executed.

**Root cause.** `+` applied to the preceding *character*, not the preceding *group*.
Classic, and invisible without a test.

**Fix.** Correct grouping. **Lesson:** this bug produced no error — only wrong output. Any
regex written here needs an actual sample string run through it.

---

## C-005 · Session lost between commands, forcing repeated logins
**2026-07-20 · Class: Design · Caught by: Vansh · Cost: ~30 min + real frustration · Status: Fixed**

`npm run login` said the session was saved; `npm run scan` then demanded login again. Vansh:
*"fuck the hell man… if it is saved then why is it asked here to login again."*

**Root cause.** Separate browser contexts — the persistent profile wasn't shared across
commands.

**Fix.** Shared persistent profile directory (`profile/`, gitignored). Login once, ever.

---

## C-006 · Multi-value fields reported ⚠️ because verification read the wrong place
**2026-07-20 · Class: Code · Caught by: Vansh · Cost: ~1 hour · Status: Fixed**

`fill` reported `⚠️ Ideal For — wanted "Boys, Girls, Men, Women" but field shows ""` for a
dozen fields — yet the values were visibly present on the form.

**Root cause.** Multi-value fields render entered values as chips/tags *outside* the input.
Read-back checked `input.value`, which is correctly empty after each entry commits.

**Fix.** Read the committed chips for multi-value fields. **Lesson:** the read-back design
was right; it was verifying the wrong DOM node.

---

## C-007 · Claimed a specific frame-fill percentage that was wrong, and inverted
**2026-07-21 · Class: Fact · Caught by: Vansh · Cost: trust · Status: Withdrawn / corrected**

`docs/image-playbook.md` stated *"both platforms want the product at 70–85% of the frame"*
and, worse, *"filling the frame edge-to-edge is an over-crop rejection."*

Vansh challenged it directly — his partner's live listings run the product at ~100% of the
width and sell fine — and asked which sources were used.

**On re-checking:**
- Flipkart's figure is **"at least 85%"** — a *minimum*, i.e. fill **more**. The doc had the
  direction backwards.
- Meesho publishes **no** frame-fill percentage. The "70–80%" came from a search-result
  summary; **opening the cited page showed the number is not on it.**
- The edge-to-edge rejection claim had **no source at all.** It was inferred and stated as
  fact.

**Root cause.** Quoting search-result summaries without opening the pages, then adding an
inference and presenting it in the same register as sourced material.

**Fix.** Numbers corrected, a standing warning section added to the playbook, and every spec
in it now carries its confidence level and source type.

**Lesson for the next model.** This is the highest-value entry in this file. Vansh's
observation of live listings beat every secondary source cited. When he says a claim looks
wrong, re-verify — do not defend.

---

## C-008 · Claimed image metadata does nothing, without evidence
**2026-07-21 · Class: Fact · Caught by: Vansh · Cost: trust · Status: Withdrawn — question is open**

The playbook asserted *"there is no alt-text field, the filename is discarded, anyone selling
you image alt tag optimisation for Meesho is selling nothing."*

Vansh countered with real evidence: a seller known to his partner adds descriptions/tags to
image metadata and gets notably more orders.

**On re-checking:** no evidence was found in **either** direction. Neither platform publishes
anything about reading EXIF/IPTC. The confident denial was unsupported.

**Fix.** Claim withdrawn. Playbook now states the question is open, lists three competing
explanations (metadata is read / he means visible on-image text / something else entirely),
and recommends the cheap resolving action: **ask him which field he actually fills.**
`npm run images` writes the metadata anyway, since it is free and carries no policy risk.

**Lesson.** "I could not verify this" and "this does not work" are different statements.
Only one of them was true.

---

## C-009 · sharp `.stats()` ignores queued operations — white detection was measuring the whole image
**2026-07-21 · Class: Code · Caught by: assistant (own test) · Cost: caught pre-delivery · Status: Fixed**

`images.ts` decides pad-vs-crop by sampling brightness at each edge. On test images with
plainly white backgrounds it reported "not white" and centre-cropped them.

**Root cause.** sharp's `.stats()` resolves against the **input** image and ignores queued
operations, so `.extract(region).stats()` measured the entire image, not the strip.

**Fix.** Render the strip to a buffer first, then run `.stats()` on that buffer.

---

## C-010 · Output images were not square — the tool's single core promise, silently broken
**2026-07-21 · Class: Code · Caught by: assistant (own test) · Cost: caught pre-delivery · Status: Fixed**

Outputs measured **1500×1600** and **1500×1550**. The entire purpose of the tool is to
guarantee a 1:1 square, and it was not doing it — with no error raised.

**Root cause.** sharp applies operations in a **fixed internal order regardless of call
order**: `resize` runs *before* `extend`. So the image was resized to 1500×1500 and the
padding was then added on top.

**Fix.** Materialise the squared image to a buffer before resizing. Verified: all 8 outputs
across both modes measure exactly 1500×1500 RGB, and a padded output was viewed to confirm
no distortion.

**Lesson.** Both C-009 and C-010 were found only because the tool was run on generated images
covering each edge case *before* being handed over. Had it shipped, C-010 would have caused
silent marketplace rejections that looked like a Flipkart problem, not a tool problem.

---

## C-011 · Ignored the project's own operating manual and reached for the Notion MCP
**2026-07-21 · Class: Process · Caught by: Vansh · Cost: ~10 min + a wasted MCP call · Status: Fixed**

Asked to create tickets, the assistant read only the first 60 lines of
`ADOPT_THIS_SYSTEM copy.md`, then searched Vansh's connected Notion workspace — which belongs
to a **different account and a different project** (Harehare.com / puja-services).

The manual says plainly (§7, §7a) that this project keeps `TICKET_STATUS.md` and
`NOTION_SYNC.md` **in the repo**, written for a *separate* Notion-connected Claude, precisely
because the MCP in this session is the wrong account.

**Root cause.** Read the summary banner, not the spec. Acted on a partial read of a file that
was open and available in full.

**Mitigating note.** The banner's own rule #3 ("names may differ — FLAG, never assume") was
followed: nothing was written to Notion, and the mismatch was flagged.

**Fix.** Read §7/§7a/§7b properly and built the files this document lives in.

**Lesson.** When a project ships an operating manual, read the section that covers the task
before using a tool that bypasses it.

---

## C-012 · Image metadata: writing is proven, *reading* by the marketplaces is still unproven
**2026-07-21 · Class: Fact · Caught by: Vansh · Cost: none yet · Status: Open**

Follow-up to C-008. Vansh asked the right question: *"is this approach actually effective, or
are you bluffing with some AI bluff or tool bluff? Be honest — is it happening or not?"*

**What was tested, and what it proved.** Ran the real tool on a real product file
(`TEST-9001`) and inspected the output three ways:

- sharp read back a **314-byte EXIF block** on both output images.
- `strings` on the raw file header shows the text **literally present in the JPEG bytes**:
  `Annaprashan Decoration Kit 58 Pcs, annaprashan decoration items, rice ceremony decoration,
  first food ceremony kit`
- macOS `mdls` returned null — Spotlight simply doesn't index `ImageDescription`; not
  counter-evidence.

**Verdict on the mechanism: real, not a bluff.** The metadata is genuinely embedded in the
file that gets uploaded.

**What is still NOT proven — and this is the part that matters.** Whether Flipkart or Meesho
*read* it. Attempted to fetch a Meesho CDN image to check whether their served images retain
EXIF; blocked (`403`). So the question C-008 opened remains open.

**Honest estimate:** probably does nothing. Marketplaces re-encode uploads into their own size
variants, and re-encoding normally drops EXIF. Stated as an estimate, not a finding — that
distinction is exactly what went wrong in C-008.

**The decisive test, free, blocked on Vansh (WW-023):** take a raw `.webp` downloaded from
Meesho and check whether it carries any EXIF. If Meesho's served image has stripped the
original seller's metadata, that proves they strip on upload and the tactic is dead. Same
files already requested for WW-021 answer this too.

**Second finding — a real limitation Vansh spotted before the tool did.** Every image of a
product currently gets the **same** description. He is right that it should differ per image
(main shot vs contents shot vs lifestyle). Logged as WW-028.

**Lesson.** "The tool does X" and "X has an effect" are two separate claims needing two
separate proofs. The first is now proven; the second is not, and must not be reported as if
it were.

---

## C-013 · Built the metadata feature without the AI step Vansh had already specified
**2026-07-21 · Class: Design · Caught by: Vansh · Cost: ~1 rebuild · Status: Fixed**

`npm run images` was built to pull the image description from `Model Name` + `Search
Keywords`, giving every image of a product the **same** text. Vansh: *"bro i have said you
this earlier also — the description should [be] given by the ai and be acc. to the 2 images i
am feeding."*

He had said it earlier, twice. It was not implemented.

**Root cause.** Took the easy data source already sitting in the product file instead of the
one he specified. The two source images — the hero shot and the contents flat-lay — are
already being fed to the AI in Step 0, so the descriptions could have come from there from
the start. Building from what was convenient rather than from the stated requirement.

**Fix.**
- Step 0 prompt now takes **both** images and returns an `images` block alongside the
  inventory, with an explicit instruction that the descriptions must not be interchangeable.
- Product `.json` gains a top-level `"images": {"1": …, "2": …}` block.
- `descriptionsFor()` reads it per position, falling back to Model Name + keywords and
  **reporting** which images used the fallback.
- Verified: 3 output images carried 3 distinct EXIF strings, fallback confirmed on position 3.

**Business effect.** Descriptions are now grounded in what is actually in each specific
picture rather than a generic keyword blob. **Caveat carried forward from C-012: whether any
marketplace reads this is still unproven.** The feature is correct; its value is not yet
established.

**Lesson.** When the user has stated a requirement more than once and the implementation
doesn't reflect it, that is not a missed detail — it is not having listened. Re-read the
user's own words before designing a data flow they already described.

---

## C-014 · "Non-square images are rejected" — contested by a live listing
**2026-07-21 · Class: Fact · Caught by: Vansh · Cost: none yet · Status: Open**

The playbook lists *"image dimensions not exactly square (1:1)"* as a top rejection reason,
sourced from blogs.

Vansh produced counter-evidence: a **live, selling Meesho listing** whose image is
**512 × 212** — a 2.4:1 strip, nowhere near square. Meesho displays it inside a square frame
with white padding above and below. Measured directly from the file he supplied.

**Status: unresolved, and the ambiguity matters.** What the CDN *serves* is not necessarily
what the seller *uploaded* — Meesho may pad or derive variants. Two live possibilities:

- **A.** Meesho accepts non-square uploads and pads them for display. → the "rejection" claim
  is wrong.
- **B.** The seller uploaded square-with-whitespace and the CDN served a trimmed derivative.
  → the claim may hold, and we are reading a display artefact.

**What to do about it (unchanged either way).** Uploading a square 1500×1500 is **never
wrong** — it is accepted under both hypotheses. The tool's behaviour stays. But the playbook
must stop asserting the rejection claim as fact.

**Resolution path.** Ground truth is the Supplier Panel's own validation: try uploading a
deliberately non-square test image and see whether it is refused. That is the only test that
settles it. Logged as WW-034.

**Lesson.** Third time a blog-sourced image spec has been contradicted by Vansh's direct
observation (C-007, C-008, C-014). The pattern is not "some blogs are wrong" — it is that
**blog-sourced marketplace specs are unreliable as a class** and should never be stated in
the same register as verified facts.

---

## C-015 · Meesho's served image carries no EXIF — first real evidence on the metadata question
**2026-07-21 · Class: Fact · Caught by: assistant (measuring Vansh's file) · Status: Open, strong signal**

While measuring the 512×212 file from the live listing, checked it for metadata:
**`exif: NONE`.** Zero bytes.

This is the first hard data point on the question opened in C-008 and left unresolved in
C-012. If that file came from Meesho's CDN, then Meesho serves images **stripped of all
EXIF** — which is what re-encoding does, and it means an uploaded `ImageDescription` reaches
no shopper and no crawler.

**Not yet conclusive**, for one reason: we do not know whether the original upload had EXIF
to begin with. Many sellers' images never carry any.

**What would settle it:** confirm how Vansh obtained the file (saved from the live Meesho
page vs sent by his partner). If it came off Meesho's CDN, the tactic is dead — for us *and*
for his partner's friend, which would also explain C-008 as correlation rather than cause.

**Current standing.** The metadata writing stays on — free, no policy risk — but the honest
expectation shifts from "unknown" to **"probably does nothing on Meesho."**

---

## C-016 · SETTLED: Meesho strips descriptive metadata. The image-SEO tactic is dead.
**2026-07-21 · Class: Fact · Caught by: Vansh supplying the real file · Status: Closed**

Vansh corrected a wrong assumption first: downloads from Meesho are **`.avif`**, not `.webp`
or `.jpg`. He supplied a real one (`1.avif`, 512×512, 28 KB).

**It does carry EXIF — 186 bytes — which initially looked like it contradicted C-015.**
Parsing the actual tags settles it the other way:

```
Orientation       = 1
XResolution       = <rational>
YResolution       = <rational>
ResolutionUnit    = 2
YCbCrPositioning  = 1
ExifIFD           → pointer
```

**Technical tags only.** No `ImageDescription`, no `XPKeywords`, no `Artist`, no `Copyright`,
no text of any kind. This is precisely the minimal EXIF block an image pipeline *generates*
when it re-encodes — not metadata passed through from an upload.

**Conclusion.** Meesho re-encodes every uploaded image and writes fresh technical-only EXIF.
Any `ImageDescription` a seller embeds is discarded before a shopper or crawler ever sees it.

**Therefore:**
- The metadata that `npm run images` writes **will not survive upload to Meesho.** It is
  harmless, costs nothing, and does nothing.
- Vansh's partner's friend's better results (C-008) have **some other cause.** Most likely
  visible on-image text — the thing Prompt B already produces — or price/ratings/dispatch.
- C-008, C-012, C-015 all close here. The original blunt claim in C-008 turned out to be
  *right for Meesho* — but it was still wrong to assert it without evidence, and being
  accidentally right is not vindication.

**Lesson.** The question took four entries and was finally settled in one step by **looking
at the actual artefact the user handles every day.** No amount of searching got there. When a
question is about a real system, ask the user for a real file first, not last.

---

## C-017 · Tool could not read the format Vansh actually downloads
**2026-07-21 · Class: Code · Caught by: Vansh · Status: Fixed**

`images.ts` accepted `.webp/.jpg/.png/.tif/.gif/.bmp` — **not `.avif`**, which is what Meesho
actually serves. Every real download would have been skipped with "no readable images in the
folder." The tool was built and tested entirely against invented `.webp` samples.

**Fix.** Added `.avif`, `.heic`, `.heif` to the accepted list. Verified on Vansh's real file:
`1.avif  512x512 -> 1500x1500  already square`, valid JPEG out.

**Lesson.** Every earlier assumption about the input format came from Vansh's own phrasing
("I download the image… the format is, I guess, webp") and was never checked against a real
file. One sample file at the start would have prevented this.

---

## C-018 · Real downloads are 512×512 — far below the usable threshold
**2026-07-21 · Class: Fact · Caught by: assistant (measuring the real file) · Status: Open — needs Vansh**

The real Meesho download is **512 × 512**. That is *half* the 1000px minimum that unlocks
Flipkart zoom, and a third of the 1500px target. The tool correctly flags it:
`⚠️ SOURCE ONLY 512px — will look soft, re-download a larger original`.

**Business impact — this outranks everything else currently open.** Every listing built from
website downloads will be visibly softer than competitors', on the one image that determines
click-through. No amount of upscaling, prompting or SEO compensates for a 512px source.

**What to do (WW-035):** stop sourcing images from the Meesho product page. Get the originals
from the partner directly — his camera roll or whatever he uploaded from — which will be
2000px+. If unavailable, reshoot. This is a sourcing problem, not a software problem, and no
change to the tool can fix it.

---

## C-019 · Over-concluded on metadata a second time — C-016 is WITHDRAWN
**2026-07-21 · Class: Fact · Caught by: Vansh · Status: Withdrawn; question reopened**

C-016 declared the metadata question "SETTLED — Meesho strips it," reasoning that the
technical-only EXIF in `1.avif` was freshly generated by a re-encoder.

**Vansh's objection, which is correct:** his partner **never wrote a description on that
image.** Its absence therefore says nothing about whether Meesho preserves descriptions. The
fact that EXIF is present *at all* shows metadata does travel through the pipeline.

**A detail that actively supports his reading, missed on the first pass.** The block contains
`YCbCrPositioning` (0x0213) — a **JPEG-domain tag**. An AVIF encoder generating fresh metadata
has no reason to emit it. Its presence indicates the EXIF was **carried over from the original
JPEG upload**, not regenerated. The full tag set (Orientation, X/YResolution, ResolutionUnit,
YCbCrPositioning) is exactly what a phone or Photoshop JPEG export writes when no description
was set.

**Revised standing:** evidence now tilts *toward* metadata surviving Meesho's pipeline —
the opposite of C-016. Still not proven.

**The failure pattern, stated plainly.** This same question has now been answered
overconfidently **three times**: C-008 ("does nothing" — unsourced), C-016 ("settled, does
nothing" — over-read one file), and in between C-012/C-015 leaning the same way. Every
correction came from Vansh. The pull each time was to convert *absence of evidence* into a
*conclusion*, because a conclusion feels more useful than "unknown."

**Fix — stop reasoning, run the experiment.** Built
`METADATA-TEST-upload-this.jpg`: 1500×1500, valid, with the unique marker
`WISHWORKS-METADATA-TEST-XK7Q9` written into ImageDescription, Artist and Copyright.
Procedure (WW-023, reopened):

1. Vansh uploads it to Meesho as a test catalog image.
2. Once live, downloads the served `.avif` from the product page.
3. Send it back; check whether `XK7Q9` survives.

`XK7Q9` appears in no real listing, so a match is unambiguous. One upload ends four entries
of speculation.

**Lesson.** When a question is about a live system the user has access to and the assistant
does not, the correct move is to **design an experiment for them to run**, not to infer
harder from artefacts. This should have been the response at C-008.

---

## C-020 · Prompt A turned assembled decorations into white-background parts flat-lays
**2026-07-24 · Class: Design · Caught by: Vansh · Status: Fixed**

Prompt A (the main-image edit) instructed the model to *"rebuild the background as a clean,
seamless, near-white studio backdrop,"* *"remove all room clutter,"* and *"re-arrange... latex
balloons clustered... small items grouped along the lower area."* Vansh ran it on real product
photos and every output did the same thing: it took a **beautiful assembled decoration** (a
balloon garland arch on a backdrop, set up in a room — the exact "this is how your wall will
look" shot that sells a decoration kit) and converted it into a **flat-lay of separate items
floating on white**, balloons tied into bouquets, the backdrop curtain shrunk to flat sample
squares. Proven across two products (Annaprashan and a Welcome Baby kit) with before/after
screenshots.

**The root error.** The prompt was written under a generic-combo philosophy — "show every item
cleanly on white" — which is image 2's job (the contents shot / Prompt B). Applied to image 1 of
a *decoration kit*, it destroys the one asset that drives the click: the finished, in-room look.
We were making the hero image do the contents image's job.

**Second failure in the same prompt.** Its closing guard said *"if an item is not clearly visible
in EITHER photo, say so and stop — do not invent it."* On a minor banner-text mismatch between
the two source photos, Gemini took "stop" literally and **refused to generate at all**, returning
a paragraph of analysis instead of an image. A guard meant to catch the partner's inventory
mistakes became a brick wall.

**Fixes (both in `image-playbook.md`).**
1. Prompt A rewritten to **keep the arrangement assembled** and restyle only the *setting* (wall
   colour, backdrop colour, lighting, angle) into a clean but *real* room — Vansh chose the
   real-room look (his "Welcome Baby" original as the standard). White flat-lay explicitly
   forbidden for the main image; it remains correct for image 2.
2. The guard is now **soft**: the model reads the inventory back, flags mismatches, and **waits
   for the human's "go"** instead of refusing — the human is the checkpoint, not the AI.
3. Reconciled the knock-on contradictions (the "arrangement is fair game" rule, the "main = white
   background" spec row, the lifestyle-variant note).

**Lesson.** A prompt is a spec, and this spec encoded the wrong *product philosophy*, not just
wrong wording — the length was fine, the intent was wrong. When generated output is consistently
"bad," read the prompt as if it were code doing exactly what it says; the model was obeying.
Also: never tell an image model to "stop" as a safety valve — make it *report and wait*, so a
human decides.

---

## C-021 · Kept tuning prompt wording against a hard model limit (exact counts)
**2026-07-24 · Class: Design · Caught by: Vansh · Status: Fixed / limit documented**

After C-020, the main-image prompt was rewritten several more times with Vansh testing each live.
Two things took too long to admit:

1. **"Edit the existing photo" returned a near-identical image.** Locking the product hard + only
   optional background permissions left the model nothing it was *required* to change, so it handed
   back almost the same picture. Vansh (correctly) read that as the tool doing nothing. The fix was
   to stop *editing* and instead **build a fresh arrangement from the "what's in the packet" sheet**
   — the AI's real strength is *reading* that sheet (it prints exact counts), not preserving a photo.

2. **Chased exact balloon counts through wording, repeatedly.** Image generators cannot render exact
   quantities. I kept implying the next wording would fix "3 confetti came out 5." It won't, for
   items that blend into a cluster. What actually holds: **big distinct items (moon, stars, banner)
   the model CAN count and gets exact; dense latex garlands it cannot** — so we cap + tell it to
   *space, not pack* the balloons (close, not exact), and note the only real guarantee is a photo of
   the assembled kit. Said plainly to Vansh only after several rounds.

**Final method (now in `image-playbook.md`, "read the pack → build the decoration"):** ChatGPT,
two messages — (1) read the contents sheet in text only, summing the total if the sheet doesn't
print one; (2) build the decoration honouring the DISPLAYED counts, distinct items exact, latex
spaced/capped, zero text drawn in the image — plus an optional third message the operator writes
from their own review to fix a specific count. Old prompts archived at the foot of the playbook.

**Lesson.** When output keeps missing in the *same* way across many prompt edits, the cause is
usually a model *capability limit*, not unfound wording. Name the ceiling early, design around it
(play to the model's strength — here, reading — and let a human check the rest), and stop spending
the user's credits (and patience) proving the limit again.

---

## C-022 · "Save as 1.jpg" invited the very rename trap the same docs warn against
**2026-07-25 · Class: Process · Caught by: Vansh · Cost: minutes · Status: Fixed**

THE-FLOW.md and the image-playbook pipeline diagram told the user to save ChatGPT's main
image "as `1.jpg`". But ChatGPT hands back a **`.png`**, and the same documents warn (correctly,
loudly) that renaming `.avif → .jpg` relabels bytes without converting. So the instruction quietly
told the reader to do the one thing the rest of the page forbids. Two further hazards: (1) saving
`1.png` *next to* the Step-2 `1.jpg` leaves two files numbered `1`, and the tool numbers output by
loop position (`images.ts` `i + 1`), not filename — so every later image shifts down a slot; (2) a
reader who *did* rename png→jpg would still work by luck, because `sharp` reads bytes not extension,
which hides the mistake until someone skips `--final`.

**Fix.** Both docs now say: save as `1.png`, delete the old `1.jpg` (one file per number), keep the
`.png` name, and let `--final` convert it.

**Lesson.** A "just save it as X" instruction has to agree with the format the tool upstream
actually produces. When a doc already teaches a rule (renaming ≠ converting), every later step must
obey it — an exception buried in a step reads as permission to break the rule.

---

## C-023 · Described the images before generating them — wrong order
**2026-07-25 · Class: Design · Caught by: Vansh · Cost: minutes · Status: Fixed**

The unified flow I laid out ran the metadata/fields prompt *before* generating the AI images —
so the per-image descriptions would have described the **original** photos, not the AI-rebuilt
main image and Prompt-B infographic that actually get uploaded. Vansh: *"first we should generate
the AI image, and then make the metadata … in the metadata we should upload the image that we are
finally going to upload."*

**Root cause.** I merged the two prompts (WW-048) but kept the old sequence, not noticing that the
description half of the merged prompt has a hard dependency the field half doesn't: it must see the
*final* image. Counts come from the inventory (order-independent), which masked the ordering bug.

**Fix.** Reordered the flow everywhere: **build images first (ChatGPT) → then run the merged prompt
on the final images**. `THE-FLOW.md` Step 3 swapped (Conversation 1 = build, Conversation 2 = JSON),
`START-HERE.md` Part 1 gained a "do this AFTER you've made the images" callout, `image-playbook.md`
pipeline note updated.

**Lesson.** When merging two steps, re-derive their dependencies from scratch — don't inherit the
old order. Here one output (descriptions) depended on an artifact (the final image) that the other
output (fields) didn't, so the merged step inherited the stricter ordering constraint.

---

## C-024 · `not_visible` inverted — three false alarms, one real gap missed
**2026-07-25 · Class: Design · Caught by: assistant (audit) + Vansh · Cost: minutes · Status: Fixed**

On the ANP-1 Annaprashan run the merged prompt returned
`"not_visible": ["Balloon pump", "Glue dot strip", "Arch tape"]` — all three are plainly in the
contents photo, captioned *"Balloon Pump & Arch Tape, Glue Dots"* in its bottom-right sub-panel.
Meanwhile the **2 red curtain backdrops**, which appear in no photo at all, were not flagged. The
one field whose entire job is catching pack/photo mismatch produced three false positives and one
false negative in a single run.

**Two root causes, both in the prompt, not the model.**
1. **Composite grids.** A pack-contents "photo" is one image containing six labelled sub-panels.
   The rule said "any inventory item you cannot find in ANY photo" and the model read the large
   panels, skimming the small corner one. Nothing told it to read sub-panels and captions.
2. **Setup aids vs decoration.** Vansh's point: the pump, tape and glue dots *legitimately* never
   appear in the decorated hero shot, because they are assembly aids, not decoration. The prompt
   never said that absence-from-image-1 is expected, so the model treated it as a finding.

**Fix.** `not_visible` guidance in both `START-HERE.md` and `image-playbook.md` now says: walk the
inventory one line at a time; a contents photo is often a single composite of labelled sub-panels —
read every one including small corner panels; setup aids never appear in the hero shot and that is
**not** a flag; an item counts as missing only if it is absent from the *contents* photo too; a
false entry is worse than an empty list. A matching line was added to the pre-answer checklist.

**Lesson.** A validation field is only as good as its definition of "absent". This one had no model
of *why* an item might be legitimately missing from a given shot, so it reported layout facts as
inventory problems. Cross-check fields need the exempt cases spelled out, or they cry wolf and get
ignored — which is worse than not having them.

---

## C-025 · Prompt asked for a piece count and accepted prose instead
**2026-07-25 · Class: Design · Caught by: Vansh · Cost: minutes · Status: Fixed**

The image-2 rule said *"the pack contents laid out, stating the total piece count"*. Two runs
returned "multiple items arranged clearly" and then "the full pack items clearly arranged" — no
number either time. Vansh initially suspected the composite layout of image 2 was confusing the
model; it wasn't. The rule simply never said the output had to be a numeral, so a phrase that
gestured at completeness satisfied it.

Three adjacent fields failed the same way in the same response: `Key Spec` accepted the slogan
`"Complete Decoration Kit"` where a count belongs, `Character` accepted `"Rice Ceremony"` (printed
on nothing) alongside the genuinely-printed "Shubh Annaprashan", and the `Description` silently
dropped the LED light and pump — real pack items the buyer pays for and never reads about.
`Balloon Type` listed only `["Metallic"]`, omitting the 8 foil hearts.

**Fix.** `START-HERE.md` + `image-playbook.md`: image 2 must **open with the total as a numeral**
("All 69 pieces laid out: …"), with "not 'the full pack', not 'multiple items'" spelled out;
`Key Spec` must be counts/measurements, never slogans; `Character` is only wording genuinely
printed on an item; `Description` must account for every inventory line including accessories;
`Balloon Type` must list every kind (metallic latex *and* foil). `Foldable` gained a definition —
pack as a whole, "No" for balloon-led kits even if the banner folds. Four new checklist lines.

**Lesson.** "State the total piece count" is a request; "open with the number, and here is what
does not count as a number" is a specification. Any prompt instruction that a plausible-sounding
phrase can satisfy will eventually be satisfied that way — name the reject cases, not just the goal.

---

## C-026 · The staged hero image put a product in the listing that we do not sell
**2026-07-25 · Class: Design · Caught by: Vansh · Cost: near-miss on a live listing · Status: Fixed**

ANP-1's Description claimed "2 red curtain backdrops", and "Curtain" reached Model Name,
`Decoratives Attached` and `Material: Fabric`. **The kit contains no curtain.** The contents sheet
lists six groups — banner, 40 balloons, 16 cutouts, 8 heart foils, LED light, pump/tape/glue — and
no curtain among them.

The curtains came from **image 1**. Per `image-playbook.md` Message 2, the hero image is generated
into "a clean, modern Indian home"; this one came back as a staged bedroom scene with curtains at
the side. The field-writing AI then read the room's furnishings as pack contents. The merged prompt
says counts come from the inventory — but it never said the *set of items* is inventory-only too,
so scenery was fair game.

This nearly shipped a listing advertising an item the buyer would not receive — the exact
returns-and-rating failure the whole pipeline exists to prevent. It also explains C-024's silence:
`not_visible` never flagged the curtain because the AI could see curtains, in image 1.

**Fix, at both ends.**
- *Generation* (`image-playbook.md` Message 2): image 1 is now framed against a plain wall with an
  explicit ban on curtains, furniture, stools, plants, food, people, floor and any object not on the
  displayed list, plus tight ~85% framing. The lifestyle/room variant is now marked images 3–5 only,
  never image 1.
- *Field writing* (`START-HERE.md`): the input description now states that IMAGE 1 is a staged,
  often AI-generated scene containing things we do not sell, and that no pack item, material or
  `Decoratives Attached` entry may be taken from it. New checklist line asks the model to re-verify
  every named item against the inventory.
- `products/ANP-1.json` + `image-meta/ANP-1.json` cleaned: curtain gone from Model Name,
  `Decoratives Attached`, `Material`, Description and the image-1 text; `not_visible` now empty.

**Lesson.** We generate the hero image ourselves and then ask an AI to describe it — so anything we
put in that frame becomes a claim about the product. A staged prop is indistinguishable from
merchandise to the next model in the chain. Keep the frame to what is in the box.

---

## C-027 · Nearly optimised the wrong thing on Meesho shipping (unverified vendor claim)
**2026-07-25 · Class: Fact · Caught by: assistant (source audit) · Status: Rejected, documented**

Vansh asked how to reduce Meesho's ₹68 "Shipping (added separately)" fee. A Gemini answer — and, on
first search, an apparently overwhelming consensus — said Meesho's AI estimates volumetric weight
from the main listing image, so tight-cropping image 1 lowers the fee, and swapping image 1 later
re-triggers the calculation.

**Every source making that claim sells an image-cropping tool** (MeeShip, EcomSarthi, GSTWali,
VariantStudio, AtraKit, SupplierHub, Zesmack) — identical claim, identical "₹30–50 per order"
figure, identical free-tool CTA, and on fetching the pages: no Meesho documentation, no panel
screenshots, no experiment, no named source. One escalates to "Meesho reads dominant colours and
brightness" to set the fee, which is self-evidently not how a courier bills. Meanwhile the sources
with nothing to sell — Shiprocket, Meesho's own supplier pages — describe packed weight, zone and
seller-submitted dimensions, with **no image in the mechanism**.

Near-miss: the first search summary read as strong confirmation, and the correct-sounding move was
to report it back as fact. Opening the pages reversed the conclusion.

**Outcome.** Claim rejected and written up in `docs/learning/4-meesho-shipping-fee-is-not-set-by-the-image.md`
with the real levers (package dimensions → volumetric weight; the rigid balloon pump forcing box
height). The image-1 tightening in C-026 went ahead anyway — but for the field-pollution reason,
not the shipping one, and the doc says so explicitly so nobody re-derives the myth from our own
prompt later.

**Lesson.** Search-result *consensus* is not source *independence*. When every page asserting a
mechanism also sells the remedy, that is one commercially-motivated claim repeated N times, not N
confirmations. Check who profits before counting agreement — and note this is the first `Fact`
entry in this ledger the assistant caught rather than Vansh, which is the pattern the bottom of
this page has been asking for.

---

## C-028 · Rejected the image-shipping claim too hard — Meesho has no dimension fields
**2026-07-25 · Class: Fact · Caught by: Vansh · Cost: one wrong guide, caught same day · Status: Fixed**

C-027 rejected the claim that Meesho's main image influences the shipping fee, on the grounds that
every source asserting it sells an image-cropping tool while disinterested sources describe
weight-and-dimensions. `SHIPPING-COST.md` was then written on that basis: measure the parcel,
compute `L×B×H÷5000`, declare true dimensions, cross a slab boundary.

**Vansh pasted the actual Meesho listing form. It has no dimension fields.** GST, HSN, Net Weight
(gms), Size (`Free Size`), price/inventory, Number of Items, Colour, Generic Name, Included
Components, Net Quantity, Occasion, Type, origin/manufacturer/packer/importer, Brand, Material,
Recommended Age, Description — and images. No length, no breadth, no height. Flipkart asks for
those; Meesho does not. He also reports the displayed fee moving when only the image changes, with
declared weight held constant, and his declared weight is **160 g** — the cheapest slab there is,
which cannot be what produces a ₹68 estimate.

**Two errors.**
1. **Wrong platform's mechanism.** The entire measure-and-declare procedure describes Flipkart. On
   Meesho the seller cannot declare dimensions, so Meesho must infer volume from category,
   attributes or the image — which makes the image claim *mechanically plausible*, not absurd.
2. **Over-read one source.** A Meesho supplier snippet — "the supplier needs to submit the
   dimensions of products contained in a package where the sizing of the product is relevant" —
   was taken as "sellers declare parcel dimensions". In context that is about **apparel sizing**,
   not parcel size. One ambiguous sentence was doing load-bearing work.

Also missed a distinction that dissolves most of the confusion: the **displayed** shipping (an
estimate made at listing time, added to the buyer's price — what Vansh is actually complaining
about) is a different number from the **actual** shipping (measured parcel, deducted at settlement
— what the old doc optimised). Both are real; only the second is dimension-driven.

**Fix.** `SHIPPING-COST.md` rewritten around the two-numbers distinction, conceding that the image
likely does influence the displayed estimate while keeping the still-valid point that the vendor
blogs' specific recipe (85% fill, pure white, three-quarter angle) remains unevidenced. Replaced
the measure-and-declare procedure with a **one-variable-at-a-time A/B protocol** Vansh can run on
his own account — three image variants, log the fee — since he is the only one who can settle it.
Added a check on the 160 g declaration (likely under-declared → charge-back risk). On the ÷5000
question: no single public number exists, Meesho's partners differ (Shadowfax/Ecom Express ÷4000
surface, Ekart ÷4500), so plan pessimistically at ÷4000.

**Lesson.** C-027 correctly established that *the vendors have no evidence*, then silently upgraded
that to *the claim is false*. Absence of proof from motivated sources is not disproof. The check
that would have caught it was cheap and skipped: **look at the actual form before theorising about
what the form feeds.** Vansh had it on screen the whole time. Ask for the artifact.

---

## C-029 · Argued a seller out of his own measurement, across three rounds
**2026-07-25 · Class: Fact · Caught by: Vansh (with a controlled experiment) · Cost: a wasted
research cycle + Vansh's credits and patience · Status: Fixed, claim ACCEPTED**

Vansh asked how to lower Meesho's ₹68 shipping fee. Gemini told him the main image drives it. The
assistant rejected that (C-027), then half-rejected it (C-028), then kept telling him his declared
weight mattered — until he ran the test himself:

| Test | Change | Result |
|---|---|---|
| A | Main image → variant 1 | ₹54 |
| B | Main image → back to original, nothing else touched | ₹68 |
| C | Net Weight → 10000 g on the ₹54 listing | still ₹54 |

**B reverses and C is null.** The image sets the fee; declared weight is not an input. Gemini was
right and the assistant argued against it for three rounds.

**What went wrong.** The source audit was good work aimed at the wrong question. Having established
that the tool vendors had no evidence, that finding got promoted to "the mechanism is false" and
then *defended* — each time Vansh pushed back with observation ("different images give different
amounts"), the reply conceded a little of the framing and re-asserted the conclusion, most
embarrassingly by calling his 160 g declaration "strong evidence" for a weight-based mechanism that
test C then showed has no effect whatsoever. The whole edifice was Flipkart's mechanism (declare
weight and dimensions → volumetric slab) applied to a platform whose form has neither field.

**The tell that was ignored:** Vansh said in round one that his partner had observed the image
driving the price, and in round two that he had seen it himself. That is primary evidence from the
person holding the account. It was treated as a hypothesis to be corrected rather than data to be
explained.

**Fix.** `SHIPPING-COST.md` rewritten a third time around the experimental result: a per-listing
procedure (generate 3–4 hero candidates → upload each → keep the cheapest → log it), a candidate
list led by *flat-lay of the deflated pack* (the biggest look-vs-ship gap in our catalog and the
one variant no vendor tests), a running log so a rule can be derived after ~10 listings, and a
"what does not work" section so declared weight and volumetric maths are not re-derived. Note also
recorded: the fee recomputes on **every** main-image change, which finally answers Vansh's original
question about swapping image 1 later.

**Lesson.** When the user reports an observation from a system they operate and you have only
inference, **they are the instrument and you are the hypothesis.** The correct move on his first
push-back was "then my mechanism is wrong — what varied?", not a better-sourced restatement. Source
quality settles what is *documented*; only a test settles what is *true*. And a research finding
that survives three rounds of contrary data is no longer research, it is a position being defended —
this ledger's own note that *"the assistant has never once caught its own factual error"* now has a
sharper form: the failure is not missing an error, it is not letting go of one.

---

## C-030 · Kept generating hypotheses for a black box instead of calling it unknowable
**2026-07-25 · Class: Design · Caught by: Vansh · Cost: a full evening + credits · Status: Fixed**

After C-029 established that the main image sets Meesho's shipping fee, nine variants were tested
to find *which* image traits drive it. Three hypotheses were offered in turn — object count, size
in frame, density — each with a confident rationale, each falsified by the very next result. The
last one (density) produced a perfect rank order across six readings and was presented as the
finding; V8 then came back **₹256**, four times the winner, on an image *airier* than the winner.

**What went wrong.** Not the experiments — those were well designed and Vansh ran them cleanly.
The error was continuing to supply mechanistic explanations for a system with no observable
internals, from a sample of nine, where the readings *jump* (63, 68, 89, 108, 256) rather than
slide. Jumps are the signature of a classifier, not a measurement, and that should have been the
conclusion after V3–V4 contradicted the object-count theory — not after V8. Each new hypothesis was
individually plausible and collectively evidence that the thing was unmodellable.

Compounding it: the optimisation was being pursued long after the economics had died. Best case was
**₹5/order** on an image Vansh had already said he wouldn't ship for conversion reasons; worst case
was **₹190 above baseline**. Once the downside is 38× the upside, the correct move is to stop
regardless of how interesting the puzzle is. Vansh called it; the assistant should have.

**Fix.** `SHIPPING-COST.md` cut from a full playbook to a one-page findings note — all V1–V8 prompt
blocks deleted deliberately, the nine results kept as evidence so nobody re-runs them, plus the one
untried thread (does the image auto-change the *category*?). `image-playbook.md` Message 2 restored:
its `FRAMING: fill 85%` line and bare-wall `SETTING` had been added on unevidenced vendor advice and
were reverted, and C-026's curtain bug is now guarded where it belongs — in the field-writing prompt
(`START-HERE.md`), which is the robust fix and lets the hero image keep the staging Vansh likes.

**The one thing worth keeping from the whole exercise:** *read the shipping figure before submitting
any main-image change* — not to optimise, to catch a ₹256 before it goes live. That is a safety
check, not an optimisation, and it was found by accident.

**Lesson.** A hypothesis that has to be replaced every time new data arrives is not a hypothesis,
it is a pattern being imposed on noise. Three strikes should have produced *"this is a black box,
and here is the cost/benefit of continuing"* — a decision the user could act on — instead of a
fourth theory. **Know when the honest deliverable is "unknowable, and not worth knowing."**

---

## C-031 · Relaxed a prop ban for one kit type; the model applied it to all of them
**2026-07-26 · Class: Design · Caught by: Vansh · Cost: minutes · Status: Fixed**

Closing out the shipping work, `image-playbook.md` Message 2's `SETTING` block was relaxed from a
hard "nothing in the frame but the decoration" back toward the staged look Vansh preferred, with:
*"A single tasteful piece of furniture (a low stool or chowki) and a fringe/curtain backdrop are
allowed if they suit the occasion."*

The next generation was a **groom-to-be** kit — and it came back with a carved wooden baby chowki
with a cushion sitting in the middle of the shot. The stool made sense for Annaprashan, where the
baby is seated for the rice ceremony. It is nonsense for a groom-to-be backdrop.

**Root cause.** "If they suit the occasion" delegates a judgement the image model cannot make. It
has no model of which props belong to which Indian ceremony, so a conditional permission reads as
an unconditional one and the prop appears in every kit type. The relaxation also undid half of
C-026's guard four days after it was written, without checking what C-026 had been protecting
against — the same class of failure (scene objects becoming apparent pack contents).

**Fix.** `SETTING` now bans furniture and props outright for every kit type, with the reasoning
stated inline so the next person doesn't relax it again: *"a baby stool in a groom-to-be photo, or
a cake in a rice-ceremony photo, is wrong twice over."* One genuine exception is spelled out — a
fringe/curtain backdrop **that is itself on the DISPLAYED list** should be shown, because it is a
real item the buyer receives; inventing one is still banned. C-026's warning box rewritten to cover
both incidents.

**Lesson.** Never give a generative prompt a permission qualified by a judgement it cannot make.
"Allowed if appropriate" is not a constraint — it is an unconditional allowance with extra words.
Either the thing is always allowed, or it is banned, or the condition must be mechanically checkable
from data the model has (here: "is it on the DISPLAYED list?").

---

## C-032 — Two path conventions in one codebase; the wrong one failed silently

**Type.** Code · found 2026-07-26 during the pre-GUI audit, before any GUI work started.

`image-meta.ts` and `images.ts` resolved their data folders from `import.meta.url` — correct, works
from anywhere. `listing.ts` and `scan.ts` used bare relative strings (`"products"`, `"categories"`,
`process.cwd()`) — which only resolve when the process happens to be started from `flipkart-autofill/`.

Both conventions sat in the same `src/` for weeks and nothing caught it, because `npm start` always
runs from the project folder, so the broken half was never exercised from anywhere else.

**Why it mattered.** The failure mode is silence. `listProducts()` does not throw from the wrong
directory — it returns `[]`, and `start.ts` renders that as *"No products found in the products
folder"*, which reads as a data problem and sends you looking in entirely the wrong place. Worse,
`scan.ts` would have *written* a fresh `categories/` tree wherever it was launched from.

And it was a hard blocker for the thing we are about to build: inside a double-clickable macOS
`.app`, `process.cwd()` is `/`. Every product-facing screen of the GUI would have come up empty on
day one, and the cause would have looked like anything except a path bug.

**Fix.** New `src/paths.ts` — one module, four exported directories, resolved from its own location,
with the `WW_*_DIR` env overrides the test suite already depended on kept intact. Proven rather than
assumed: called `listProducts()` after `process.chdir('/tmp')`; it returned `[]` before the fix and
both product files after.

**Lesson.** When two modules answer the same question two different ways, the difference is not
style — one of them is a latent bug waiting for a change of context to expose it. Worth grepping for
the *other* convention every time you notice one.

---

## C-033 — A global gitignore would have made the first commit uninstallable

**Type.** Process/config · found 2026-07-26, caught in the staging diff *before* committing.

The repo had never been committed. Preparing the first commit, `git status` showed 68 files and
looked complete — but `flipkart-autofill/package.json`, `package-lock.json`, `tsconfig.json`, both
`products/*.json` and both `categories/*.defaults.json` were absent.

Cause: this machine's `~/.gitignore_global` contains `*.json` (a reasonable blanket guard against
stray service-account keys). It silently applied to a project that is substantially *made* of JSON.

**Why it mattered.** The result would have been a repo that clones cleanly and cannot be installed
or run at all — no dependency manifest, no lockfile, no compiler config, no product data. Nothing
would have announced this. `git status` does not list what it is ignoring, so the omission is
invisible unless you go looking, and the natural moment to discover it is on the partner's machine,
during handover, with no obvious cause.

**Fix.** A repo `.gitignore` outranks the global one, so the root `.gitignore` now re-includes
project JSON via `!*.json`, then re-excludes the genuinely private cases (`.claude/settings.local.json`,
credential patterns), with `flipkart-autofill/.gitignore` still keeping `image-meta/` and `profile/`
out. Verified by check-ignore on both directions, including that `profile/Default/Cookies` — the live
Flipkart seller session — stays out.

**Lesson.** Before a repo's first commit, read the staged list for what is *missing*, not just for
what should not be there. And a machine-level `*.json` ignore is worth knowing about the moment you
work on any Node project on this machine.

---

## C-034 — Meesho's character limits are not verified, and I said so instead of guessing

**Type.** Fact · flagged 2026-07-26 while writing the Meesho half of the prompt (WW-062).

The prompt needed limits for the Meesho title and description. Searched for them and found:
*"Keep titles between 50–120 characters"* and *"Meesho recommends concise titles under 100
characters"* — but **every one of those numbers comes from third-party seller-service blogs**
(loharstudio, wareiq, jeecart, ecomgrowsupport), not from Meesho's own supplier documentation.
The two figures do not even agree with each other. For the **description** field, no source
gave a limit at all; the closest was *"avoid long descriptions to avoid rejection"*.

**What was done instead of asserting a number.** Targets were set conservatively enough to be
safe under every figure found (title 70-95 with 120 as a ceiling; description 600-900), the
uncertainty is stated inline in `START-HERE.md`, and the guide names the Supplier Panel's own
field counter as the authority that overrides the doc.

**Why this is logged as a correction and not just a note.** C-007 and C-008 are both cases of
quoting a search summary as fact. This is the same shape of situation and the same temptation —
a confident-sounding number from a blog that reads like documentation. The pattern list below
says every factual claim needs its source type stated inline, so it is stated: *SEO blogs,
not Meesho.*

**Open action for Vansh.** One minute of work, and it closes this permanently: paste a title
into the Supplier Panel, look at what the field's counter or its rejection actually says, and
tell Claude the real numbers so `START-HERE.md` can be corrected. Also worth confirming the
partner's underlying claim — that Meesho ranks on title/description text and ignores image
metadata — since the whole `meesho` block is built on it.

---

## C-035 — A "32 KB max image" instruction that the arithmetic says cannot be followed

**Type.** Fact/spec · found 2026-07-26, before implementing.

> **RESOLVED same day, by Vansh, with a live test: he uploaded the same image at a range of file
> sizes and the fee did not move by one rupee.** File size is not an input. Dead, like metadata.
>
> Worth noting *how* it was resolved. The desk analysis below was correct and useful — it stopped
> a 32 KB cap being built, and it was right that the target was unreachable. But it could not
> answer the actual question, which was *does file size move the fee*. One upload did. **When a
> claim is cheap to test live against the real system, test it — do not out-argue it.** The same
> lesson as [[verify-before-claiming]], and the reason `metaprobe` exists at all.

The seller passed on three image rules from his partner: images must be 1:1 (already true), must
carry a 20×20 px border, and must be **no larger than 32 KB** — the last two claimed to lower
Meesho's shipping fee.

The 32 KB rule was measured before being built. On a real product photo at our 1500×1500 output:
**JPEG quality 1 — the absolute floor, visibly destroyed — still produces 38 KB.** There is no
quality setting at 1500×1500 that reaches 32 KB. Getting there requires dropping to roughly
**300×300**, which would look bad on a phone and works against the click-through the same advice
exists to improve.

**What was done.** Not implemented. The measurements were written into `SHIPPING-COST.md`, and the
likely explanations named: the number is misremembered, it refers to a thumbnail rather than the
uploaded file, or the partner is already working at a much lower resolution. The question goes back
to Vansh rather than a 32 KB cap silently degrading every image.

**Why this is worth logging.** The instruction was specific, numeric, and came from someone with
real selling experience — exactly the kind that gets implemented on authority. Two minutes of
measurement showed it could not be satisfied as stated. **A number being confidently given is not
evidence it is achievable; check it against the arithmetic before building to it.**

**The neighbouring good outcome.** The other two claims were handled differently *because the
evidence differed*: the bracketed piece count went straight in (costless, and the seller sees the
buyers), and the 20 px border was built as an opt-in flag with tests, since it is an axis the
fourteen shipping tests genuinely never varied. Also checked rather than assumed: the metadata
probe's five files differ by only **0.3%**, so that test does *not* retire the file-size question
the way it might appear to. Three claims, three different responses, each matched to what could
actually be shown.

**Confirmed by looking (same day).** Rendered both routes to 32 KB and inspected them at 1:1.
1500px at quality 1 is block-artefacted with the banner text barely legible; 300×300 blown up is an
unreadable blur. Neither is shippable, and both fail on printed text — the thing a buyer zooms in to
read. Searching also found **no source anywhere** stating a 32 KB rule; the published figures are
min 400×400, recommended 1000×1000, **max 5 MB**. The nearest claim ("save ₹30-50/order via image
choices") is an advert for an image-optimisation service, cites nothing, and its stated mechanism —
perceived size drives the weight slab — was already disproved by our own test 2. Most likely the
partner is reading the size of the ~150-200px thumbnail **Meesho generates**, not the file he
uploads.

**A real finding fell out of it.** q20 at **132 KB is visually indistinguishable from our q90 at
630 KB** — five times smaller for nothing. Unrelated to shipping, but worth acting on. Caveat
recorded: the sample is flat graphic artwork, which compresses unusually well, so re-test on a
photographic image before changing the default.

**Second-order lesson, from a bug in the throwaway script that produced those samples.** The first
run wrote files via `sharp(buf).toFile(...)`, which **re-encodes** the buffer at sharp's default
quality — so `q01-36KB.jpg` was actually a 78 KB re-encode, and every file was mislabelled. Caught
by comparing the names against `stat` output before showing anything. *Throwaway scripts written to
produce evidence need the same scepticism as shipped code — a mislabelled sample is worse than no
sample, because it gets believed.*

## C-036 — Deleted the `--border` flag as a "closed experiment". It is the one axis never tested.

**Category:** Process · **Caught by:** Vansh, mid-edit · **Date:** 2026-07-26

Asked to reduce code before the GUI pivot, the assistant deleted the `--border=20` logic
(`addBorder` in `square.ts`, the plumbing through `images.ts`/`finish.ts`, five tests) plus
`docs/guides/SHIPPING-COST.md`, on the reasoning that `CLAUDE.md` marks the Meesho shipping-fee
question **closed, don't re-run**. Vansh stopped it: *"Why are you just removing whole logic?
That was a valuable thing, adding twenty pixel of border."*

**He was right, and the repo said so in writing.** `SHIPPING-COST.md` §"Claim 2" states the
20 px border is **"never tested directly, and cheap to test"**, and C-035 records that it *"was
built as an opt-in flag with tests, since it is an axis the fourteen shipping tests genuinely
never varied."* The closed verdict covers image **content** variants, **metadata**, and **file
size** — three settled axes. The border was deliberately built as the survivor. Deleting it
would have destroyed the only remaining cheap experiment, and the reason it was cheap: the
metadata probe proved the estimator is deterministic, so a two-image A/B settles it in one
sitting with no averaging.

**What was done.** All of it restored from `HEAD` (nothing had been committed): `square.ts`,
`images.ts`, `finish.ts`, the five `--border` tests, `SHIPPING-COST.md`. Also restored on the
same principle: `src/inspect.ts` and `src/fill.ts`, deleted as "duplicate/debug entry points"
but genuinely the tools for re-deriving selectors when Flipkart changes its form — a live risk,
not a closed question. 61 tests green again, typecheck clean. Only `src/metaprobe.ts` and
`photo/meta-test/` stayed deleted: metadata is *"closed permanently"* per learning note 4, and
the probe's own `RESULTS.md` said to delete the folder once all five came back identical.

**The lesson, and it generalises past this repo.** **"Closed" and "untested" are opposites, and
a deletion pass reads them as the same thing** — both look like "no result recorded". A tracked
experiment with no result yet is the *most* valuable code to keep, not the least; it is the only
kind whose value is still unrealised. Before deleting anything justified as a dead experiment,
find the sentence that says the question was *answered*, not merely the one that says the topic
was dropped. Here that sentence existed for metadata and file size and did not exist for the
border, and the difference was one grep away.

**Then the identical mistake a second time, in the same session.** `NOTION_BOARD_SEED.md` (399
lines) was deleted as dead Notion ceremony. Vansh: *"have not yet made the board at the notion. So
I think this file was valuable."* It is a **spec for a deliverable that has not been built yet** —
the same shape as the border, one level up: no result recorded because the work hasn't happened,
not because it was abandoned. Restored, and rewritten to current state, because it *was* genuinely
stale (frozen at 2026-07-21: "load C-001…C-011" against 36 entries, Done list ending at WW-024,
four references to files deleted this session, no GUI pivot). **Staleness argues for updating a
file, never for deleting it** — that conflation is what made the first deletion look reasonable.
`docs/samples/METADATA-TEST-upload-this.jpg` was restored on the same rule: WW-037 is still open
and that image is its artifact. Also spun out of this: the GUI pivot finally got real tickets
(WW-066…WW-069), which the board seed needed and `TICKET_STATUS.md` had been missing.

**Second-order.** The assistant also conflated *reduce complexity* (what was asked) with *remove
features* (what it did). Deleting 6,881 lines of docs describing a Postgres/Fastify monorepo that
was never built is the former. Deleting a working flag is the latter. `CLAUDE.md` now carries a
"Reduce before adding" rule making the distinction explicit, and requiring a question before
removing anything that still answers an open question — or specifies work not yet done.

---

## C-037 — Solved a paste problem by asking the AI to write everything twice

**Category:** Design · **Caught by:** Vansh, hitting a refusal in ChatGPT · **Date:** 2026-07-28

`PROMPT.md` could not be answered. ChatGPT refused twice: *"it would require generating
thousands of words… which exceeds my response limits"*, then refused the two-part split it had
itself proposed. The refusal is not accurate — the full reply is a few thousand tokens — but it
was pointing at something real. **The prompt asked for the same four values twice.** Section 3,
"the paste block", reprinted the Flipkart Description and the three Meesho values as plain text,
because JSON stores a line break as `\n` and `\n` cannot be pasted into a marketplace form.

That reasoning (WW-072, C-nothing — it was never questioned) is correct about the constraint and
wrong about where to solve it. **Unescaping is a two-line local operation** — `JSON.parse` does it
— and it was being paid for in AI output tokens, on every single product, forever. The prompt was
made a third longer to save a `node` command that had not been written.

**What was done.** Section 3 deleted; the prompt is now two sections, both standalone JSON files.
`src/paste.ts` (25 lines, `npm run paste -- <ID>`) prints the four values with real line breaks.
`START-HERE.md` and `THE-FLOW.md` updated — including the deletion of a paragraph explaining why
the duplication was unavoidable.

**The lesson.** When a prompt asks the model to do something a line of code does, that is not a
prompt-engineering decision, it is a missing tool. The tell here was in the prompt's own wording:
*"do not summarise them, do not improve them, do not re-write them — character-for-character the
same text"*. **A request for a byte-identical copy is a request no language model should be
receiving**; every instruction fencing it in was compensating for using the wrong tool. Anywhere a
prompt says "print that again, exactly", the answer is a script.

---

## C-038 — Told the user to rename his files, when the code should have matched them

**Category:** Design · **Caught by:** Vansh, refusing the advice · **Date:** 2026-07-28

Reviewing a `finish` run I noticed the descriptions menu was offering `image-meta-GTB002` and
`ANP003` and marking every one of them **"⚠️ a DIFFERENT product"** for a folder called `GTB 2`.
My advice was: *"rename them to `ANP-3.json` and `GTB-2.json` and both auto-match forever."*

That is a correct instruction and the wrong answer. `image-meta-ANP003.json` **is the filename
ChatGPT gives the download** — it comes off the prompt that way every single time. So the advice
was a manual rename per product, forever, to work around a lookup that could not see through a
prefix. Vansh's reply was the right one: *"I can send you any format… all of them should work."*

**Root cause.** Four different places matched an ID to a file by exact string equality —
`descriptionsFor()`'s four hardcoded candidates, `availableMetaIds()`'s raw basenames, `paste.ts`,
and `fill.ts`. Not one of them agreed with `cleanId()`, which is what turns a folder called
`ANP 3` into `ANP-3`. So the tool minted an ID by one rule and looked it up by another.

**What was done.** `src/id.ts`: `normalizeId()` (drop the `image-meta-`/`products-` prefix, then
case, punctuation and leading zeros — `ANP 3`, `ANP-3`, `ANP003`, `image-meta-ANP003` are all
`ANP3`) and `findById(dir, id)`. Every one of the four lookups now routes through it, so the
shapes are interchangeable everywhere: `npm run paste -- ANP-3`, `npm run fill -- ANP003`,
`finish` on a folder called `GTB 2`. `finish`'s menu now only appears when there is a real
question — a clean single match prints what it resolved to and gets on with it.

**Deliberately not fuzzy.** No edit distance, no prefix matching. Two files that normalise the
same are *reported*, never ranked — Vansh has exactly that today (`ANP003.json` beside
`image-meta-ANP003.json`) and one of them is stale. "Close enough" quietly picking the wrong
product's descriptions is WW-078, and it is worse than not matching at all.

**The lesson.** *Any* instruction of the form "rename your files so the tool can find them" is a
bug report about the tool. The user's input format is a given; the code's matching rule is the
variable. I had the causal chain right — the IDs genuinely don't match — and drew the conclusion
from the wrong end of it, which made a code defect look like operator sloppiness for a whole
review. Two runs' worth of menus and one near-miss were the cost.

---

## C-039 — Half-fixed C-038: still made the operator arbitrate between two names for one product

**Category:** Design · **Caught by:** Vansh, on the next run · **Date:** 2026-07-29

C-038's fix made `ANP-3`, `ANP003` and `image-meta-ANP003` resolve to the same *product*. It then
stopped one step short: when two files answered to that product, `findById` picked
alphabetically and `finish` opened the menu, printing *"one of them is probably stale"* and
leaving the operator to work out which. `npm start`'s product list showed both as separate rows.
So the rename instruction came back in a new costume — *delete the stale one* — for a decision
the tool can make itself.

**Root cause.** The ambiguity guard was written for the risk in WW-078: picking the *wrong
product's* descriptions. But two files that normalise to the same ID **are the same product** —
that is what normalising means. There was never a wrong-product risk in this branch, only a
which-copy-is-current question, and file mtime answers it exactly: the one you saved last is the
one you just downloaded. The guard was inherited from a neighbouring failure it did not fit.

**What was done.** `findById` sorts matches newest-first and returns the rest as `others` for
display only. The exact-filename preference went with it — one rule, so every spelling of the ID
lands on the same file (it did not before: `ANP003` got the older `ANP003.json` while `ANP-3` got
the newer `image-meta-ANP003.json`). `finish` no longer opens the menu for a duplicate; it prints
`(ignoring older copy: …)`. `listProducts()` de-duplicates by `normalizeId`, so `npm start` lists
one row per product instead of one per file.

**Second half: the small-source warning in `finish` — and I first fixed it wrong.** Every run on
Vansh's photos printed `⚠️ SOURCE ONLY 350px — get a larger original`. He does not want a larger
original: Meesho prices shipping off the main image and a bigger one raises the buyer's cost
(SHIPPING-COST.md), so the pixel count is a decision, not an accident. I deleted the check and
justified it with *"a folder reaching `finish` is one you have finalised"* — and Vansh corrected
that immediately: **"I wasn't saying finalised in that way. I was saying finalised in the quality
way."** He is signing off on the *content*, not waiving inspection. The AI still hands back a
1024x1536 now and then, `finish` does not resize, and that image would ship as the odd one in a
listing of squares.

So the check is not deleted, it is **re-aimed**: `NOT SQUARE 1024x1536` when `w !== h` (silent
under `--square`, which already fixes it), and nothing at all about pixel count. The distinction
that was missing from my first pass: **the ratio is never a deliberate choice, the resolution
often is.** `images.ts` keeps the size warning — there the input is a raw Meesho download and
"re-download a bigger one" is real advice. **Neither warning ever blocked anything and no metadata
was lost** — the EXIF descriptions were written on every run, which is what Vansh actually asked
to confirm.

**The lesson.** A warning is a request for a decision, so the test is *whose decision is it?* The
copy-is-stale question and the resolution question were the operator's already made; the ratio
question is nobody's. Deleting a warning because the operator called the folder "final" reads
"final" as "unconditionally approved" — it meant "I am happy with the content". **When a user
says a warning is wrong, that is a report about the threshold, not permission to remove the
check.** Ask what the right threshold is before cutting.

---

## C-040 — Applied Flipkart's comma rule to Meesho's text, in the prompt and then in the code

**Category:** Design · **Caught by:** Vansh · **Date:** 2026-07-29

Reviewing outside SEO advice, I rejected *"use commas in pack contents"* with: *"HARD RULE 2 —
Flipkart splits on commas. This advice would break your listings."* Then I built a checker that
flagged a comma in `meesho.pack_contents` as a defect.

Vansh: *"bro but in meesho that works i guess, we have to keep it separate… that `,` split was
good for meesho, not for flipkart."* He is right, and the reasoning was not subtle:
**`meesho.pack_contents` never reaches Flipkart.** It is pasted by hand into the Supplier Panel.
Flipkart's list-splitting cannot apply to a value Flipkart never sees.

**Root cause: one file, two marketplaces, and I treated a rule about one as a rule about the
file.** `image-meta/<ID>.json` carries `title`/`keywords` (→ Flipkart) *and* a `meesho` block
(→ pasted by hand). They share a container, not a rulebook. HARD RULE 2 in `PROMPT-meta.md` had
the same defect and had had it since it was written — it named `meesho.pack_contents` explicitly
and justified it with *"Flipkart splits list values on commas"*, a reason that is simply false
for that field. I read that rule, quoted it, and did not notice the contradiction inside it.

**What was done.** The rule now states the boundary instead of a blanket: no commas in `title`
or `keywords` (Flipkart, split on commas); commas normal in every `meesho` value and in the
image descriptions. `pack_contents` switched to `", "`. `paste` marks each swept value with the
side it belongs to. A test pins that Meesho commas pass, named so the mistake cannot quietly
return.

**The lesson.** When one artifact serves two consumers, every constraint needs the consumer
attached to it, not just the field name. A rule written as *"no commas in X"* loses the only
information that makes it checkable — *for whom*. The tell was in the rule's own text: the field
it named and the reason it gave were about different marketplaces, and a rule that cannot
survive being read aloud is one nobody has read aloud.

**Second thing, same session.** Vansh also asked for the length check to work in both
directions. It half did: over-limit was caught, under-limit only against a blanket 70% that was
looser than what the prompts themselves ask for — so a reply could miss the prompt's stated
target and still pass. Now each field carries the prompt's own floor and ceiling. **A tolerance
invented by the checker rather than taken from the spec is a checker that agrees with itself.**

---

## C-041 — Emoji in the Flipkart Description made every save return HTTP 500

**Category:** Bug · **Caught by:** Vansh, bisecting on the live form · **Date:** 2026-07-31

The first time this tool's output was ever saved to Flipkart, it could not be saved. `Save`
returned *"Could not save your changes. Please refresh the page and try again."* — and after the
bot had filled the form, even **switching tabs** (which normally autosaves) failed the same way.

Diagnosis was three wrong turns and one right one, worth recording because the wrong turns were
each plausible:

1. **"Mandatory fields on the other tab are empty."** Wrong: DevTools showed **HTTP 500**, and a
   missing required field returns 400 with field-level messages. A 500 is the server throwing.
2. **"The draft's `requestVersion` is stale."** The payload carried `requestVersion: 1`, which
   looked like optimistic-concurrency drift after a mid-flow session expiry. **Backwards** — if
   every update 500s, the version never advances, so `1` was a *symptom of nothing ever saving*.
3. **"Playwright's input events desync React's state."** Checked and rejected: `fields.ts` uses
   `selectOption`, real `keyboard.type` and `el.fill`, and never assigns `.value` directly.

**Vansh's A/B is what actually solved it:** editing an existing listing by hand and switching
tabs saved fine; the same page after a bot fill would not. That located the fault in a *value*,
not in the mechanism. Deleting the Description and saving worked instantly.

**Cause: the emoji.** WW-072 built a Description template using 🎁 ✨ 🎈 💡 👉 as section
headings. Those are 4-byte UTF-8 characters, and something in Flipkart's storage cannot take
them — it throws, returns 500 with only a `txnId`, and once the text is in the draft every later
save of that draft fails too. **The listing could not be saved at all**, which is as bad as a bug
in this project gets.

**Fixed.** The template is plain ASCII — CAPITALS headings, hyphens, no emoji, no en-dashes.
`paste` now flags emoji in any Flipkart-bound value, matching >U+FFFF plus the dingbat and misc
symbol blocks (so `✨`, which is only 3 bytes and probably harmless, is caught anyway — the
instruction is "no emoji", and one survivor in a field meant to be plain is worse than a false
positive). Deliberately not matched: `–`, `—`, `₹` and smart quotes. Four tests.

**The lesson.** Every character we put in a marketplace field is an input to somebody else's
database, and **a generic 500 with no field name is a bisect problem, not a reading problem.**
Three sessions of reasoning about payloads produced nothing; one A/B on the live page produced
the answer in a minute. When the server refuses to say what is wrong, stop theorising and start
halving the data.

**Second lesson, cheaper.** Nothing had ever been saved through this tool — `HANDOFF.md` says so
outright: *"ship one real listing end to end through QC… has not happened"*. The emoji went in on
2026-07-26 and sat undetected for five days because **the last step had never been run.** A
pipeline is unproven up to the last step that has actually been executed, not up to the last step
that has been written.

---

## Patterns worth acting on

Counting the entries above:

- **Fact claims are the weak spot.** C-007 and C-008 are the only two entries Vansh had to
  challenge on substance, and both came from quoting search summaries instead of opening
  sources. **Every factual claim now needs its source type stated inline.**
- **Code bugs get caught when tests run against real artifacts, and only then.** C-009 and
  C-010 were caught pre-delivery by running the tool. C-002 through C-006 all shipped to
  Vansh because they were not.
- **Process failures come from partial reads** (C-011, and arguably C-001).
- **The assistant has never once caught its own factual error.** Every `Fact` entry was
  caught by Vansh. That asymmetry is the single most useful thing on this page for whoever
  picks this up next.

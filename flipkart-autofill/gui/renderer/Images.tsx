/**
 * Images.tsx — step 2: build the hero photo and the two infographics, in ONE chat.
 *
 * The first draft of this screen was wrong in three ways and Vansh caught all three:
 *
 *  1. **It skipped `PROMPT-read-pack.md` entirely.** The hero prompt opens "Now make ONE
 *     realistic photograph… use the exact DISPLAYED numbers from **your list**" — the list that
 *     read-pack produces. Sent on its own it has no list, so the counts are invented.
 *  2. **It told you to attach image 1.** The pack sheet is **image 2**. That is the photo the
 *     counts are read off; image 1 is the staged shot the AI is about to replace.
 *  3. **It made hero and infographic two separate steps.** They are two messages in one
 *     conversation — the infographic says "from IMAGE 2", meaning the same image 2 already in
 *     context. Splitting them into steps invites two chats, and the second one starts blind.
 *
 * So this is one screen with the messages in order, each copied on its own. Never all at once.
 *
 * A message can offer more than one prompt to copy — you pick one, you do not send both. That is
 * why the hero card lists two: plain, and the experimental bordered/badged variant that
 * SupplierHub's 60 -> 49 shipping result was traced to (see docs/guides/SHIPPING-COST.md). Same
 * for the two infographics, which are genuinely two different pictures: 2.png shows counts only,
 * 3.png repeats them with measured sizes.
 *
 * Message 2b is the same idea for LAYOUT. The hero prompt puts the garland on the top and left,
 * every time, and that is the only composition we have ever shipped. The four alternatives are
 * follow-up messages rather than four copies of the hero prompt on purpose: a copy would mean
 * every future fix to the counts rules, the no-props rules or the SEO wording has to be made five
 * times, and four of them would be missed. Each layout file is three lines that change where the
 * balloons sit and nothing else.
 */

import React, { useEffect, useState } from "react";
import { CopyButton } from "./ui.js";
import { PhotoInbox } from "./PhotoInbox.js";
import { PromptEditor } from "./PromptEditor.js";

interface Choice {
  file: string;
  /** How the option reads on its button. Ignored when a message has only one. */
  label: string;
  /** Shown under the buttons when this option needs explaining. */
  note?: React.ReactNode;
}

interface Message {
  n: string;
  title: string;
  /** Empty when the message is something you type yourself. */
  prompts: Choice[];
  attach: React.ReactNode;
  /** Shown instead of a copy button when the message is something you type yourself. */
  freeform?: string;
}

const MESSAGES: Message[] = [
  {
    n: "1",
    title: "Read the pack",
    prompts: [{ file: "PROMPT-read-pack.md", label: "Read the pack" }],
    attach: (
      <>
        Attach <b>2.jpg</b> — the "what's in the packet" sheet. It asks for the contents in{" "}
        <b>text only</b>, no picture. Glance at the list before going on: everything after this
        message is built from those counts.
      </>
    ),
  },
  {
    n: "2",
    title: "Build the hero photo — pick ONE of these",
    prompts: [
      {
        file: "PROMPT-main-image.md",
        label: "Plain",
        note: <>The one we have always used. Photo fills the whole square, no text on it.</>,
      },
      {
        file: "PROMPT-main-image-bordered.md",
        label: "Bordered + badges",
        note: (
          <>
            <b>Experimental, and currently losing.</b> Adds a 9% coloured border and small BEST
            SELLER / SPECIAL OFFER stickers. Measured so far: plain ₹60, SupplierHub's bordered
            copy of that same photo ₹49, our own bordered attempt <b>₹105</b> — so the border does
            not reliably lower anything. ChatGPT also <b>redraws the whole photo</b> on this
            prompt, which is what made the ₹105 one a different picture entirely. For a clean
            test use the plain prompt and run <code>finish --square --border=107</code>, which
            pads the approved photo exactly and cannot change it.
          </>
        ),
      },
      {
        file: "PROMPT-add-border.md",
        label: "Add the border to a photo you already made",
        note: (
          <>
            Only if you already sent the plain prompt and want the border afterwards.{" "}
            <b>Attach the finished photo</b> — this one frames it instead of building it. The
            model will happily redraw the whole picture on this second pass, so{" "}
            <b>re-check the counts and the spelling of the foil letters</b> on what comes back.
            For a plain white border with no badges, <code>finish --square --border=107</code> is
            exact and cannot damage the photo.
          </>
        ),
      },
    ],
    attach: (
      <>
        The first two need nothing attached — they use the list from message 1. The third one
        needs the finished photo attached, because it only frames what already exists. Either way
        the reply is a square photo: save it into this listing's clean folder as <b>1.png</b> and{" "}
        <b>delete the old 1.jpg</b> — one file per number, or <i>finish</i> will stop with
        position 1 twice.
      </>
    ),
  },
  {
    n: "2b",
    title: "Move the balloons — only if you want a different layout",
    prompts: [
      {
        file: "PROMPT-layout-right.md",
        label: "Top + right",
        note: <>Mirrors the default, which frames the top and the left.</>,
      },
      { file: "PROMPT-layout-both-sides.md", label: "Top + both sides" },
      { file: "PROMPT-layout-corners.md", label: "Two diagonal corners" },
      { file: "PROMPT-layout-arch.md", label: "Full arch, floor to floor" },
      {
        file: "PROMPT-layout-corner-bulk.md",
        label: "Bulk up the top corners",
        note: (
          <>
            Keeps the layout it already has and just <b>moves</b> balloons into the top corners so
            they look heavy — the middle goes thinner to pay for it. The one to re-count hardest:
            filling a corner is exactly where a model helps itself to extra balloons.
          </>
        ),
      },
    ],
    attach: (
      <>
        Nothing to attach — same chat, straight after the photo comes back. Each of these changes{" "}
        <b>only where the balloons sit</b> and says to keep the counts, but the model redraws the
        whole picture, so <b>re-check the counts and the spelling of the foil letters</b> on what
        comes back. Send one, look at it, send another if you want to compare — the one you keep is
        the one you save as <b>1.png</b>.
      </>
    ),
  },
  {
    n: "3",
    title: "Fix a count — only if one is wrong",
    prompts: [],
    freeform: "4 confetti balloons but there are 3 — remove one and regenerate.",
    attach: (
      <>
        Skip this unless the picture disagrees with the list. Say what is wrong in your own words
        and ask for a regenerate.
      </>
    ),
  },
  {
    n: "4",
    title: "Build the contents infographic — counts only",
    prompts: [{ file: "PROMPT-infographic.md", label: "Contents infographic" }],
    attach: (
      <>
        Still the same chat — it says "from IMAGE 2", which is already in context from message 1.
        Paste your typed inventory where the prompt asks for it. No sizes anywhere on this one, so
        it replies with the picture straight away. Save it as <b>2.png</b> and delete the old{" "}
        <b>2.jpg</b>.
      </>
    ),
  },
  {
    n: "5",
    title: "Build the sizes infographic — the same items, with measurements",
    prompts: [{ file: "PROMPT-infographic-sizes.md", label: "Sizes infographic" }],
    attach: (
      <>
        Same chat again. Paste the inventory <b>with the size on any line you know it</b> ("2 x
        star foil 12 inch", "1 x small champagne bottle foil"): nearly every item sells at two or
        three standard sizes and that size gets printed on the picture. <b>It replies twice.</b>{" "}
        First a <b>table of sizes</b>, not a picture — read it, correct anything wrong, answer any
        row marked <i>PICK ONE</i>. Then say go, and the reply is the image. Save that as{" "}
        <b>3.png</b>.
      </>
    ),
  },
  {
    n: "6",
    title: "Build the how-to-decorate infographic",
    prompts: [{ file: "PROMPT-how-to-decorate.md", label: "How to decorate" }],
    attach: (
      <>
        Same chat. Paste the inventory again where it asks. It works out the <b>occasion, the
        colours and the assembly steps from the pack itself</b> — nothing about any occasion is
        written into the prompt — so the steps only ever name items that are really in the box.{" "}
        <b>Read the steps before you keep it:</b> an instruction to use something the buyer did not
        receive reads as a missing item and comes back as a return. Save it as <b>4.png</b>.
      </>
    ),
  },
];

/** Double-click opens the first prompt to read, edit, and compare against earlier versions. */
function MessageCard({ m, onOpen }: { m: Message; onOpen: (file: string) => void }) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    for (const p of m.prompts) {
      void window.ww
        .promptText(p.file)
        .then((t) => setTexts((s) => ({ ...s, [p.file]: t })))
        .catch(() => setFailed((f) => (f.includes(p.file) ? f : [...f, p.file])));
    }
  }, [m]);

  const first = m.prompts[0];
  const many = m.prompts.length > 1;

  return (
    <div
      className={`msg ${first ? "openable" : ""}`}
      onDoubleClick={() => first && onOpen(first.file)}
      title={first ? "double-click to read or edit this prompt" : undefined}
    >
      <div className="msg-head">
        <span className="msg-n">{m.n}</span>
        <b>{m.title}</b>
        {!first && <span className="muted">you write this one</span>}
      </div>

      {m.prompts.map((p) => (
        <div className="msg-prompt" key={p.file}>
          <span className="muted">{many ? p.label : p.file}</span>
          <button onClick={() => onOpen(p.file)}>Open</button>
          <CopyButton
            text={texts[p.file] ?? ""}
            label={many ? `Copy "${p.label}"` : "Copy this message"}
            disabled={failed.includes(p.file)}
          />
          {p.note && <p className="muted opt-note">{p.note}</p>}
        </div>
      ))}

      <p className="muted">{m.attach}</p>
      {m.freeform && <pre className="cmd">{m.freeform}</pre>}
      {failed.length > 0 && <p className="error">Couldn't read {failed.join(", ")}.</p>}
    </div>
  );
}

export function Images({ n }: { n: number }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="panel">
      <header>
        <h1>{n}. Build the images</h1>
        <p>
          One chat, five messages, <b>in this order</b>. The photo prompt works off the list the
          first message produces — send it alone and the counts are invented. Copy them one at a
          time; never all at once. Where a message offers several prompts, <b>send one of them,
          not all</b>.{" "}
          <b>Double-click a card</b> to read or edit its prompt.
        </p>
      </header>

      <div className="msgs">
        {MESSAGES.map((m) => (
          <MessageCard key={m.n} m={m} onOpen={setEditing} />
        ))}
      </div>

      <PhotoInbox />

      {editing && <PromptEditor file={editing} close={() => setEditing(null)} />}
    </section>
  );
}

# 29 — Splitting a function left an Enter behind

**2026-09-14.** `sendPrompt` did clear → paste → wait → **Enter**. The costing chat needed the same
thing WITHOUT the Enter, and had its own copy of the paste — which is how it kept a fixed 1,200 ms
wait long after the same bug was fixed in `chat-core`.

So it was split: `putInComposer` fills, `sendPrompt` fills then presses Enter. **The Enter was left
in both.** The costing chat — whose entire purpose is to hand a human a filled composer to READ
before committing — sent it, and `sendPrompt` pressed Enter twice.

**It cost an hour because both callers still looked like they worked.** One had a sent chat, the
other had a chat. The symptom was `ready` reported over an empty composer, and three wrong theories
were chased first: the paste racing, an image upload re-rendering the box, and a strict-mode locator
in the test harness. Only `putInComposer` called directly, on its own, with the URL printed before
and after, showed it: `/` became `/c/…`.

**The lessons, in the order they bit:**

- **A test that swallows its own error lies.** `innerText().catch(() => "")` turned a strict-mode
  violation — two `#prompt-textarea` nodes — into "the composer is empty", and sent me looking at
  the browser instead of the harness.
- **When you split a function, the tail goes to exactly one side.** There is now a comment on that
  Enter saying it is the only one in the file.
- **Print the URL.** A page that navigated is a different page, and every symptom downstream of
  that is noise.

Verified after, all three paths against the live account:

```
costing chat      ready; composer holds 5,003 chars, url still /   (not sent)
ask and read back "PONG"
generate an image 912,043 bytes in 27s
```

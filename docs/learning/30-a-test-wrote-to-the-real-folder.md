# 30 — A test wrote a delivery into the real stock folder

**2026-09-14.** An end-to-end test — read a note, save it, check the shelf — was written beside the
forecast tests. It pointed the stock folder at a temp directory inside the test body. It did not
work, because the module reads that setting **once, when it is first imported**, and the forecast
file imports it at the top. So the override came far too late and `writeDelivery` wrote
`stock/2026-08-04.json` into Vansh's real folder, next to his one genuine delivery.

**It was caught by the assertion, not by care:** `listDeliveries` returned 2 where the test expected
1. Had the test been written slightly more loosely — `toBeGreaterThan(0)` — it would have passed and
left the file there. A fake delivery in the stock folder is a wrong shelf, a wrong supplier call and
a wrong forecast, none of which announce themselves.

**The fix:** its own file, with the override set before any import of the module it affects. That
ordering is the whole point, so it is stated in the file's own comment.

**The lesson:** *a setting a module reads at import time can only be changed before the import.* And
a test that touches real business data should be treated as dangerous even when it is "obviously"
pointed somewhere else — the pointing is exactly what failed.

## While we are here: two sessions cannot share one Chrome profile

`ensureProfileFree()` kills any Chrome holding the profile directory, because a stale one silently
comes up with no session (WW-061). With two automation sessions running at once, each kills the
other's browser mid-run — the symptom is `Target page, context or browser has been closed` in the
middle of a flow that was working a minute earlier. Run one at a time, or point the second at a
different chat-profile directory.

## And one claim that was not checked — since resolved

`renameChat` returned true when none of its steps threw, which is not the same as the chat having
been renamed. It was reported as working on that basis; Vansh said plainly *"I didn't see any chat
with those names."* He was right. Checked properly, the chat was still called *"Reply exactly OK"*.

It now **reads the name back** before returning — by that chat's own id, never the top row, which is
whatever is pinned. With that in place it renames correctly: the row reads `ANP018 — images`. The
original failure was a race, and the old code could not tell a race from a success because it never
looked.

Worth noting what the intermediate panic was worth: the chat had vanished from the sidebar, which
looked like Archive or Delete — both sit next to Rename in that menu. It had not. The chat was
intact with all four turns, and the "missing" row was the sidebar simply not listing the chat you
are looking at. **A destructive theory deserves a check before it deserves a fix**, and the check
was one page load.

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

## And one claim that was not checked

`renameChat` returns true when none of its steps threw — which is not the same as the chat having
been renamed. It was reported here as working on that basis. Verifying it properly means reading
back the sidebar row for **that chat's own id**, not the top row, which is whatever is pinned. That
check has not been completed, so the rename is **built and unproven**, and is written down that way
in `AUTOMATION-STATE.md` rather than counted as done.

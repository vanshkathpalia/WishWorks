# 1. Label-targeting + read-back verification, not keyboard macros

**Decision.** The Flipkart autofill bot locates each form field by its visible label in the
DOM and verifies the value after typing it, rather than navigating with Tab/arrow-key
sequences.

**Context.** A working bot from another seller (`flipkart_bot.py` / `listing_bot.py`, kept in
the repo root for reference) fills the Price/Stock/Shipping tab with `keyboard.send('tab')`
and `press('down')` sequences — no knowledge of which field it is on. Its author reports it
"fills wrong items sometimes."

**Why it drifts.** The macro encodes *position*, not *identity*:
- One extra/conditional field on the form shifts every subsequent value by one.
- A dropdown that loads slower than the hard-coded `sleep` swallows a keystroke.
- Dropdown options are chosen by counting arrow presses (`for i in range(8): press('up')`),
  so any reordering silently selects a different option.
- Failures cascade: once the cursor is off by one, every later field is wrong, and nothing
  detects it. Its "skip MRP/Selling Price by pressing Tab" step can type a stock number into
  a price field.

**What we do instead.** `fields.ts` matches a field by its label text, tags that element, and
drives it with real events; `fillField` then re-reads the element and returns `mismatch` with
the actual content if it differs. Dropdown options are selected by typing their text.

**Adopted from the Python bots:** their field *values* (HSN 95030020, package dimensions,
procurement type/SLA, fulfillment, shipping provider) — real QC-passing data for party
supplies, now in `categories/balloon-decoration.pricing.defaults.json`.

**Rejected alternative.** Patching the Python macros (adding waits, adjusting Tab counts).
The blindness is the design, not a bug — more sleeps reduce the failure rate without ever
detecting a failure.

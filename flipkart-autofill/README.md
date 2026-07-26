# flipkart-autofill — auto-fill the Flipkart listing form (the 66-field killer)

Same idea as the `flipkart_bot.py` your friend runs, but better: instead of hard-coding one
category's fields, **scan mode** reads whatever category form is open and builds its template
automatically. New category = one scan, zero new code.

It drives a real Chrome window on your own logged-in seller account. It never clicks
Save/Submit — it types everything, you review, you submit.

## One-time setup

```bash
cd flipkart-autofill
npm install
npm run login     # log in with OTP once
```

It drives **your real Google Chrome** (not a bundled browser) with a profile in `./profile`
(gitignored), so you log in once and every later run is already logged in.

**Closing it with Ctrl+C is safe.** Chrome only writes the session to disk on a graceful
shutdown, and Playwright's default Ctrl+C handling kills it before that happens — which is
why the login used to vanish between runs. We now disable Playwright's signal handling and
close Chrome ourselves, so Ctrl+C and closing the window both keep you logged in.

> **Why not attach to the Chrome you already have open?** Two hard blockers, both verified
> here: since Chrome 136 Google refuses `--remote-debugging-port` on the default profile,
> and Chrome 150's CDP dropped the browser-context calls Playwright's `connectOverCDP`
> needs. A Chrome not started with the debug flag can't be attached to at all. Driving our
> own persistent Chrome gives the same result — log in once, never again.

## Per category (once): calibrate

```bash
npm run scan balloon-decoration
```

Browser opens → you navigate: **Listings → Add New Listing → your category**, open a tab
(e.g. *Additional Description (0/66)*), scroll it fully → press ENTER in the terminal.
It writes every visible field (label, type, multi-value or not) into
`categories/balloon-decoration.json`. Run it again on each tab / after scrolling — it
merges, never duplicates. Repeat with a different name for other categories.

## Per product: fill

1. Copy `products/example-black-gold-birthday-kit.json`, edit the values.
   Anything you *don't* specify falls back to `categories/<category>.defaults.json`
   (brand, country of origin, material… — edit that file once with your standard answers).
   Multi-value fields (Ideal For, Occasion…) take arrays: `["Boys", "Girls"]`.
2. ```bash
   npm run fill -- products/my-new-combo.json
   ```
3. Browser opens → open the listing form on the tab to fill → press ENTER.
   Watch it type. Run once per tab (it fills what it can see). It reports
   `filled / not found / failed` per field.
4. Review in the browser, fix anything odd, click Save / Send for QC **yourself**.

## Why this doesn't "fill wrong items"

Two design choices, both aimed at the failure mode of keyboard-macro bots:

1. **Targets fields by label, not by Tab count.** A macro that presses Tab 12 times breaks the
   moment Flipkart adds a field, a dropdown loads slowly, or the page scrolls — and every
   field *after* the slip gets the wrong value. We look up "Procurement SLA" in the DOM and
   fill that element, so an unexpected extra field changes nothing.
2. **Reads every value back after typing it.** A field is reported `filled` only if
   re-reading it returns what we asked for. Otherwise you get
   `⚠️ MISMATCH — wanted "Foil" but field shows "Latex"`. The bot can be wrong; it cannot be
   wrong *silently*.

Dropdowns are selected by typing the option's text, never by counting arrow presses — so a
reordered list can't select the wrong option.

## Defaults files

All files named `categories/<category>.*.defaults.json` are merged automatically:

- `balloon-decoration.defaults.json` — the 66-field Additional Description tab.
- `balloon-decoration.pricing.defaults.json` — the 21-field Price/Stock/Shipping tab
  (HSN, package dims, procurement type, fulfillment…).

So one product file fills whichever tab you have open; fields belonging to other tabs just
report "not on this tab". Any value still set to `TODO_…` aborts the run before it types
anything.

## Notes

- **Field names must match the form's labels exactly** ("Model Name", "Pack of" …). The
  scan output in `categories/*.json` is the authoritative list of what the form calls things.
- Dropdown values must match an existing option ("Latex", not "latex balloon").
- If Flipkart redesigns the form and fields stop being found, re-run scan — the label
  heuristics are generic, so usually nothing else is needed.
- This automates *your own* seller account through the normal UI — same as your friend's
  bot. Keep the typing delays as they are; don't hammer.

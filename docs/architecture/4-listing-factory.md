# 4. Listing Factory (P0) — the #1 pain-killer

**Goal:** product idea → upload-ready Flipkart + Meesho listing package in **2–3 minutes of
human review**, instead of 30–45 minutes of manual work per listing per platform.

## The pipeline

```
 define product          generate                validate              export
┌──────────────┐   ┌─────────────────┐   ┌──────────────────┐   ┌────────────────────┐
│ SKU + combo   │──▶│ Content          │──▶│ Pre-QC Validator  │──▶│ Meesho bulk Excel   │
│ items + theme │   │ Generator        │   │ (deterministic)   │   │ Flipkart Excel/API  │
│ + images dir  │   │ (Claude + kw     │   │ pass/fail report  │   │ payload + checklist │
└──────────────┘   │  bank, per-      │   └──────────────────┘   └────────────────────┘
                    │  platform)       │        ▲ human fixes, re-run
                    └─────────────────┘
```

Human touches it twice: defining the product (fast — mostly picking components) and reviewing
the validated output before uploading to the panel. Everything between is automatic.

## 4.1 Keyword Harvester

- Pulls **Flipkart and Meesho search autosuggest** for a seed list of category queries
  ("birthday decoration", "baby shower balloons", "anniversary decoration kit", …), expanding
  each seed a–z ("birthday decoration a", "… b", …) the way sellers do manually.
- Rate-limited (≥1s between requests), cached, run **weekly** via cron; results upsert into
  `Keyword` with `firstSeenAt/lastSeenAt` — a phrase seen this week but never before is a
  **rising query** worth listing against.
- Manual inputs also land here: keywords noticed in competitor titles, Meesho's Product
  Recommendations tool (harvested by hand weekly — it's inside the login-walled panel).

## 4.2 Content Generator (Claude)

Input: the product (components, theme, palette, pack counts) + top-N matching keywords from
the bank (matched via `Keyword.tags` ∩ product theme/category).

Output per marketplace (stored as `ListingContent`, versioned):

- **Flipkart title** — `Brand + Main Keyword + Feature + Size/Pack`:
  *"WishWorks Metallic Balloons for Birthday Decoration, 12 inch, Pack of 50 – Rose Gold"*
- **Meesho title** — descriptive, benefit-first:
  *"Happy Birthday Foil Balloon Set with 30 Metallic Balloons – Black & Gold"*
- Description (long-tail keywords woven in naturally), 5–7 bullets, and the **full attribute
  map** (occasion, color, material, pack size, care, country of origin…).

Rules (enforced in the prompt + post-checked in code):
- Only keywords from the provided bank — no invented claims, no competitor brand names.
- Title length ≤ platform limit; no keyword stuffing (a phrase appears once in the title).
- Attributes come from the product record, not the LLM's imagination — the LLM formats,
  the code supplies values.

## 4.3 Pre-QC Validator (deterministic, the QC-rejection killer)

Checks before anything is exported, producing a pass/fail report per listing:

**Images** (given a directory per product):
- ≥ 3 images (target 4–6); dimensions ~2000×2000; JPG; 200–600 KB (auto-resize/compress with
  `sharp` when out of spec); first image reasonably white-background (brightness heuristic
  on border pixels — flag, don't block).
- Flipkart killers: warn for text overlays (MRP visible in image = instant rejection).

**Data:**
- All mandatory attributes present for the target template version.
- Title/description length limits; HSN code present (Flipkart); MRP ≥ selling price;
  weight & dimensions present; manufacturer/packer details present.

Every real-world QC rejection gets logged (`ChannelListing.qcNotes` + `BusinessEvent
qc.rejected`) and, where checkable, becomes a new validator rule — the validator gets
stricter than the platforms over time.

## 4.4 Export adapters

- **Meesho:** fill the official bulk-upload Excel template (kept versioned in
  `data/templates/`; a snapshot test detects when Meesho changes columns). Image files are
  pre-processed to spec; the operator uploads them via "Images Bulk Upload" and the tool
  patches the returned links into the Excel (paste-links step in the CLI).
- **Flipkart:** fill the category catalog Excel for **new** products (upload via dashboard,
  then QC). Once the FSN exists, the P2 API path (`POST /listings/v3`) takes over price/stock.
- Both exports snapshot the exact payload into `ChannelListing.payload` and emit a
  `listing.exported` BusinessEvent.

## 4.5 Interface (P0 = CLI, no UI)

```
wishworks product add            # interactive: pick components, theme, palette → Product
wishworks keywords harvest       # run the autosuggest harvester now
wishworks generate <sku>         # Claude copy for both platforms → ListingContent
wishworks validate <sku>         # pre-QC report (images + data)
wishworks export <sku> --meesho --flipkart   # filled Excel files into data/exports/
wishworks mark-live <sku> --meesho <catalogId>  # record outcome, log event
```

Definition of done for P0: a brand-new combo goes from `product add` to two upload-ready,
validator-green files in under 3 minutes of operator time, and a real upload passes platform
QC first try.
